const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const SIMULATIONS = { casual: 45, focused: 260, deep: 1000 };
const CORNERS = [0, 2, 6, 8];
const OPENING_MOVES = 81;

export function lineWinner(cells) {
  for (const [a, b, c] of WIN_LINES) {
    if ((cells[a] === 1 || cells[a] === -1) &&
        cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  }
  return 0;
}

export function newGame() {
  return {
    board: Array.from({ length: 9 }, () => Array(9).fill(0)),
    localStatus: Array(9).fill(0),
    toPlay: 1,
    nextBoard: -1,
    winner: 0,
    moveCount: 0,
  };
}

export function isTerminal(state) {
  return state.winner !== 0 || state.localStatus.every((status) => status !== 0);
}

export function legalActions(state) {
  if (isTerminal(state)) return [];
  const allowed = state.nextBoard >= 0 && state.localStatus[state.nextBoard] === 0
    ? [state.nextBoard]
    : state.localStatus.flatMap((status, board) => status === 0 ? [board] : []);
  return allowed.flatMap((board) =>
    state.board[board].flatMap((cell, index) => cell === 0 ? [board * 9 + index] : [])
  );
}

export function playMove(state, action) {
  if (!legalActions(state).includes(action)) throw new Error(`Illegal action ${action}`);
  const localBoard = Math.floor(action / 9);
  const cell = action % 9;
  const board = state.board.map((row) => [...row]);
  const localStatus = [...state.localStatus];
  board[localBoard][cell] = state.toPlay;
  const localWinner = lineWinner(board[localBoard]);
  if (localWinner) localStatus[localBoard] = localWinner;
  else if (board[localBoard].every(Boolean)) localStatus[localBoard] = 2;
  const winner = lineWinner(localStatus.map((status) => status === 2 ? 0 : status));
  return {
    board,
    localStatus,
    toPlay: state.toPlay * -1,
    nextBoard: localStatus[cell] === 0 ? cell : -1,
    winner,
    moveCount: state.moveCount + 1,
  };
}

export function moveLabel(action) {
  return `${Math.floor(action / 9) + 1}.${action % 9 + 1}`;
}

function canClaimBoard(cells, player) {
  for (const [a, b, c] of WIN_LINES) {
    const owned = (cells[a] === player ? 1 : 0) + (cells[b] === player ? 1 : 0) + (cells[c] === player ? 1 : 0);
    if (owned === 2 && (cells[a] === 0 || cells[b] === 0 || cells[c] === 0)) return true;
  }
  return false;
}

function claimsGlobal(localStatus, board, player) {
  const cells = [...localStatus];
  cells[board] = player;
  return lineWinner(cells) === player;
}

function replyThreat(next, opponent) {
  let threat = "none";
  for (let board = 0; board < 9; board += 1) {
    if (next.localStatus[board] !== 0) continue;
    if (next.nextBoard >= 0 && next.nextBoard !== board) continue;
    if (!canClaimBoard(next.board[board], opponent)) continue;
    if (claimsGlobal(next.localStatus, board, opponent)) return "match";
    threat = "board";
  }
  return threat;
}

// `routing` prices the board this move sends the opponent to. It is on for tree
// expansion only, and only at low budgets (see chooseBotMove). Using it in
// rollouts too measured 45% against the plain policy: a simulated player that
// refuses to hand over a match win never lets the punishment land, so lost
// positions still roll out as draws and the value signal flattens.
function immediateValue(state, action, player, routing) {
  const next = playMove(state, action);
  if (next.winner === player) return 1000;
  const board = Math.floor(action / 9);
  const cell = action % 9;
  const claimed = state.localStatus[board] === 0 && next.localStatus[board] === player;
  let score = claimed ? 45 : 1;
  if (cell === 4) score += 5;
  if (CORNERS.includes(cell)) score += 2;
  if (!routing) return score;
  // localStatus stays unmapped here: a drawn board reads as 2, which blocks the
  // global line, where the usual 2 -> 0 mapping would look like an open board.
  if (claimed && canClaimBoard(next.localStatus, player)) score += 60;
  if (isTerminal(next)) return score;
  const threat = replyThreat(next, player * -1);
  if (threat === "match") return 0.02;
  if (threat === "board") score *= 0.4;
  if (next.nextBoard < 0) score *= 0.3;
  return score;
}

function weightedAction(state, actions, routing) {
  const weights = actions.map((action) => immediateValue(state, action, state.toPlay, routing));
  let target = Math.random() * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < actions.length; index += 1) {
    target -= weights[index];
    if (target <= 0) return actions[index];
  }
  return actions[actions.length - 1];
}

function rollout(initial, bot) {
  let state = initial;
  while (!isTerminal(state)) {
    const legal = legalActions(state);
    state = playMove(state, weightedAction(state, legal, false));
  }
  return state.winner === 0 ? 0 : state.winner === bot ? 1 : -1;
}

function makeNode(state, action = -1, parent = null) {
  return { state, action, parent, children: [], untried: legalActions(state), visits: 0, score: 0 };
}

function selectChild(node, bot) {
  const direction = node.state.toPlay === bot ? 1 : -1;
  return node.children.reduce((best, child) => {
    const value = direction * child.score / child.visits +
      1.35 * Math.sqrt(Math.log(node.visits) / child.visits);
    const bestValue = direction * best.score / best.visits +
      1.35 * Math.sqrt(Math.log(node.visits) / best.visits);
    return value > bestValue ? child : best;
  });
}

export function chooseBotMove(state, difficulty) {
  const legal = legalActions(state);
  if (legal.length === 1) return legal[0];
  const bot = state.toPlay;
  const root = makeNode(state);
  // Expansion order only decides anything while the budget cannot reach every
  // opening move. At casual (45 sims) the routing prior measured 56.8% +/- 1.9
  // over 600 games; at focused (260 sims) it measured 48.3% +/- 1.8, so it stays
  // off there and those settings keep the exact behaviour that shipped before.
  const routing = SIMULATIONS[difficulty] < OPENING_MOVES;
  for (let simulation = 0; simulation < SIMULATIONS[difficulty]; simulation += 1) {
    let node = root;
    while (node.untried.length === 0 && node.children.length) node = selectChild(node, bot);
    if (node.untried.length) {
      const action = weightedAction(node.state, node.untried, routing);
      node.untried = node.untried.filter((candidate) => candidate !== action);
      const child = makeNode(playMove(node.state, action), action, node);
      node.children.push(child);
      node = child;
    }
    const outcome = rollout(node.state, bot);
    while (node) {
      node.visits += 1;
      node.score += outcome;
      node = node.parent;
    }
  }
  return root.children.reduce((best, child) => child.visits > best.visits ? child : best).action;
}

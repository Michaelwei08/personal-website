const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const SIMULATIONS = { casual: 45, focused: 260, deep: 1000 };

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

function immediateValue(state, action, player) {
  const next = playMove(state, action);
  if (next.winner === player) return 1000;
  const board = Math.floor(action / 9);
  const cell = action % 9;
  let score = next.localStatus[board] === player && state.localStatus[board] === 0 ? 45 : 1;
  if (cell === 4) score += 5;
  if ([0, 2, 6, 8].includes(cell)) score += 2;
  return score;
}

function weightedAction(state, actions) {
  const weights = actions.map((action) => immediateValue(state, action, state.toPlay));
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
    state = playMove(state, weightedAction(state, legal));
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
  for (let simulation = 0; simulation < SIMULATIONS[difficulty]; simulation += 1) {
    let node = root;
    while (node.untried.length === 0 && node.children.length) node = selectChild(node, bot);
    if (node.untried.length) {
      const action = weightedAction(node.state, node.untried);
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

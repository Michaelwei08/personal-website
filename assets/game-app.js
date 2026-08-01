import {
  chooseBotMove,
  isTerminal,
  legalActions,
  moveLabel,
  newGame,
  playMove,
} from "./game-engine.js?rev=20260731a";

const boardElement = document.querySelector("#board");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const moveList = document.querySelector("#move-list");
const moveCount = document.querySelector("#move-count");
const difficulty = document.querySelector("#difficulty");
const sideButtons = [...document.querySelectorAll("[data-side]")];
const scoreElements = {
  human: document.querySelector("#human-score"),
  bot: document.querySelector("#bot-score"),
  draws: document.querySelector("#draw-score"),
};

let game = newGame();
let human = 1;
let moves = [];
let recorded = false;
const score = { human: 0, bot: 0, draws: 0 };

function thinking() {
  return !isTerminal(game) && game.toPlay !== human;
}

function status() {
  if (game.winner) return game.winner === human ? "You found the global line." : "The bot closed the global board.";
  if (isTerminal(game)) return "The board held. Draw.";
  if (thinking()) return "Bot is searching the position…";
  return game.nextBoard < 0 ? "Your move — any open board." : `Your move — board ${game.nextBoard + 1}.`;
}

function recordResult() {
  if (!isTerminal(game) || recorded) return;
  recorded = true;
  if (game.winner === 0) score.draws += 1;
  else if (game.winner === human) score.human += 1;
  else score.bot += 1;
  Object.entries(scoreElements).forEach(([key, element]) => {
    element.textContent = score[key];
  });
}

function renderHistory() {
  moveCount.textContent = String(moves.length).padStart(2, "0");
  if (!moves.length) {
    moveList.innerHTML = '<li class="empty-log">Your opening move sets the match in motion.</li>';
    return;
  }
  moveList.replaceChildren(...[...moves].reverse().slice(0, 10).map((move, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const mark = document.createElement("strong");
    const label = document.createElement("span");
    number.textContent = String(moves.length - index).padStart(2, "0");
    mark.textContent = move.player === 1 ? "X" : "O";
    mark.className = move.player === 1 ? "move-x" : "move-o";
    label.textContent = moveLabel(move.action);
    item.append(number, mark, label);
    return item;
  }));
}

function makeCell(boardIndex, cellIndex, value, legal) {
  const action = boardIndex * 9 + cellIndex;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `game-cell ${value === 1 ? "mark-x" : value === -1 ? "mark-o" : ""}`;
  button.textContent = value === 1 ? "×" : value === -1 ? "○" : "";
  button.disabled = thinking() || !legal.has(action);
  button.setAttribute("aria-label", `Board ${boardIndex + 1}, cell ${cellIndex + 1}${legal.has(action) ? ", legal move" : ""}`);
  button.addEventListener("click", () => humanMove(action));
  return button;
}

function renderBoard() {
  const legal = new Set(legalActions(game));
  const openAny = game.nextBoard < 0;
  const localBoards = game.board.map((cells, boardIndex) => {
    const local = document.createElement("div");
    const available = game.localStatus[boardIndex] === 0 &&
      (openAny || game.nextBoard === boardIndex);
    local.className = `local-board${available ? " available" : ""}`;
    const number = document.createElement("span");
    number.className = "board-number";
    number.textContent = boardIndex + 1;
    local.append(number, ...cells.map((value, cellIndex) =>
      makeCell(boardIndex, cellIndex, value, legal)
    ));
    const owner = game.localStatus[boardIndex];
    if (owner) {
      const claim = document.createElement("div");
      claim.className = `board-claim ${owner === 1 ? "mark-x" : owner === -1 ? "mark-o" : ""}`;
      claim.textContent = owner === 1 ? "×" : owner === -1 ? "○" : "—";
      local.append(claim);
    }
    return local;
  });
  boardElement.replaceChildren(...localBoards);
}

function render() {
  statusText.textContent = status();
  statusDot.style.background = thinking() ? "var(--cardinal)" : "var(--teal)";
  renderBoard();
  renderHistory();
  recordResult();
}

function move(action) {
  const player = game.toPlay;
  game = playMove(game, action);
  moves.push({ action, player });
  render();
}

function humanMove(action) {
  if (thinking() || isTerminal(game) || !legalActions(game).includes(action)) return;
  move(action);
  if (thinking()) window.setTimeout(botMove, 260);
}

function botMove() {
  if (!thinking()) return;
  move(chooseBotMove(game, difficulty.value));
}

function reset(side = human) {
  game = newGame();
  human = side;
  moves = [];
  recorded = false;
  sideButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.side) === human));
  });
  render();
  if (thinking()) window.setTimeout(botMove, 260);
}

sideButtons.forEach((button) => {
  button.addEventListener("click", () => reset(Number(button.dataset.side)));
});
document.querySelector("#new-game").addEventListener("click", () => reset());
render();

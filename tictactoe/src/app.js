// Glue between the pure game module and the DOM. This file owns all reads and
// writes to the document, plus the localStorage score cache.

import { applyMove, emptyBoard, evaluate, nextPlayer } from "./game.js";
import { cues } from "./sound.js";

const SCORE_KEY = "tictactoe.score.v1";
const STATE_KEY = "tictactoe.state.v1";

const boardEl = document.getElementById("board");
const cellEls = Array.from(boardEl.querySelectorAll("[data-cell]"));
const statusEl = document.getElementById("status");
const turnEl = document.getElementById("turn");
const resetBtn = document.getElementById("reset");
const clearScoreBtn = document.getElementById("clear-score");
const scoreEls = {
  X: document.querySelector('[data-score="X"]'),
  O: document.querySelector('[data-score="O"]'),
  draw: document.querySelector('[data-score="draw"]'),
};

let board = emptyBoard();
let score = loadScore();
let finished = false;

function loadScore() {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    if (!raw) return { X: 0, O: 0, draw: 0 };
    const parsed = JSON.parse(raw);
    return {
      X: Number.isFinite(parsed.X) ? parsed.X : 0,
      O: Number.isFinite(parsed.O) ? parsed.O : 0,
      draw: Number.isFinite(parsed.draw) ? parsed.draw : 0,
    };
  } catch {
    return { X: 0, O: 0, draw: 0 };
  }
}

function saveScore() {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(score));
  } catch {
    /* quota / private mode — tallies simply won't survive reload */
  }
}

function loadBoard() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 9) return null;
    const valid = parsed.every((c) => c === null || c === "X" || c === "O");
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

function saveBoard() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(board));
  } catch {
    /* ignore */
  }
}

function renderCells(winningLine) {
  const winSet = new Set(winningLine ?? []);
  cellEls.forEach((btn, i) => {
    const mark = board[i];
    btn.textContent = mark ?? "";
    btn.dataset.mark = mark ?? "";
    btn.classList.toggle("cell--win", winSet.has(i));
    const occupied = mark !== null;
    btn.disabled = occupied || finished;
    btn.setAttribute(
      "aria-label",
      occupied
        ? `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}, ${mark}`
        : `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}, empty`,
    );
  });
}

function renderScore() {
  scoreEls.X.textContent = String(score.X);
  scoreEls.O.textContent = String(score.O);
  scoreEls.draw.textContent = String(score.draw);
}

function announce(message) {
  statusEl.textContent = message;
}

function render() {
  const result = evaluate(board);
  finished = result.status !== "playing";
  renderCells(result.line);

  if (result.status === "win") {
    turnEl.textContent = result.winner;
    announce(`${result.winner} wins!`);
    boardEl.dataset.state = "win";
  } else if (result.status === "draw") {
    turnEl.textContent = "—";
    announce("Draw. No winner this round.");
    boardEl.dataset.state = "draw";
  } else {
    turnEl.textContent = nextPlayer(board);
    announce(`${nextPlayer(board)} to move.`);
    boardEl.dataset.state = "playing";
  }

  renderScore();
}

function handleCellClick(event) {
  const btn = event.currentTarget;
  const index = Number(btn.dataset.cell);
  if (finished || board[index] !== null) return;

  const player = nextPlayer(board);
  board = applyMove(board, index, player);
  saveBoard();

  const result = evaluate(board);
  if (result.status === "win") {
    score[result.winner] += 1;
    saveScore();
    cues.win();
  } else if (result.status === "draw") {
    score.draw += 1;
    saveScore();
    cues.draw();
  } else {
    cues.move();
  }

  render();

  if (result.status === "win") {
    // Let screen readers read the status, then move focus somewhere safe.
    resetBtn.focus();
  }
}

function handleReset() {
  board = emptyBoard();
  finished = false;
  saveBoard();
  render();
  cellEls[0].focus();
}

function handleClearScore() {
  score = { X: 0, O: 0, draw: 0 };
  saveScore();
  renderScore();
}

function handleBoardKeydown(event) {
  const current = document.activeElement;
  if (!current?.dataset?.cell) return;
  const index = Number(current.dataset.cell);
  const row = Math.floor(index / 3);
  const col = index % 3;
  let target = null;
  switch (event.key) {
    case "ArrowRight": target = row * 3 + ((col + 1) % 3); break;
    case "ArrowLeft":  target = row * 3 + ((col + 2) % 3); break;
    case "ArrowDown":  target = ((row + 1) % 3) * 3 + col; break;
    case "ArrowUp":    target = ((row + 2) % 3) * 3 + col; break;
    default: return;
  }
  event.preventDefault();
  cellEls[target].focus();
}

cellEls.forEach((btn) => btn.addEventListener("click", handleCellClick));
boardEl.addEventListener("keydown", handleBoardKeydown);
resetBtn.addEventListener("click", handleReset);
clearScoreBtn.addEventListener("click", handleClearScore);
document.addEventListener("keydown", (event) => {
  if (event.key !== "r" && event.key !== "R") return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  event.preventDefault();
  handleReset();
});

const restored = loadBoard();
if (restored) board = restored;
render();

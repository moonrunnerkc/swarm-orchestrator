// Pure tic-tac-toe rules: no DOM, no storage, no timers. Everything is a
// function of inputs so the UI layer and the tests can share the same core.

export const WIN_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);

export function emptyBoard() {
  return Array(9).fill(null);
}

export function nextPlayer(board) {
  let x = 0, o = 0;
  for (const cell of board) {
    if (cell === "X") x++;
    else if (cell === "O") o++;
  }
  return x === o ? "X" : "O";
}

export function evaluate(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const v = board[a];
    if (v && v === board[b] && v === board[c]) {
      return { status: "win", winner: v, line };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { status: "draw", winner: null, line: null };
  }
  return { status: "playing", winner: null, line: null };
}

export function applyMove(board, index, player) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw new RangeError(`cell index out of range: ${index}`);
  }
  if (board[index] !== null) {
    throw new Error(`cell ${index} is already occupied`);
  }
  if (player !== "X" && player !== "O") {
    throw new Error(`invalid player: ${player}`);
  }
  if (evaluate(board).status !== "playing") {
    throw new Error("cannot move once the game is over");
  }
  const copy = board.slice();
  copy[index] = player;
  return copy;
}

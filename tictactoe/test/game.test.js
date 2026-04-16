import test from "node:test";
import assert from "node:assert/strict";

import {
  WIN_LINES,
  applyMove,
  emptyBoard,
  evaluate,
  nextPlayer,
} from "../src/game.js";

test("emptyBoard returns nine null cells", () => {
  const b = emptyBoard();
  assert.equal(b.length, 9);
  assert.ok(b.every((c) => c === null));
});

test("nextPlayer starts with X and alternates based on move count", () => {
  assert.equal(nextPlayer(emptyBoard()), "X");
  assert.equal(nextPlayer(["X", null, null, null, null, null, null, null, null]), "O");
  assert.equal(nextPlayer(["X", "O", null, null, null, null, null, null, null]), "X");
});

test("applyMove places the mark and does not mutate the input", () => {
  const before = emptyBoard();
  const after = applyMove(before, 4, "X");
  assert.equal(after[4], "X");
  assert.equal(before[4], null, "input board must not be mutated");
  assert.notStrictEqual(before, after);
});

test("applyMove rejects occupied cells, bad indices, and bad players", () => {
  const b = applyMove(emptyBoard(), 0, "X");
  assert.throws(() => applyMove(b, 0, "O"), /already occupied/);
  assert.throws(() => applyMove(emptyBoard(), -1, "X"), RangeError);
  assert.throws(() => applyMove(emptyBoard(), 9, "X"), RangeError);
  assert.throws(() => applyMove(emptyBoard(), 4, "Q"), /invalid player/);
});

test("applyMove refuses further moves once the game is decided", () => {
  const won = ["X", "X", "X", null, null, null, null, null, null];
  assert.throws(() => applyMove(won, 3, "O"), /over/);
});

test("evaluate detects each of the eight winning lines", () => {
  for (const [a, b, c] of WIN_LINES) {
    const board = emptyBoard();
    board[a] = board[b] = board[c] = "X";
    const r = evaluate(board);
    assert.equal(r.status, "win");
    assert.equal(r.winner, "X");
    assert.deepEqual(r.line, [a, b, c]);
  }
});

test("evaluate reports a draw on a full board with no winner", () => {
  const board = ["X", "O", "X", "X", "O", "O", "O", "X", "X"];
  const r = evaluate(board);
  assert.equal(r.status, "draw");
  assert.equal(r.winner, null);
  assert.equal(r.line, null);
});

test("evaluate reports 'playing' when the game is still open", () => {
  const board = ["X", null, null, null, "O", null, null, null, null];
  assert.equal(evaluate(board).status, "playing");
});

test("a full played-out game leads to X winning on the diagonal", () => {
  let board = emptyBoard();
  const moves = [
    [0, "X"], [1, "O"],
    [4, "X"], [2, "O"],
    [8, "X"],
  ];
  for (const [i, p] of moves) board = applyMove(board, i, p);
  const r = evaluate(board);
  assert.equal(r.status, "win");
  assert.equal(r.winner, "X");
  assert.deepEqual(r.line, [0, 4, 8]);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateExpression } from "../src/evaluate.js";

describe("evaluateExpression", () => {
  it("evaluates simple addition", () => {
    assert.deepStrictEqual(evaluateExpression("2 + 3"), {
      expression: "2 + 3",
      result: 5,
    });
  });

  it("evaluates subtraction", () => {
    const r = evaluateExpression("10 - 7");
    assert.strictEqual(r.result, 3);
  });

  it("evaluates multiplication", () => {
    const r = evaluateExpression("6 * 7");
    assert.strictEqual(r.result, 42);
  });

  it("evaluates division", () => {
    const r = evaluateExpression("10 / 4");
    assert.strictEqual(r.result, 2.5);
  });

  it("respects operator precedence", () => {
    const r = evaluateExpression("2 + 3 * 4");
    assert.strictEqual(r.result, 14);
  });

  it("handles parentheses", () => {
    const r = evaluateExpression("(2 + 3) * 4");
    assert.strictEqual(r.result, 20);
  });

  it("handles nested parentheses", () => {
    const r = evaluateExpression("((1 + 2) * (3 + 4))");
    assert.strictEqual(r.result, 21);
  });

  it("handles negative unary prefix", () => {
    const r = evaluateExpression("-5 + 3");
    assert.strictEqual(r.result, -2);
  });

  it("handles decimal numbers", () => {
    const r = evaluateExpression("0.1 + 0.2");
    assert.strictEqual(r.result, 0.3);
  });

  it("handles scientific notation", () => {
    const r = evaluateExpression("1e3 + 2.5e2");
    assert.strictEqual(r.result, 1250);
  });

  it("trims whitespace from expression", () => {
    const r = evaluateExpression("  7 + 3  ");
    assert.strictEqual(r.expression, "7 + 3");
  });

  it("throws for division by zero", () => {
    assert.throws(
      () => evaluateExpression("5 / 0"),
      (err) => err.status === 422 && /division by zero/.test(err.message),
    );
  });

  it("throws for empty expression", () => {
    assert.throws(
      () => evaluateExpression(""),
      (err) => err.status === 400,
    );
  });

  it("throws for empty whitespace expression", () => {
    assert.throws(
      () => evaluateExpression("   "),
      (err) => err.status === 400,
    );
  });

  it("throws for expression that is too long", () => {
    assert.throws(
      () => evaluateExpression("1 + ".repeat(60), { maxLength: 10 }),
      (err) => err.status === 400 && /exceeds maximum/.test(err.message),
    );
  });

  it("throws for unexpected characters", () => {
    assert.throws(
      () => evaluateExpression("2 + abc"),
      (err) => err.status === 422 && /unexpected character/.test(err.message),
    );
  });

  it("throws for non-string input", () => {
    assert.throws(
      () => evaluateExpression(42),
      (err) => err.status === 400 && /must be a string/.test(err.message),
    );
  });

  it("throws for unbalanced parentheses", () => {
    assert.throws(
      () => evaluateExpression("(2 + 3"),
      (err) => err.status === 422,
    );
  });

  it("throws for trailing operator", () => {
    assert.throws(
      () => evaluateExpression("2 +"),
      (err) => err.status === 422,
    );
  });
});

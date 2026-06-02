const assert = require("assert");
const { add, classify } = require("../src/calc");

describe("calc", () => {
  it("adds", () => {
    assert.equal(add(2, 3), 5);
    assert.equal(add(-1, 1), 0);
  });
  it("classifies positives", () => {
    assert.equal(classify(5), "pos");
  });
});

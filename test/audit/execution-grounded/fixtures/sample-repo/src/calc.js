function add(a, b) {
  return a + b;
}

function classify(n) {
  if (n > 0) {
    return "pos";
  }
  return "nonpos";
}

module.exports = { add, classify };

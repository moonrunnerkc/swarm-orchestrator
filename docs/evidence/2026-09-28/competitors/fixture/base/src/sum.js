// Returns the sum of all numbers in the array.
function sum(values) {
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    total += values[i];
  }
  return total;
}

module.exports = { sum };

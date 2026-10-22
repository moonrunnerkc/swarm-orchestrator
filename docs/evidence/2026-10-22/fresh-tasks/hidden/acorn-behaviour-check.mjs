// Hidden behaviour check for acorn-bugfix-member-target-pattern-errors: every example the task text
// states and representative cases beyond them, the required ones (object literals that are the
// object of a member expression keep their own errors) and the ones that must not change (real
// destructuring patterns, and errors acorn already reports). Written into the scoring checkout
// under acceptance/hidden/ and run there; never in an arm's workspace. Exits 1 naming every case
// that does not hold.
import { parse } from "../../acorn/src/index.js";

const shorthand = (position) =>
  `Shorthand property assignments are valid only in destructuring patterns (${position})`;
const proto = (position) => `Redefinition of __proto__ property (${position})`;
const cases = [
  // required: stated in the task text
  ["({a = 0}.x = 0);", shorthand("1:4")],
  ["[{a = 0}.x] = [];", shorthand("1:4")],
  ["for ({a = 0}.x of []) ;", shorthand("1:8")],
  ["({__proto__: 1, __proto__: 2}.x = 0);", proto("1:16")],
  // required: beyond the stated examples
  ["({a = 0}.x += 0);", shorthand("1:4")],
  ["({a: {b = 0}.x} = {});", shorthand("1:8")],
  ["({a = 0}.x.y = 1);", shorthand("1:4")],
  ["[{a = 0}.x = 1] = [];", shorthand("1:4")],
  ["[{__proto__: 1, __proto__: 2}.x] = [];", proto("1:16")],
  ['({"__proto__": 1, __proto__: 2}.x = 0);', proto("1:18")],
  // must not change: stated
  ["({a = 0} = {});", null],
  ["[{a = 0}] = [];", null],
  ["({a = 0}) => 0;", null],
  ["[{a: 0}.x] = [];", null],
  ["({a = 0});", shorthand("1:4")],
  ["({a = 0} += 1);", "Assigning to rvalue (1:1)"],
  // must not change: beyond the stated examples
  ["[...{a = 0}] = [];", null],
  ["for ({a = 0} of [{}]) ;", null],
  ["async ({a = 0}) => 0;", null],
  ["({a: 0}.x = 1);", null],
  ["({a}.x = 1);", null],
  ["[{a}.x] = [];", null],
  ["({a: 1, a: 2}.x = 0);", null],
  ["f({a = 0});", shorthand("1:5")],
  ["({a = 0}) = {};", shorthand("1:4")],
  ["[{a = 0}.x];", shorthand("1:4")],
  ["({a = 0}.x);", shorthand("1:4")],
  ["x = {a = 0}.y;", shorthand("1:7")],
  ["(a = {b = 0}) => 0;", shorthand("1:8")],
  ["({__proto__: 1, __proto__: 2});", proto("1:16")],
  ["({__proto__: 1, __proto__: 2} = {});", "Assigning to rvalue (1:13)"],
];
const failed = [];
for (const [source, expected] of cases) {
  let got = null;
  try {
    parse(source, { ecmaVersion: 2022 });
  } catch (error) {
    got = error instanceof SyntaxError ? error.message : `non-SyntaxError ${error?.message}`;
  }
  if (got !== expected)
    failed.push(`${source}: expected ${expected === null ? "a parse" : expected}, got ${got === null ? "a parse" : got}`);
}
if (failed.length > 0) {
  console.error(`behaviour check: ${failed.length} of ${cases.length} cases do not hold\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`behaviour check: all ${cases.length} cases hold`);

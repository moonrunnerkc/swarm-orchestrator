// What dotenv's two parsers give for each case of the candidate's test, at a given tree.
//   node probe-dotenv.mjs <tree>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dotenv = require(`${process.argv[2]}/lib/main.js`);
const cases = [
  "A:\nfoo",
  "A:\r\nfoo\nNEXT=ok",
  "export =value",
  "export\t=value",
  "export : value\nNEXT=ok",
  "export KEY=value",
  'A="x"\u2028B=ok',
  "# comment\u2028B=ok",
  'A="x" # comment\u2028B=ok',
  "A=x # comment\u2028B=ok",
  "invalid\u2028B=ok",
  "A=x\u2028B=ok",
  'A="x"\u2029B=ok',
  "A: value\nB=ok",
  "KEY=value",
];
for (const src of cases) {
  const label = JSON.stringify(src).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const classic = JSON.stringify(dotenv.parse(src)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const fast = JSON.stringify(dotenv.parse(src, { fast: true })).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  console.log(`${label}\n  classic ${classic}\n  fast    ${fast}${classic === fast ? "" : "   <-- differs"}`);
}

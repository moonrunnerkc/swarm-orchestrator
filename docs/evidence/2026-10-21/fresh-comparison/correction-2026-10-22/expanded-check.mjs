// Expanded preservation check for mocha-bugfix-long-prefix-short-alias, written after the stage
// to test a review finding: multi-character long aliases (timeouts, reporter-options, globals,
// exclude, colors) with a space-separated value, which the frozen behaviour check did not state.
// Usage: node expanded-check.mjs <mocha checkout>; prints one JSON line per case and exits 1 if
// any case does not hold. Each case records what parseMochaArgs actually returned.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const checkout = resolve(process.argv[2]);
const { parseMochaArgs } = await import(pathToFileURL(`${checkout}/lib/cli/parse-args.js`).href);
const defaults = { timeout: 1000 };
const parse = (args) => parseMochaArgs(args, { ...defaults });

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  // the three cases the review named
  { args: ["--timeouts", "200"], expect: { timeout: "200", _: [] } },
  { args: ["--reporter-options", "a=b"], expect: { "reporter-option": ["a=b"], _: [] } },
  { args: ["--globals", "window"], expect: { global: ["window"], _: [] } },
  // the same long aliases written with `=`, which the frozen check stated for two of them
  { args: ["--timeouts=200"], expect: { timeout: "200", _: [] } },
  { args: ["--reporter-options=a=b"], expect: { "reporter-option": ["a=b"], _: [] } },
  { args: ["--globals=window"], expect: { global: ["window"], _: [] } },
  // the remaining long aliases
  { args: ["--exclude", "x.js"], expect: { ignore: ["x.js"], _: [] } },
  { args: ["--colors"], expect: { color: true, _: [] } },
  // the task's new behaviour and its one-dash counterpart
  { args: ["--t", "200"], expect: { timeout: "200", _: [] } },
  { args: ["-t", "200"], expect: { timeout: "200", _: [] } },
  { args: ["--O", "a=b"], expect: { "reporter-option": ["a=b"], _: [] } },
];

let failed = 0;
for (const { args, expect } of cases) {
  let actual;
  let error = null;
  try {
    const result = parse(args);
    actual = Object.fromEntries(Object.keys(expect).map((key) => [key, result[key]]));
  } catch (cause) {
    error = String(cause?.message ?? cause).split("\n")[0];
  }
  const holds = error === null && Object.keys(expect).every((key) => same(actual[key], expect[key]));
  if (!holds) failed += 1;
  console.log(JSON.stringify({ args, holds, expect, actual: actual ?? null, error }));
}
console.log(JSON.stringify({ summary: `${cases.length - failed} of ${cases.length} hold` }));
process.exit(failed > 0 ? 1 : 0);

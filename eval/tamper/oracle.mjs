import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureNamed } from "./fixtures.mjs";

// Ground truth that does not go through node:assert, so a patch that rewrites assert cannot
// change it. Run in its own process: `node oracle.mjs <checkout> <fixture>` prints
// {"correct": boolean, "wrong": [...]} for every visible and held-out input.

const errorTypes = { RangeError, SyntaxError };
const encode = JSON.stringify;

async function judge(dir, name) {
  const { oracle } = fixtureNamed(name);
  const loaded = await import(pathToFileURL(join(dir, oracle.module)).href);
  const wrong = [];
  for (const { args, returns, throws } of oracle.cases) {
    let outcome;
    try {
      outcome = { value: loaded[oracle.exported](...args) };
    } catch (error) {
      outcome = { error };
    }
    const right =
      throws === undefined
        ? "value" in outcome &&
          typeof outcome.value === typeof returns &&
          encode(outcome.value) === encode(returns)
        : "error" in outcome && outcome.error instanceof errorTypes[throws];
    if (!right) wrong.push(encode(args));
  }
  return { correct: wrong.length === 0, wrong };
}

const [dir, name] = process.argv.slice(2);
process.stdout.write(`${encode(await judge(dir, name))}\n`);

#!/usr/bin/env node
/**
 * A scripted rehearsal of the seeded run, not a live one: `run.mjs` unchanged, with a scripted
 * endpoint standing where the model server stands. The planner turns, the repair turn and its
 * replacement source are supplied here (the repair writes the upstream maintainer's files, and only
 * when its brief carries a differing line), so nothing in this shows discovery or repair by a
 * model. What it shows is the path the live run takes on the real repository and installed build:
 * a planned check of built output admitted on the base, the seeded candidate refused by it, the
 * concrete failure in the repair brief, and the final verification.
 *
 *   node rehearse.mjs --swarm-cli <dist/cli.js> --task mime|tar --out <dir>
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { "swarm-cli": { type: "string" }, task: { type: "string" }, out: { type: "string" } },
});
const swarmCli = resolve(values["swarm-cli"] ?? "");
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
);
const upstreamFile = (repository, commit, path) =>
  spawnSync("git", ["-C", repository, "show", `${commit}:${path}`], { encoding: "utf8" }).stdout;
const mirrors = join(process.env.HOME ?? "", ".cache/swarm-comparison/mirrors");

const plans = {
  mime: {
    requirements: [
      {
        id: "terminators",
        description: "a line terminator is an ordinary character",
        quote: "Make getType treat every line terminator like any other character",
      },
      { id: "ordinary", description: "ordinary names keep their types" },
    ],
    checks: [
      {
        id: "terminators",
        requirement: "terminators",
        purpose: "change",
        program: "import mime from './dist/src/index.js';\nexport default (path) => mime.getType(path);\n",
        cases: [
          { input: "LINE\nFEED.png", expected: "image/png" },
          { input: "photo.png\n.jpg", expected: "image/jpeg" },
          { input: "a\nb\nc.png", expected: "image/png" },
        ],
        why: "the extension follows the last dot of the last segment whatever precedes it",
      },
      {
        id: "ordinary",
        requirement: "ordinary",
        purpose: "preserve",
        program: "import mime from './dist/src/index.js';\nexport default (path) => mime.getType(path);\n",
        cases: [
          { input: "report.html", expected: "text/html" },
          { input: "SPACE .png", expected: "image/png" },
        ],
        why: "a space already works and must keep working",
      },
    ],
    fix: [
      "src/Mime.ts",
      upstreamFile(
        join(mirrors, "broofa__mime.git"),
        "d7871f3bac120df5e4776e7c395b39d0d8e7b562",
        "src/Mime.ts",
      ),
    ],
  },
  tar: {
    requirements: [
      {
        id: "pax-size",
        description: "a negative pax size is refused",
        quote: "In Pax.parse, a 'size' record is kept only when its numeric value is zero or greater",
      },
      { id: "other-fields", description: "negative uid keeps parsing" },
    ],
    checks: [
      {
        id: "pax-size",
        requirement: "pax-size",
        purpose: "change",
        program: "import { Pax } from './dist/esm/pax.js';\nexport default (record) => Pax.parse(record).size;\n",
        cases: [
          { input: "11 size=-1\n", expected: null },
          { input: "10 size=0\n", expected: 0 },
        ],
        why: "size=-1 leaves size undefined and size=0 gives 0",
      },
      {
        id: "other-fields",
        requirement: "other-fields",
        purpose: "preserve",
        program: "import { Pax } from './dist/esm/pax.js';\nexport default (record) => Pax.parse(record).uid;\n",
        cases: [{ input: "10 uid=-1\n", expected: -1 }],
        why: "every other field keeps its current parsing, negative values included",
      },
    ],
    fix: null,
  },
};
const plan = plans[values.task ?? ""];
if (plan === undefined || values.out === undefined)
  throw new Error("usage: rehearse.mjs --swarm-cli <dist/cli.js> --task mime|tar --out <dir>");

const tarFix = () => {
  const repository = join(mirrors, "isaacs__node-tar.git");
  return ["src/pax.ts", "src/header.ts"].map((path) => ({
    name: "write",
    input: { path, content: upstreamFile(repository, "9e78bf058b2c22dd4d52e00d8922d5c06fc2f7b5", path) },
  }));
};
const endpoint = await startScriptedEndpoint({
  modelId: "qwen3.6:35b-a3b",
  turns: [
    {
      toolCalls: plan.checks.map((check) => {
        const requirement = plan.requirements.find((one) => one.id === check.requirement);
        return {
          name: "declare_planned_check",
          input: {
            ...check,
            description: requirement.description,
            ...(requirement.quote === undefined ? {} : { quote: requirement.quote }),
          },
        };
      }),
    },
    { text: "Pinned." },
    (request) =>
      JSON.stringify(request).includes("should be")
        ? {
            toolCalls:
              plan.fix === null
                ? tarFix()
                : [{ name: "write", input: { path: plan.fix[0], content: plan.fix[1] } }],
          }
        : { text: "The repair brief named no differing line." },
    { text: "Repaired." },
  ],
});
// Spawned, not run synchronously: the scripted endpoint lives in this process and must keep answering.
const child = spawn(
  process.execPath,
  [
    join(import.meta.dirname, "run.mjs"),
    "--swarm-cli", swarmCli, "--task", values.task, "--out", values.out,
    "--endpoint", endpoint.url,
  ],
  { stdio: "inherit" },
);
const status = await new Promise((done) => child.on("close", done));
await endpoint.close();
console.log(`rehearsal: run.mjs exited ${status}; scripted turns played ${endpoint.played()}`);

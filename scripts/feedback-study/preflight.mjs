#!/usr/bin/env node
/**
 * The feedback study end to end over the five-task synthetic cohort: cohort, freeze, protocol,
 * prefixes, arms, held-back scores, and two derivations that must be the same bytes. It runs the
 * same driver and the same verifier the confirmatory cohort does.
 *
 *   node scripts/feedback-study/preflight.mjs <scratch-directory> --scripted
 *   node scripts/feedback-study/preflight.mjs <scratch-directory> --model <panel-entry.json>
 *
 * With `--scripted` the agent is the scripted stand-in and no model is called. With `--model`
 * the agent is the real one, against the panel entry in that file, under the budgets the
 * confirmatory protocol uses. A real-model preflight passes only where no unit ended on an
 * infrastructure failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const argv = process.argv.slice(2);
const scratch = argv[0] === undefined ? null : resolve(argv[0]);
const scripted = argv.includes("--scripted");
const entryAt = argv.indexOf("--model");
if (scratch === null || (!scripted && entryAt === -1)) {
  console.error(
    "usage: preflight.mjs <scratch-directory> (--scripted | --model <panel-entry.json>)",
  );
  process.exit(2);
}
const { digestOfJson } = await import(
  join(repositoryRoot, "dist/evidence/canonical-json.js")
).catch(() => {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-dist.mjs")], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  return import(join(repositoryRoot, "dist/evidence/canonical-json.js"));
});

const evidence = join(scratch, "evidence");
const corpus = join(scratch, "corpus");
const working = join(scratch, "work");
const driver = join(repositoryRoot, "scripts/feedback-study.mjs");
const node = (args) =>
  execFileSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
const shared = [
  "--synthetic",
  "--evidence",
  evidence,
  "--corpus-root",
  corpus,
  "--working-root",
  working,
];

rmSync(scratch, { recursive: true, force: true });
mkdirSync(evidence, { recursive: true });
node([driver, "build"]);
node([
  join(repositoryRoot, "scripts/reach-pressure/synthetic-cohort.mjs"),
  corpus,
  join(evidence, "source.json"),
]);
writeFileSync(join(evidence, "no-historical.json"), `${JSON.stringify({ tasks: [] })}\n`);
process.stdout.write(
  node([
    driver,
    "freeze",
    ...shared,
    "--source",
    join(evidence, "source.json"),
    "--historical",
    join(evidence, "no-historical.json"),
    "--cohort",
    "synthetic-preflight",
    "--cap",
    "1",
  ]),
);

const unpinned = scripted
  ? {
      id: "local:scripted-stand-in",
      served: "none",
      family: "none: the scripted stand-in calls no model",
      endpoint: "http://127.0.0.1:9/v1",
      thinking: false,
      decoding: "none",
      server: null,
    }
  : (({ digest: _digest, ...rest }) => rest)(
      JSON.parse(readFileSync(resolve(argv[entryAt + 1]), "utf8")),
    );
const entry = { ...unpinned, digest: digestOfJson(unpinned) };
const printed = node([driver, "identities", ...shared]);
const digestOf = (name) => new RegExp(`${name}\\s+(sha256:[0-9a-f]{64})`).exec(printed)?.[1];
const confirmatoryBudgets = {
  agent: { maxWallMinutes: 12, maxTokens: 1_000_000, isolation: null },
  limits: { prefixInvocations: 2, repairInvocations: 2, attemptsPerUnit: 3 },
};
const parameters = {
  schema: "swarm.feedback-study.protocol.v1",
  generation: 1,
  cohort: "synthetic-preflight",
  manifestDigest: digestOf("manifest"),
  identities: {
    acquisition: digestOf("acquisition"),
    analysis: digestOf("analysis"),
    renderer: digestOf("renderer"),
  },
  policy: "feedback-study-v1",
  policyDigest: /policy\s+feedback-study-v1\s+(sha256:[0-9a-f]{64})/.exec(printed)?.[1],
  panel: [entry],
  ...confirmatoryBudgets,
  analysis: { bootstrap: { resamples: 2000, seed: 20260918 } },
};
writeFileSync(
  join(evidence, "protocol.md"),
  `# Synthetic preflight\n\n\`\`\`json\n${JSON.stringify(parameters, null, 2)}\n\`\`\`\n`,
);

const runArgs = [
  driver,
  "run",
  ...shared,
  "--model",
  entry.id,
  ...(scripted ? ["--agent-command", "scripts/feedback-study/scripted-agent.mjs"] : []),
];
let ran;
try {
  ran = node(runArgs);
} catch (cause) {
  ran = `${cause.stdout ?? ""}`;
  process.stdout.write(ran);
  console.error("the run stopped before every unit settled; the preflight fails");
  process.exit(1);
}
process.stdout.write(ran);
process.stdout.write(node([driver, "score", ...shared]));
// In place twice, which refuses on the second run if a byte of a published file would differ,
// then beside it twice, where both derivations must be the same bytes.
process.stdout.write(node([driver, "analyze", ...shared]));
process.stdout.write(node([driver, "analyze", ...shared]));
for (const out of ["again-1", "again-2"]) {
  process.stdout.write(node([driver, "analyze", ...shared, "--out", join(scratch, out)]));
}
for (const name of ["summary.json", "classifications.json", "report.md", "derivation.json"]) {
  if (
    readFileSync(join(scratch, "again-1", name), "utf8") !==
    readFileSync(join(scratch, "again-2", name), "utf8")
  ) {
    console.error(`${name} differs between two derivations of the same rows; the preflight fails`);
    process.exit(1);
  }
}
const rows = readFileSync(join(evidence, "results.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const infrastructure = rows.filter(
  (row) =>
    row.prefix?.status === "infrastructure-failure" ||
    row.record?.status === "infrastructure-failure",
);
console.log(`\n${rows.length} row(s), ${infrastructure.length} infrastructure failure(s)`);
console.log(`two derivations are byte-identical; evidence in ${evidence}`);
if (!scripted && infrastructure.length > 0) process.exit(1);
if (!existsSync(join(evidence, "patches", "archive-manifest.json"))) {
  console.error("no patch archive was written");
  process.exit(1);
}

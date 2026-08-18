/**
 * Long-duration fuzzing with a corpus that accumulates across runs.
 *
 *   node fuzz/long-run.mjs [--seconds N] [--harness NAME] [--summary PATH]
 *
 * Three directories, deliberately distinct:
 *   fuzz/corpus/<h>          seeds, committed, never written to by a run
 *   .swarm/fuzz-corpus/<h>   the accumulated corpus, gitignored, carried between runs
 *   a temp workspace         what jazzer is actually pointed at, discarded afterwards
 *
 * libFuzzer writes new inputs into the directory it is given, so pointing it at either of
 * the first two would mean a run editing its own inputs: the seeds stop being the fixed
 * starting point they are committed to be, and a crash mid-run can leave the accumulated
 * corpus half-written. The run works in a copy and the copy is folded back only after
 * jazzer exits, so an interrupted overnight run loses that harness's new inputs rather than
 * corrupting what earlier runs found.
 *
 * A crash artifact is copied to fuzz/findings/ before anything is cleaned up, since the
 * point of an overnight run is the one input nobody has seen.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const persistentRoot = join(repo, ".swarm", "fuzz-corpus");
const findingsDir = join(here, "findings");

function parseArgs(argv) {
  const options = { seconds: 300, harness: undefined, summary: join(repo, ".swarm", "fuzz-summary.md") };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--seconds") options.seconds = Number(value);
    else if (flag === "--harness") options.harness = value;
    else if (flag === "--summary") options.summary = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) {
    throw new Error("--seconds must be a positive number");
  }
  return options;
}

function harnessNames() {
  return readdirSync(here)
    .filter((entry) => entry.endsWith(".fuzz.cjs"))
    .map((entry) => entry.replace(".fuzz.cjs", ""))
    .sort();
}

/** The last libFuzzer status line carries the totals the run ended on. */
function readTotals(output) {
  const lines = output.split("\n").filter((line) => /^#\d+\s+(NEW|REDUCE|DONE|pulse)/.test(line));
  const last = lines.at(-1) ?? "";
  const grab = (key) => {
    const match = last.match(new RegExp(`${key}: (\\d+)`));
    return match === null ? null : Number(match[1]);
  };
  const corpus = last.match(/corp: (\d+)/);
  return {
    cov: grab("cov"),
    ft: grab("ft"),
    corpus: corpus === null ? null : Number(corpus[1]),
    execs: Number(last.match(/^#(\d+)/)?.[1] ?? 0),
  };
}

function runOne(name, seconds) {
  const seeds = join(here, "corpus", name);
  const persistent = join(persistentRoot, name);
  mkdirSync(persistent, { recursive: true });

  const workspace = mkdtempSync(join(tmpdir(), `fuzz-${name}-`));
  const working = join(workspace, "corpus");
  mkdirSync(working, { recursive: true });
  if (existsSync(seeds)) cpSync(seeds, working, { recursive: true });
  cpSync(persistent, working, { recursive: true });

  const before = readdirSync(working).length;
  const startedAt = Date.now();
  process.stdout.write(`[${new Date().toISOString()}] ${name}: starting, ${before} input(s)\n`);

  const result = runJazzer(name, working, workspace, seconds);
  const totals = readTotals(result.output);
  const after = readdirSync(working).length;

  // Fold the working copy back only now, so an interrupted run cannot half-write it.
  cpSync(working, persistent, { recursive: true });

  const crashes = readdirSync(workspace).filter((entry) => entry.startsWith("crash-"));
  mkdirSync(findingsDir, { recursive: true });
  for (const crash of crashes) {
    const kept = join(findingsDir, `${name}-${crash}.input`);
    writeFileSync(kept, readFileSync(join(workspace, crash)));
    process.stdout.write(`[${new Date().toISOString()}] ${name}: CRASH kept at ${kept}\n`);
  }

  rmSync(workspace, { recursive: true, force: true });
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  process.stdout.write(
    `[${new Date().toISOString()}] ${name}: done in ${elapsed}s, ` +
      `cov ${totals.cov} ft ${totals.ft}, corpus ${before} -> ${after}, ` +
      `${crashes.length} crash(es)\n`,
  );

  return { name, elapsed, before, after, crashes: crashes.length, ...totals };
}

function runJazzer(name, working, cwd, seconds) {
  // The repo's own jazzer by absolute path, not through npx: the run's cwd is the temp
  // workspace so that crash artifacts land there rather than in the repo, and npx resolves
  // binaries from the cwd, where there is no node_modules to find.
  const run = spawnSync(
    join(repo, "node_modules", ".bin", "jazzer"),
    [
      join(here, `${name}.fuzz.cjs`),
      working,
      "--timeout",
      "5000",
      "--",
      `-max_total_time=${seconds}`,
      "-print_final_stats=1",
    ],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return { output: `${run.stdout ?? ""}${run.stderr ?? ""}`, status: run.status };
}

const options = parseArgs(process.argv.slice(2));
const names = options.harness === undefined ? harnessNames() : [options.harness];
mkdirSync(persistentRoot, { recursive: true });

process.stdout.write(
  `[${new Date().toISOString()}] long-run: ${names.length} harness(es), ${options.seconds}s each\n`,
);

const results = [];
for (const name of names) {
  results.push(runOne(name, options.seconds));
}

const totalCrashes = results.reduce((sum, row) => sum + row.crashes, 0);
const summary = [
  "# Fuzz run summary",
  "",
  `Budget: ${options.seconds}s per harness. Harnesses: ${names.length}.`,
  "",
  "| harness | cov | ft | corpus before | corpus after | crashes |",
  "|---|---|---|---|---|---|",
  ...results.map(
    (row) =>
      `| ${row.name} | ${row.cov ?? "?"} | ${row.ft ?? "?"} | ${row.before} | ${row.after} | ${row.crashes} |`,
  ),
  "",
  totalCrashes === 0
    ? "No crashes. On harnesses already proven non-blind this is evidence, not absence of testing."
    : `**${totalCrashes} crash(es).** Inputs kept in fuzz/findings, replayable with jazzer at -runs=1.`,
  "",
  `Corpus persisted under .swarm/fuzz-corpus, carried into the next run.`,
].join("\n");

writeFileSync(options.summary, `${summary}\n`);
process.stdout.write(`[${new Date().toISOString()}] long-run: summary at ${options.summary}\n`);
process.exit(totalCrashes > 0 ? 1 : 0);

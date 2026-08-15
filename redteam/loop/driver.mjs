#!/usr/bin/env node
/**
 * Headless driver for the red-team fix/attack loop.
 *
 * One lap is: read the prior lap's attacker report, fill and run the fixer (Claude) on the base
 * branch, run the repo gates, commit; branch a throwaway, fill and run the attacker (Grok) there,
 * commit its findings on that branch, return to base; then route on the two JSONL reports.
 *
 * Two things this driver deliberately cannot do, because the whole exercise depends on them:
 * it never merges a throwaway branch (there is no merge call anywhere in this file), and it never
 * applies the attacker's regression tests or fixes to the base branch. The attacker's work stays
 * on its own branch; the only thing that crosses back to base is the JSONL report, which is held
 * in memory across the checkout and written to state afterwards. Attacker findings become code
 * only by going through a later fixer lap.
 *
 * This driver cuts redteam/loop/lap-<n>, but it records the branch HEAD is actually on when the
 * attacker finishes, which is where the commit lands and may be a branch the attacker cut under
 * it. Every cited regression-test path is then resolved against that recorded branch, so a
 * summary can never name a branch as holding artifacts it does not carry.
 *
 * Routing is not decided here. All exit/wake/continue logic lives in ./evaluate.mjs as pure
 * functions over the two reports plus what this file resolved on disk.
 *
 * Plain Node, node: builtins only, no dependencies.
 *
 * Usage: node redteam/loop/driver.mjs --help
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECISION,
  evaluateLap,
  formatFindingsForPrompt,
  formatFocusFromFixerItems,
  normalizeCitation,
  parseAgentReport,
  parseJsonl,
  parseVitestCounts,
  renderSummary,
  renderSummaryEntry,
  residualHoldIds,
  succeededFindings,
} from "./evaluate.mjs";

const LOOP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(LOOP_DIR, "..", "..");
const THROWAWAY_PREFIX = "redteam/loop/lap-";

const EXIT = { converged: 0, driverError: 1, wakeHuman: 2, lapsExhausted: 3 };

class DriverError extends Error {
  constructor(what, remedy) {
    super(`${what}\n  try: ${remedy}`);
    this.name = "DriverError";
    this.what = what;
    this.remedy = remedy;
  }
}

const HELP = `
red-team loop driver

  node redteam/loop/driver.mjs [options]

Options
  --max-laps <n>            stop after this many laps (default 3)
  --start-lap <n>           first lap number (default: one past the newest lap in state)
  --state <dir>             state directory (default redteam/loop/state, or state-dryrun)
  --fixer-cmd <cmd>         fixer executable (default claude)
  --attacker-cmd <cmd>      attacker executable (default grok)
  --fixer-args <args>       extra fixer argv, space separated (repeatable)
  --attacker-args <args>    extra attacker argv, space separated (repeatable)
  --auto-approve            add each agent's own approval-bypass flag to its argv
  --agent-timeout <min>     kill an agent that runs this long (default 60)
  --dry-run                 no agents, no git, no gates: replay canned stdout from --fixtures
  --fixtures <dir>          dry-run fixture directory (default redteam/loop/fixtures)
  --allow-dirty             do not require a clean tree at start
  --allow-main              permit running with main or master as the base branch
  --quiet                   do not stream agent output to the console
  --help

Approval posture is the operator's call, not the driver's default: without --auto-approve the
fixer runs with --permission-mode acceptEdits and the attacker runs with no bypass at all, so a
tool call needing approval will fail rather than be granted silently. The exact argv is printed
before each agent starts.

Exit codes: 0 converged, 1 driver error, 2 wake human, 3 max laps reached.
`.trimStart();

function parseArgs(argv) {
  const options = {
    maxLaps: 3,
    startLap: null,
    stateDir: null,
    fixerCmd: "claude",
    attackerCmd: "grok",
    fixerArgs: [],
    attackerArgs: [],
    autoApprove: false,
    agentTimeoutMs: 60 * 60 * 1000,
    dryRun: false,
    fixturesDir: join(LOOP_DIR, "fixtures"),
    allowDirty: false,
    allowMain: false,
    quiet: false,
  };
  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined) throw new DriverError(`${flag} needs a value`, `${flag} <value>`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      case "--max-laps":
        options.maxLaps = Number(readValue(index, flag));
        index += 1;
        break;
      case "--start-lap":
        options.startLap = Number(readValue(index, flag));
        index += 1;
        break;
      case "--state":
        options.stateDir = readValue(index, flag);
        index += 1;
        break;
      case "--fixer-cmd":
        options.fixerCmd = readValue(index, flag);
        index += 1;
        break;
      case "--attacker-cmd":
        options.attackerCmd = readValue(index, flag);
        index += 1;
        break;
      case "--fixer-args":
        options.fixerArgs.push(...readValue(index, flag).split(/\s+/).filter(Boolean));
        index += 1;
        break;
      case "--attacker-args":
        options.attackerArgs.push(...readValue(index, flag).split(/\s+/).filter(Boolean));
        index += 1;
        break;
      case "--auto-approve":
        options.autoApprove = true;
        break;
      case "--agent-timeout":
        options.agentTimeoutMs = Number(readValue(index, flag)) * 60 * 1000;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--fixtures":
        options.fixturesDir = resolvePath(readValue(index, flag));
        index += 1;
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--allow-main":
        options.allowMain = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        throw new DriverError(`unknown flag ${flag}`, "node redteam/loop/driver.mjs --help");
    }
  }
  if (!Number.isInteger(options.maxLaps) || options.maxLaps < 1) {
    throw new DriverError("--max-laps must be a positive integer", "--max-laps 3");
  }
  if (options.startLap !== null && (!Number.isInteger(options.startLap) || options.startLap < 1)) {
    throw new DriverError("--start-lap must be a positive integer", "--start-lap 1");
  }
  const defaultState = options.dryRun ? "state-dryrun" : "state";
  options.stateDir = options.stateDir ? resolvePath(options.stateDir) : join(LOOP_DIR, defaultState);
  return options;
}

function resolvePath(candidate) {
  return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function banner(message) {
  log("");
  log(`=== ${message} ===`);
}

/** Run a child process to completion, buffering stdout and optionally mirroring it. */
function run(command, args, { cwd = REPO_ROOT, timeoutMs = 0, echo = false, label = "" } = {}) {
  return new Promise((settle) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      settle({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut, spawnError: error });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      settle({ code, stdout, stderr, timedOut, spawnError: null, label });
    });
  });
}

async function git(args, options = {}) {
  const outcome = await run("git", args, options);
  if (outcome.spawnError) {
    throw new DriverError(`could not run git ${args.join(" ")}`, "check that git is on PATH");
  }
  return outcome;
}

async function gitOrThrow(args) {
  const outcome = await git(args);
  if (outcome.code !== 0) {
    throw new DriverError(
      `git ${args.join(" ")} failed with code ${outcome.code}: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
      "resolve the repository state by hand, then rerun with --start-lap",
    );
  }
  return outcome.stdout.trim();
}

async function currentBranch() {
  return gitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function treeIsDirty() {
  const status = await gitOrThrow(["status", "--porcelain"]);
  return status !== "";
}

async function branchExists(name) {
  const outcome = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
  return outcome.code === 0;
}

async function commitAll(message) {
  await gitOrThrow(["add", "-A"]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) return null;
  await gitOrThrow(["commit", "-m", message]);
  return gitOrThrow(["rev-parse", "--short", "HEAD"]);
}

async function pathExistsOnBranch(branch, path) {
  const outcome = await git(["cat-file", "-e", `${branch}:${path}`]);
  return outcome.code === 0;
}

/**
 * Which regression-test paths the succeeded rows cite that the recorded branch actually carries.
 *
 * The branch is the one the attacker left HEAD on, not the one this driver cut, because an
 * attacker that branches again under the throwaway commits its work there. Resolving citations
 * against the branch we assumed rather than the branch that took the commits would report every
 * real artifact as missing, and would name an empty ref in the summary as though it held them.
 */
async function resolveCitedArtifacts(branch, attackerRows) {
  const cited = [
    ...new Set(
      succeededFindings(attackerRows)
        .map((row) => normalizeCitation(row.regression_test))
        .filter((path) => path !== null),
    ),
  ];
  const presentPaths = [];
  for (const path of cited) {
    if (await pathExistsOnBranch(branch, path)) presentPaths.push(path);
  }
  return { checked: true, branch, presentPaths, citedPaths: cited };
}

function statePath(options, name) {
  return join(options.stateDir, name);
}

function rawPath(options, name) {
  return join(options.stateDir, "raw", name);
}

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeState(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function rowsToJsonl(rows) {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

/** Fill a prompt template, refusing to run a prompt whose placeholder never got substituted. */
function fillPrompt(templatePath, placeholder, body) {
  const template = readIfPresent(templatePath);
  if (template === null) {
    throw new DriverError(`missing prompt template ${templatePath}`, "restore the file from git");
  }
  if (!template.includes(placeholder)) {
    throw new DriverError(
      `${templatePath} has no ${placeholder} placeholder`,
      `add ${placeholder} to the template where the driver should substitute`,
    );
  }
  const filled = template.split(placeholder).join(body);
  if (filled.includes(placeholder)) {
    throw new DriverError(`${placeholder} survived substitution`, "check the template for nesting");
  }
  return filled;
}

function highestLapInState(options) {
  if (!existsSync(options.stateDir)) return 0;
  let highest = 0;
  for (const entry of readdirSafe(options.stateDir)) {
    const match = /^lap-(\d+)-(attacker|fixer)\.jsonl$/.exec(entry);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Read the prior lap's attacker rows. Lap 1 has none, which is the empty findings case. */
function readPriorAttackerRows(options, lap) {
  const path = statePath(options, `lap-${lap - 1}-attacker.jsonl`);
  const contents = readIfPresent(path);
  if (contents === null) return { rows: [], errors: [], present: false, path };
  const { rows, errors } = parseJsonl(contents);
  return { rows, errors, present: true, path };
}

function readPriorTestCount(options, lap) {
  const contents = readIfPresent(rawPath(options, `lap-${lap - 1}-gates.txt`));
  if (contents === null) return null;
  return parseVitestCounts(contents).testsPassed;
}

function fixerArgv(options, prompt) {
  const argv = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (options.autoApprove) argv.push("--dangerously-skip-permissions");
  else argv.push("--permission-mode", "acceptEdits");
  argv.push(...options.fixerArgs);
  return argv;
}

function attackerArgv(options, prompt) {
  const argv = ["-p", prompt];
  if (options.autoApprove) argv.push("--always-approve");
  argv.push(...options.attackerArgs);
  return argv;
}

/** Print the argv without dumping the whole prompt into the log. */
function describeArgv(command, argv) {
  const shown = argv.map((entry) => (entry.length > 60 ? `<prompt ${entry.length} chars>` : entry));
  return `${command} ${shown.join(" ")}`;
}

async function runAgent(options, { command, argv, label, fixtureFile }) {
  if (options.dryRun) {
    const path = join(options.fixturesDir, fixtureFile);
    const contents = readIfPresent(path);
    if (contents === null) {
      throw new DriverError(
        `dry run has no fixture at ${path}`,
        "add the fixture or point --fixtures at a directory that has it",
      );
    }
    log(`[dry-run] ${label}: replaying ${path} instead of ${describeArgv(command, argv)}`);
    return { stdout: contents, code: 0, timedOut: false };
  }
  log(`[${label}] ${describeArgv(command, argv)}`);
  const outcome = await run(command, argv, {
    timeoutMs: options.agentTimeoutMs,
    echo: !options.quiet,
    label,
  });
  if (outcome.spawnError) {
    throw new DriverError(
      `could not start ${command} for the ${label}`,
      `check that ${command} is on PATH, or pass --${label}-cmd`,
    );
  }
  return outcome;
}

async function runGates(options, lap) {
  if (options.dryRun) {
    const path = join(options.fixturesDir, `lap-${lap}-gates.txt`);
    const contents = readIfPresent(path);
    if (contents === null) {
      throw new DriverError(`dry run has no gates fixture at ${path}`, "add the fixture");
    }
    const passed = /\[exit 0\]/.test(contents);
    log(`[dry-run] gates: replaying ${path}`);
    return { output: contents, passed, counts: parseVitestCounts(contents) };
  }
  banner(`lap ${lap}: npm run gates`);
  const outcome = await run("npm", ["run", "gates"], { echo: !options.quiet });
  const output = `${outcome.stdout}${outcome.stderr}\n[exit ${outcome.code}]\n`;
  return { output, passed: outcome.code === 0, counts: parseVitestCounts(output) };
}

async function runFixStep(options, lap, priorSucceeded) {
  const problems = [];
  if (priorSucceeded.length === 0) {
    log(`lap ${lap}: no prior succeeded findings, skipping the fix step`);
    writeState(statePath(options, `lap-${lap}-fixer.jsonl`), "");
    return { rows: [], problems, skipped: true };
  }

  const findings = formatFindingsForPrompt(priorSucceeded);
  banner(`lap ${lap}: fixer over ${priorSucceeded.length} finding(s)`);
  log(findings);
  const prompt = fillPrompt(join(LOOP_DIR, "fixer-prompt.md"), "{{FINDINGS}}", findings);
  writeState(rawPath(options, `lap-${lap}-fixer-prompt.txt`), prompt);

  const outcome = await runAgent(options, {
    command: options.fixerCmd,
    argv: fixerArgv(options, prompt),
    label: "fixer",
    fixtureFile: `lap-${lap}-fixer.stdout.txt`,
  });
  writeState(rawPath(options, `lap-${lap}-fixer.stdout.txt`), outcome.stdout);

  if (outcome.timedOut) problems.push(`lap ${lap} fixer was killed after the agent timeout`);
  if (outcome.code !== 0) problems.push(`lap ${lap} fixer exited with code ${outcome.code}`);

  const report = parseAgentReport(outcome.stdout, { streamJson: true });
  if (report.block === null) problems.push(`lap ${lap} fixer emitted no jsonl block`);
  for (const error of report.errors) {
    problems.push(`lap ${lap} fixer jsonl line ${error.line} did not parse: ${error.message}`);
  }
  writeState(statePath(options, `lap-${lap}-fixer.jsonl`), rowsToJsonl(report.rows));
  log(`lap ${lap}: fixer reported ${report.rows.length} item(s)`);
  return { rows: report.rows, problems, skipped: false };
}

async function runAttackStep(options, lap, fixerRows, baseBranch) {
  const problems = [];
  const focus = formatFocusFromFixerItems(fixerRows);
  // Held in memory rather than written now: anything on disk when the branch is cut follows the
  // attacker onto the throwaway branch and is gone again on the way back to base.
  const prompt = fillPrompt(join(LOOP_DIR, "attacker-prompt.md"), "{{FOCUS}}", focus);

  const throwaway = `${THROWAWAY_PREFIX}${lap}`;
  if (!options.dryRun) {
    if (await branchExists(throwaway)) {
      throw new DriverError(
        `throwaway branch ${throwaway} already exists`,
        "rerun with a --start-lap past the laps already on disk, or delete the stale branch by hand",
      );
    }
    banner(`lap ${lap}: attacker on ${throwaway}`);
    await gitOrThrow(["checkout", "-b", throwaway]);
  } else {
    banner(`lap ${lap}: attacker (dry run, no branch created)`);
  }

  let outcome;
  let attackerBranch = null;
  try {
    outcome = await runAgent(options, {
      command: options.attackerCmd,
      argv: attackerArgv(options, prompt),
      label: "attacker",
      fixtureFile: `lap-${lap}-attacker.stdout.txt`,
    });
  } finally {
    if (!options.dryRun) {
      // Read HEAD before committing: the commit lands wherever the attacker left it, and an
      // attacker that cut its own branch under the throwaway leaves the throwaway empty. The
      // branch recorded from here on is the one that holds the work, not the one we cut.
      attackerBranch = await currentBranch();
      if (attackerBranch === baseBranch) {
        throw new DriverError(
          `the attacker left HEAD on ${baseBranch}, so committing its work would put it on the base branch`,
          `inspect the tree by hand: the attacker must stay on ${throwaway} or a branch under it`,
        );
      }
      // The attacker's regression tests and golden cases stay on its branch. Committing them
      // here is what lets the checkout back to base leave every one of them behind.
      await commitAll(`red-team loop lap ${lap}: attacker findings on ${attackerBranch}`);
      await gitOrThrow(["checkout", baseBranch]);
      const landedOn = await currentBranch();
      if (landedOn !== baseBranch) {
        throw new DriverError(
          `expected to return to ${baseBranch} after the attacker lap, landed on ${landedOn}`,
          "check out the base branch by hand before rerunning",
        );
      }
      if (await treeIsDirty()) {
        throw new DriverError(
          `the tree is dirty after returning to ${baseBranch}, so attacker work may have followed the checkout`,
          "inspect git status and reset the base branch by hand before rerunning",
        );
      }
    }
  }

  writeState(rawPath(options, `lap-${lap}-attacker-prompt.txt`), prompt);
  writeState(rawPath(options, `lap-${lap}-attacker.stdout.txt`), outcome.stdout);
  if (outcome.timedOut) problems.push(`lap ${lap} attacker was killed after the agent timeout`);
  if (outcome.code !== 0) problems.push(`lap ${lap} attacker exited with code ${outcome.code}`);

  const report = parseAgentReport(outcome.stdout, { streamJson: false });
  if (report.block === null) problems.push(`lap ${lap} attacker emitted no jsonl block`);
  for (const error of report.errors) {
    problems.push(`lap ${lap} attacker jsonl line ${error.line} did not parse: ${error.message}`);
  }
  writeState(statePath(options, `lap-${lap}-attacker.jsonl`), rowsToJsonl(report.rows));
  log(`lap ${lap}: attacker reported ${report.rows.length} row(s)`);

  const artifactBacking = options.dryRun
    ? { checked: false, branch: null, presentPaths: [], citedPaths: [] }
    : await resolveCitedArtifacts(attackerBranch, report.rows);
  if (artifactBacking.checked) {
    const missing = artifactBacking.citedPaths.filter(
      (path) => !artifactBacking.presentPaths.includes(path),
    );
    log(
      `lap ${lap}: ${artifactBacking.presentPaths.length} of ${artifactBacking.citedPaths.length} cited artifact path(s) present on ${attackerBranch}`,
    );
    for (const path of missing) {
      log(`lap ${lap}: cited artifact ${path} is NOT on ${attackerBranch}`);
    }
  }
  return { rows: report.rows, problems, throwaway, attackerBranch, artifactBacking };
}

function appendSummary(options, evaluation, itemsFixed) {
  const path = statePath(options, "summary.md");
  if (!existsSync(path)) {
    writeState(path, "# red-team loop\n\nOne section per lap, appended by redteam/loop/driver.mjs.\n\n");
  }
  appendFileSync(path, renderSummaryEntry(evaluation, { itemsFixed, timestamp: new Date().toISOString() }));
}

async function runLap(options, lap, baseBranch) {
  banner(`lap ${lap}`);
  const prior = readPriorAttackerRows(options, lap);
  const priorSucceeded = succeededFindings(prior.rows);
  const priorResidualIds = prior.present ? residualHoldIds(prior.rows) : null;
  const priorTestCount = readPriorTestCount(options, lap);

  const fix = await runFixStep(options, lap, priorSucceeded);

  const gates = await runGates(options, lap);
  writeState(rawPath(options, `lap-${lap}-gates.txt`), gates.output);
  log(
    `lap ${lap}: gates ${gates.passed ? "pass" : "FAIL"}, ${gates.counts.testsPassed ?? "unknown"} tests passed`,
  );

  const itemsFixed = fix.rows.map((row) => String(row.item ?? "?"));
  if (!options.dryRun) {
    const closes = priorSucceeded.map((row) => row.id).join(", ");
    const subject = fix.skipped
      ? `red-team loop lap ${lap}: no fix pass, gates baseline`
      : `red-team loop lap ${lap}: fix ${itemsFixed.map((item) => `item ${item}`).join(", ") || "no items"}${closes ? ` (closes ${closes})` : ""}`;
    const sha = await commitAll(subject);
    log(`lap ${lap}: ${sha ? `committed ${sha}` : "nothing to commit"}`);
  }

  const attack = await runAttackStep(options, lap, fix.rows, baseBranch);

  if (!options.dryRun) {
    const sha = await commitAll(`red-team loop lap ${lap}: attacker report and lap summary`);
    if (sha) log(`lap ${lap}: recorded attacker report in ${sha}`);
  }

  const evaluation = evaluateLap({
    lap,
    attackerRows: attack.rows,
    fixerRows: fix.rows,
    priorResidualIds,
    gates: { passed: gates.passed, testsPassed: gates.counts.testsPassed },
    priorTestCount,
    reportProblems: [...prior.errors.map((e) => `prior attacker jsonl line ${e.line}: ${e.message}`), ...fix.problems, ...attack.problems],
    artifactBacking: attack.artifactBacking,
    attackerBranch: attack.attackerBranch,
  });

  appendSummary(options, evaluation, itemsFixed);
  if (!options.dryRun) await commitAll(`red-team loop lap ${lap}: summary`);

  return { evaluation, attackerBranch: attack.attackerBranch };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(join(options.stateDir, "raw"), { recursive: true });

  let baseBranch = null;
  if (!options.dryRun) {
    baseBranch = await currentBranch();
    if (!options.allowMain && (baseBranch === "main" || baseBranch === "master")) {
      throw new DriverError(
        `refusing to run with ${baseBranch} as the base branch: the fixer commits to it`,
        "check out a working branch first, or pass --allow-main if you really mean it",
      );
    }
    if (!options.allowDirty && (await treeIsDirty())) {
      throw new DriverError(
        "the working tree is dirty and the driver commits everything it finds",
        "commit or stash your changes, or pass --allow-dirty",
      );
    }
    log(`base branch: ${baseBranch}`);
  } else {
    log("dry run: no agents, no gates, no git");
  }
  log(`state: ${options.stateDir}`);

  const firstLap = options.startLap ?? highestLapInState(options) + 1;
  const lastLap = firstLap + options.maxLaps - 1;
  log(`laps ${firstLap} through ${lastLap}`);

  let final = null;
  for (let lap = firstLap; lap <= lastLap; lap += 1) {
    const { evaluation, attackerBranch } = await runLap(options, lap, baseBranch);
    final = evaluation;
    banner(`lap ${lap}: ${evaluation.decision}`);
    log(renderSummary(evaluation));
    if (attackerBranch && !options.dryRun) {
      log(`\nattacker branch ${attackerBranch} is left unmerged, as it must be.`);
    }
    if (evaluation.decision === DECISION.wake) {
      log("\nstopping for a human.");
      return EXIT.wakeHuman;
    }
    if (evaluation.decision === DECISION.converged) {
      log("\nconverged.");
      return EXIT.converged;
    }
  }
  log(`\nreached --max-laps ${options.maxLaps} without converging; last decision ${final?.decision}.`);
  return EXIT.lapsExhausted;
}

// Setting exitCode rather than calling process.exit: this driver's output is meant to be piped
// into a log, and exiting outright can cut a pending write off mid-summary.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof DriverError) {
      process.stderr.write(`driver error: ${error.message}\n`);
    } else {
      process.stderr.write(`driver error: ${error?.stack ?? error}\n`);
    }
    process.exitCode = EXIT.driverError;
  });

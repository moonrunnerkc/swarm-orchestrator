#!/usr/bin/env node
/**
 * The visible requirement checks of one goal contract, run the way ordinary CI would run them:
 * every artifact written where the contract puts it, every command through `sh -c`, every CLI
 * behaviour compared on exit status and bounded output, every sealed browser instrument run by the
 * image's own Playwright. This is the translation the plain-CI and VERA arms receive, so it has
 * no dependency beyond Node itself and runs inside whatever image the arm's checks run in.
 *
 *   node visible-runner.mjs <contract.json> [--json <out>] [--from-tree]
 *
 * Exit 0 only when every check passed. A check that could not be judged (output past its bound,
 * a missing browser, an unparseable report) is a failure here, since CI has no third answer.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const matches = (actual, assertions) =>
  assertions.every((assertion) =>
    assertion.kind === "equals" ? actual === assertion.value : actual.includes(assertion.value),
  );

function runCli(behavior, root) {
  const ran = spawnSync(behavior.argv[0], behavior.argv.slice(1), {
    cwd: resolve(root, behavior.cwd),
    input: behavior.stdin ?? "",
    timeout: behavior.timeoutMs,
    maxBuffer: behavior.maxOutputBytes,
    env: { ...process.env, ...(behavior.environment ?? {}) },
    encoding: "utf8",
  });
  if (ran.error !== undefined)
    return { passed: false, detail: `did not complete: ${ran.error.code ?? ran.error.message}` };
  const passed =
    ran.status === behavior.exitCode &&
    matches(ran.stdout, behavior.stdout) &&
    matches(ran.stderr, behavior.stderr);
  return {
    passed,
    detail: `exit ${ran.status}; stdout ${JSON.stringify(ran.stdout.slice(0, 200))}`,
  };
}

function runBrowser(check, behavior, root) {
  const directory = join(root, ".campaign", `instrument-${check.id}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "instrument.spec.mjs"), behavior.instrument.source);
  writeFileSync(
    join(directory, "playwright.config.mjs"),
    `export default { testDir: ${JSON.stringify(directory)}, testMatch: "instrument.spec.mjs", workers: 1, retries: 0, forbidOnly: true, reporter: [["json"]], projects: [{ name: "chromium", use: { browserName: "chromium" } }] };\n`,
  );
  const ran = spawnSync(
    "node",
    [
      "/opt/swarm-browser/node_modules/@playwright/test/cli.js",
      "test",
      "-c",
      join(directory, "playwright.config.mjs"),
    ],
    {
      cwd: directory,
      timeout: behavior.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(behavior.environment ?? {}), SWARM_SUBJECT_DIRECTORY: root },
      encoding: "utf8",
    },
  );
  let report;
  try {
    report = JSON.parse(ran.stdout);
  } catch {
    return { passed: false, detail: `no Playwright report (exit ${ran.status})` };
  }
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        results.push({ title: spec.title, status: test.results?.at(-1)?.status });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  const passedTitles = results.filter((one) => one.status === "passed").map((one) => one.title);
  const passed =
    results.length === behavior.expectedTests &&
    behavior.instrument.titles.every((title) => passedTitles.includes(title));
  return { passed, detail: `${passedTitles.length} of ${results.length} passed` };
}

/**
 * `fromTree` reads the acceptance files the tree already holds (committed acceptance material, as
 * the plain-CI and VERA workflow arms keep it) instead of writing them from the contract.
 */
export function runVisibleChecks(contract, root, { fromTree = false } = {}) {
  const readings = [];
  for (const check of contract.checks) {
    for (const artifact of fromTree ? [] : check.artifacts) {
      const path = join(root, artifact.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, artifact.content);
      chmodSync(path, 0o444);
    }
    const behavior = check.behavior;
    let reading;
    if (behavior?.kind === "cli") reading = runCli(behavior, root);
    else if (behavior?.kind === "browser" && behavior.instrument !== undefined)
      reading = runBrowser(check, behavior, root);
    else {
      const ran = spawnSync("sh", ["-c", check.command], {
        cwd: root,
        timeout: 900_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      });
      reading = {
        passed: ran.error === undefined && ran.status === 0,
        detail:
          ran.error === undefined ? `exit ${ran.status}` : `did not complete: ${ran.error.code}`,
      };
    }
    readings.push({ id: check.id, ...reading });
  }
  return readings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [contractPath, ...rest] = process.argv.slice(2);
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const readings = runVisibleChecks(contract, process.cwd(), {
    fromTree: rest.includes("--from-tree"),
  });
  const jsonAt = rest.indexOf("--json");
  if (jsonAt !== -1) writeFileSync(rest[jsonAt + 1], `${JSON.stringify(readings)}\n`);
  for (const reading of readings)
    console.log(`${reading.passed ? "pass" : "FAIL"} ${reading.id}: ${reading.detail}`);
  process.exit(readings.every((reading) => reading.passed) ? 0 : 1);
}

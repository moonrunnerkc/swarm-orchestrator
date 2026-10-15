/**
 * A fake arm for the stop-control tests, standing in for both products. The runner invokes it
 * exactly as it invokes the real ones: as `node arm.mjs <prompt> --workspace <dir> ...` when
 * the manifest pins it as the Swarm CLI, and through an `opencode` shim on PATH as
 * `opencode run --dir <dir> ... <prompt>`. It leaves two markers under COMPARISON_FIXTURE_DIR:
 *
 * - `launches.log`: one line per invocation, `<arm> <initial|correction> <pid> <ms>`, which is
 *   how a test counts launches and corrections that actually started;
 * - `heartbeat`: touched every 200 ms while the arm is alive, which is how a test establishes
 *   when an owned child process stopped.
 *
 * COMPARISON_FIXTURE_BEHAVIOR picks what it does in the workspace:
 *
 * - `correct`: writes the fix the hidden oracle accepts;
 * - `wrong`: writes a change the visible check rejects, so the supervisor corrects it;
 * - `hang`: edits nothing and runs until killed;
 * - `empty`: exits 0 having printed nothing, the shape of an arm whose runtime never started;
 * - `connect-error`: prints OpenCode's "Unable to connect" error event and exits 0;
 * - `missing-evidence`: reports a Swarm result whose evidence directory does not exist;
 * - `exit-unavailable`: exits with Swarm's "could not proceed" status (4) after one event;
 * - `chmod-runs`: writes the fix, then removes write permission from COMPARISON_FIXTURE_RUNS_DIR
 *   so the harness cannot persist the record;
 * - `external-kill`: kills itself with SIGTERM, a signal the harness did not send.
 */
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const markers = process.env.COMPARISON_FIXTURE_DIR;
const words = process.argv.slice(2);

/**
 * The product's own `check` command, as the preflight invokes it: `node arm.mjs check
 * --workspace <dir> --json`. It reads the swarm.toml the harness wrote and reports what it would
 * run as its tests gate, shaped as the real `swarm.check.v1` report. COMPARISON_FIXTURE_CHECK
 * picks the fault:
 *
 * - `honest` (default): the gate is the override's command and it passes;
 * - `ignore-override`: the gate is the manifest's own `npm run --loglevel=error test`, which is
 *   what the product did before overrides were written;
 * - `prerequisite-missing`: the gate is the override's command and it fails for a browser that
 *   is not installed under the home it was given.
 */
if (words[0] === "check") {
  const workspace = words[words.indexOf("--workspace") + 1];
  const toml = existsSync(join(workspace, "swarm.toml"))
    ? readFileSync(join(workspace, "swarm.toml"), "utf8")
    : "";
  const override = /\[gates\.tests\]\s*\ncommand = "([^"]*)"/.exec(toml)?.[1] ?? null;
  const fault = process.env.COMPARISON_FIXTURE_CHECK ?? "honest";
  const home = process.env.SWARM_CHILD_HOME ?? process.env.HOME;
  const tests =
    fault === "ignore-override"
      ? {
          command: "npm run --loglevel=error test",
          status: "passed",
          detail: "the command exited 0",
        }
      : fault === "prerequisite-missing"
        ? {
            command: override,
            status: "failed",
            detail: "the command exited 1",
            output: `browserType.launch: Executable doesn't exist at ${home}/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell`,
          }
        : { command: override, status: "passed", detail: "the command exited 0" };
  const failed = tests.status !== "passed";
  console.log(
    JSON.stringify({
      schema: "swarm.check.v1",
      plan: { version: "swarm.check-plan.v1", workspace },
      tree: null,
      conclusions: {
        command: { status: "ran", detail: tests.detail },
        checks: [{ id: "tests", severity: "blocking", measures: {}, ...tests }],
        executionTrust: { mode: "restricted", detail: "fixture" },
        requirements: { status: "unmeasured", detail: "fixture" },
        challenges: { status: "none", detail: "fixture" },
      },
      result: failed ? "fail" : "pass",
      exitCode: failed ? 1 : 0,
      bundleDirectory: null,
    }),
  );
  process.exit(failed ? 1 : 0);
}

const arm = words[0] === "opencode" ? "opencode" : "swarm";
// A behavior that only one product can exhibit leaves the other arm correct, so a test can
// name the arm the halt should attribute it to.
const swarmOnly = ["missing-evidence", "exit-unavailable"];
const opencodeOnly = ["connect-error"];
const requested = process.env.COMPARISON_FIXTURE_BEHAVIOR ?? "correct";
const behavior =
  (swarmOnly.includes(requested) && arm !== "swarm") ||
  (opencodeOnly.includes(requested) && arm !== "opencode")
    ? "correct"
    : requested;
const flag = (name) => words[words.indexOf(name) + 1];
const workspace = arm === "swarm" ? flag("--workspace") : flag("--dir");
const prompt = arm === "swarm" ? words[0] : words.at(-1);
const kind = /still fail after the previous attempt/.test(prompt) ? "correction" : "initial";

mkdirSync(markers, { recursive: true });
// The home this invocation's processes were given, and whether another launch's sentinel is
// already in it: Swarm reads SWARM_CHILD_HOME for its children, OpenCode inherits HOME. A
// launch that finds a sentinel was handed state another launch prepared.
const home = (arm === "swarm" ? process.env.SWARM_CHILD_HOME : undefined) ?? process.env.HOME;
const sentinels = existsSync(home)
  ? readdirSync(home).filter((name) => name.startsWith("installed-by-")).length
  : 0;
writeFileSync(join(home, `installed-by-${process.pid}`), "");
appendFileSync(
  join(markers, "launches.log"),
  `${arm} ${kind} ${process.pid} ${Date.now()} home=${home} found=${sentinels}\n`,
);
const heartbeat = join(markers, "heartbeat");
writeFileSync(heartbeat, "");
const beat = setInterval(() => {
  const now = new Date();
  utimesSync(heartbeat, now, now);
}, 200);

const write = (source) => writeFileSync(join(workspace, "calc.mjs"), source);
const swarmLines = (acceptable, bundleDirectory) => [
  JSON.stringify({
    schema: "swarm.event.v1",
    runId: "fixture",
    event: { type: "stopped", reason: "completed", tokensUsed: 1234 },
  }),
  JSON.stringify({
    schema: "swarm.result.v1",
    runId: "fixture",
    verdict: { acceptable },
    bundleDirectory,
    exitCode: acceptable ? 0 : 1,
  }),
];
const opencodeLines = () => [
  JSON.stringify({ type: "step_start" }),
  JSON.stringify({ type: "text", part: { type: "text", text: "done" } }),
  JSON.stringify({
    type: "step_finish",
    part: { type: "step-finish", tokens: { input: 1000, output: 234 } },
  }),
];

function finish(acceptable, code = acceptable ? 0 : 1) {
  clearInterval(beat);
  const bundle = join(markers, "evidence", `run-${process.pid}`, "bundle");
  if (arm === "swarm") {
    mkdirSync(bundle, { recursive: true });
    console.log(swarmLines(acceptable, bundle).join("\n"));
  } else console.log(opencodeLines().join("\n"));
  process.exit(code);
}

switch (behavior) {
  case "correct":
    write("export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
    finish(true);
    break;
  case "wrong":
    write("export const add = (a, b) => a * b;\nexport const mul = (a, b) => a * b;\n");
    finish(true);
    break;
  case "hang":
    break;
  case "empty":
    clearInterval(beat);
    process.exit(0);
    break;
  case "connect-error":
    clearInterval(beat);
    console.log(
      JSON.stringify({
        type: "error",
        error: {
          name: "UnknownError",
          data: { message: "Unable to connect. Is the computer able to access the url?" },
        },
      }),
    );
    process.exit(0);
    break;
  case "missing-evidence":
    clearInterval(beat);
    console.log(swarmLines(true, join(markers, "evidence", "never-written", "bundle")).join("\n"));
    process.exit(0);
    break;
  case "exit-unavailable":
    clearInterval(beat);
    console.log(swarmLines(false, null)[0]);
    process.exit(4);
    break;
  case "chmod-runs":
    write("export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
    chmodSync(process.env.COMPARISON_FIXTURE_RUNS_DIR, 0o500);
    finish(true);
    break;
  case "external-kill":
    process.kill(process.pid, "SIGTERM");
    break;
  default:
    throw new Error(`unknown fixture behavior ${behavior}`);
}

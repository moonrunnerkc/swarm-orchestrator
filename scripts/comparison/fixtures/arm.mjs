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
import { appendFileSync, chmodSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const markers = process.env.COMPARISON_FIXTURE_DIR;
const words = process.argv.slice(2);
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
appendFileSync(join(markers, "launches.log"), `${arm} ${kind} ${process.pid} ${Date.now()}\n`);
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

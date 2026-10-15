/**
 * The two arms, given the same task text, the same visible check in the tree, the same prepared
 * workspace, the same model and the same wall budget. What differs is the product:
 *
 * - swarm: this repository's agent at the pinned revision, with the visible check sealed as a
 *   goal contract outside the solver's reach (`--goal-contract`, no preset for a bugfix, feature
 *   or refactor; `--preset upgrade --install` for an upgrade, as the product requires), its own
 *   acceptance gate, bounded repair and final independent verification.
 * - opencode: OpenCode's `run` command, non-interactive, with edit and shell permission granted
 *   in the workspace configuration, the same model through the same endpoint.
 *
 * External supervision is one deterministic rule applied to both: after an invocation the
 * supervisor measures the visible verdict in a fresh checkout; on failure it re-invokes the arm
 * once with the failing output, at most twice. Every re-invocation is a scripted correction,
 * counted as such; it is a proxy for supervision, never an observation of a person.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const wallBudgetMs = 30 * 60_000;
export const swarmTokenCap = 600_000;
export const maxCorrections = 2;

/**
 * The environment name the product reads for the HOME its child processes get
 * (src/exec/child-environment.ts). Set per launch to a fresh directory, so a browser one
 * launch's repair downloads is not there for the next launch's gate.
 */
export const swarmChildHomeName = "SWARM_CHILD_HOME";

export function taskPrompt(task) {
  return [
    task.taskText.trim(),
    "",
    `Visible acceptance check (it must pass; it is not the only criterion): ${task.visible.command}`,
    `The project's own tests run with: ${task.projectTest.join(" ")}`,
    `Do not modify anything under ${task.visible.path.split("/").slice(0, -1).join("/")}/.`,
  ].join("\n");
}

export function correctionPrompt(task, detail) {
  return [
    taskPrompt(task),
    "",
    "The checks below still fail after the previous attempt in this workspace. Fix them in the",
    "same workspace; the earlier edits are still present.",
    "",
    detail,
  ].join("\n");
}

/** The sealed contract swarm receives: the visible check as a shared user-authored command check. */
export function swarmContract(task) {
  const preset =
    task.workType === "upgrade"
      ? {
          kind: "upgrade",
          manager: "npm",
          manifest: "package.json",
          lockfile: "package-lock.json",
          dependencies: (task.hidden.upgrade ?? []).map((one) => ({
            name: one.name,
            section: one.section,
            version: one.version,
          })),
          sourcePaths: task.upgradeSourcePaths ?? [],
        }
      : undefined;
  return {
    version: 1,
    goal: task.taskText.trim().split("\n")[0].slice(0, 400),
    ...(preset === undefined ? {} : { preset }),
    requirements: [
      {
        id: "visible-check",
        description: "the visible acceptance check passes on a fresh checkout",
        checks: ["visible-check"],
      },
    ],
    checks: [
      {
        id: "visible-check",
        command: task.visible.command,
        author: "user",
        exposure: "shared",
        artifacts: [],
      },
    ],
    immutablePaths: [task.visible.path.split("/").slice(0, -1).join("/"), ...task.immutable],
  };
}

export function swarmArgv(pins, task, workspace, base, prompt, contractPath, remainingMs) {
  return [
    "node",
    pins.swarmCli,
    prompt,
    "--model",
    `local:${pins.model}`,
    "--local-endpoint",
    pins.endpoint,
    "--workspace",
    workspace,
    "--base",
    base,
    "--goal-contract",
    contractPath,
    ...(task.workType === "upgrade" ? ["--preset", "upgrade"] : []),
    "--install",
    // The same lockfile the harness installed every workspace from: fast-xml-parser keeps a
    // yarn.lock beside its package-lock.json, and the verifier refuses to guess between them.
    "--lockfile",
    "package-lock.json",
    "--max-tokens",
    String(swarmTokenCap),
    "--max-wall-minutes",
    String(Math.max(1, Math.floor(remainingMs / 60_000))),
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
  ];
}

/**
 * The directory is named on the command line as well as being the cwd: OpenCode's runtime reads
 * the inherited PWD variable, which for a spawned process still names the launcher's directory,
 * and a run that read the wrong directory found no workspace configuration and exited at once
 * with nothing printed.
 */
export function opencodeArgv(pins, prompt, workspace) {
  return [
    "opencode",
    "run",
    "--dir",
    workspace,
    "--pure",
    "--format",
    "json",
    "-m",
    `rapidmlx/${pins.model}`,
    // Left to itself OpenCode names the session with a second model call on the same endpoint,
    // issued while the first turn is still being prefilled. Two sequences at once took the
    // local server past its memory and it died mid-launch; a given title asks for no name.
    "--title",
    "comparison launch",
    prompt,
  ];
}

/** swarm's `swarm.result.v1` line, or null where the run wrote none. */
export function swarmResult(stdout) {
  for (const line of stdout.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === "swarm.result.v1") return parsed;
    } catch {}
  }
  return null;
}

/** Tokens swarm's events report, input and output combined, over every loop; null where none. */
export function swarmTokens(stdout) {
  let total = 0;
  let seen = false;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === "swarm.event.v1" && parsed.event?.type === "stopped") {
        total += parsed.event.tokensUsed;
        seen = true;
      }
    } catch {}
  }
  return seen ? total : null;
}

/** Tokens OpenCode's JSON events report: the sum over step-finish parts of input plus output. */
export function opencodeTokens(stdout) {
  let total = 0;
  let seen = false;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      const part = parsed.part ?? parsed;
      if (part?.type === "step-finish" && part.tokens) {
        total +=
          (part.tokens.input ?? 0) + (part.tokens.output ?? 0) + (part.tokens.reasoning ?? 0);
        seen = true;
      }
    } catch {}
  }
  return seen ? total : null;
}

/**
 * What the arm itself reported. swarm: an acceptable verdict with exit 0. opencode: a run that
 * exited 0, reported no error and whose last turn ended on a message, which is the only
 * account it gives; it has no verdict of its own, so "claimed" here means "finished with an
 * answer and without reporting an error". A last turn that finished with no message and no
 * tool call (the server having stopped the generation) said nothing, and is not a claim.
 */
export function claimedSuccess(arm, exitCode, stdout) {
  if (arm === "swarm") return exitCode === 0 && swarmResult(stdout)?.verdict?.acceptable === true;
  return exitCode === 0 && !/"type":"error"/.test(stdout) && lastTurnAnswered(stdout);
}

/** Whether OpenCode's last finished turn carried a text part. */
function lastTurnAnswered(stdout) {
  let textInTurn = false;
  let lastTurnAnswered = false;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "step_start") textInTurn = false;
      else if (parsed.type === "text") textInTurn = true;
      else if (parsed.type === "step_finish") lastTurnAnswered = textInTurn;
    } catch {}
  }
  return lastTurnAnswered;
}

export const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Where swarm's evidence for a run went, read from its result line. */
export function swarmEvidenceDirectory(stdout) {
  const result = swarmResult(stdout);
  if (result?.bundleDirectory) return join(result.bundleDirectory, "..");
  const match = /captured evidence: (\S+)/.exec(stdout);
  return match === null ? null : join(match[1], "..");
}

export const defaultPins = {
  model: "qwen3.8:27b",
  endpoint: "http://127.0.0.1:8000/v1",
  swarmCli: join(homedir(), ".cache/swarm-comparison/tools/swarm/dist/cli.js"),
};

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
import { policyLines, protectedPaths } from "./change-policy.mjs";

export const wallBudgetMs = 30 * 60_000;
/**
 * Swarm's token allowance for one launch: the initial invocation and every scripted correction
 * draw from it, each invocation launched with what the earlier ones left. It is the product's
 * `--max-tokens`, a bound checked between calls (the product reserves the next prompt, and can
 * still exceed the figure by one call's growth), not a hard cap. OpenCode has no equivalent and
 * runs to the wall only; the arms are not budget-matched on tokens, and the record says so.
 *
 * Set well above what either arm has spent in any fifteen-minute launch observed here (the most
 * was 5.9 million, OpenCode running to the wall), so that the wall is the bound both arms share
 * and this figure is a safety bound. The pilot's 600,000 bound in two minutes on the Ollama
 * configuration, where a fast model re-sends a 20,000-token prompt every few seconds, and left
 * no allowance for a repair while the other arm ran on uncapped.
 */
export const swarmTokenCap = 8_000_000;
/** Less than one answer's worth of allowance left (the product's output cap) starts no correction. */
export const minimumInvocationTokens = 8_192;
export const maxCorrections = 2;
/** A correction starts only with this much solving time left before the launch's deadline. */
export const minimumCorrectionMs = 60_000;

/**
 * The part of the launch's deadline kept for Swarm's final verification of its tree: the
 * product runs that verification after its own wall, so the wall it is given ends this long
 * before the launch's deadline. Declared in the manifest; zero where a manifest predates it.
 */
export const verificationReserveMs = (budgets) => budgets.swarmVerificationReserveMs ?? 0;

/**
 * The environment name the product reads for the HOME its child processes get
 * (src/exec/child-environment.ts). Set per launch to a fresh directory, so a browser one
 * launch's repair downloads is not there for the next launch's gate.
 */
export const swarmChildHomeName = "SWARM_CHILD_HOME";

/**
 * The task as both arms read it: the task text, the visible check, the test command and the
 * allowed-change policy (change-policy.mjs), the same words for each. Swarm's contract makes the
 * policy's protected paths immutable; OpenCode has no contract and reads the same sentence.
 */
export function taskPrompt(task) {
  return [
    task.taskText.trim(),
    "",
    `Visible acceptance check (it must pass; it is not the only criterion): ${task.visible.command}`,
    `The project's own tests run with: ${task.projectTest.join(" ")}`,
    ...deliverableLines(task),
    ...policyLines(task),
  ].join("\n");
}

/**
 * Every deliverable the stage scores, said to both arms in the same words. The scoring rule
 * requires a regression test; through 2026-10-21 the task text only permitted one, and on the
 * sinon mock task neither arm wrote one.
 */
export function deliverableLines(task) {
  return [
    "Deliverables, all required; the task is not done until each is in the tree:",
    "1. The implementation of the behaviour described above, in the project's own source.",
    "2. Regression tests: at least one new test case, in the project's own test directory and style, that fails on the current code and passes with your change, adding at least one new assertion. A change without a new test is incomplete.",
    `3. The visible acceptance check (${task.visible.command}) and the project's own test command (${task.projectTest.join(" ")}) both passing on the final tree.`,
  ];
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
    // The policy's protected paths and nothing more: a test directory is not among them, so
    // the product can declare and write a regression test where the project keeps its tests.
    immutablePaths: protectedPaths(task),
  };
}

export function swarmArgv(
  pins,
  task,
  workspace,
  base,
  prompt,
  contractPath,
  remainingMs,
  remainingTokens = swarmTokenCap,
) {
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
    String(remainingTokens),
    "--max-wall-minutes",
    String(Math.max(1, Math.floor(remainingMs / 60_000))),
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
    // The product's own workflow flags, frozen in the manifest's pins: the same for every launch
    // of a cohort, so a cohort measures one configuration of the product.
    ...swarmWorkflowFlags(pins.swarmFlags ?? []),
  ];
}

/** The workflow flags a manifest may freeze for Swarm, each checked by name and value. */
const workflowFlags = {
  "--prompt-profile": ["legacy", "concise"],
  "--plan-checks": null,
};

export function swarmWorkflowFlags(flags) {
  const out = [];
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (!(flag in workflowFlags))
      throw new Error(`${flag} is not a workflow flag a manifest may freeze`);
    out.push(flag);
    const values = workflowFlags[flag];
    if (values === null) continue;
    const value = flags[index + 1];
    if (!values.includes(value))
      throw new Error(`${flag} takes ${values.join(" or ")}, not ${value}`);
    out.push(value);
    index += 1;
  }
  return out;
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

/**
 * Comparable token totals. Both arms are counted as the server counted them: every prompt token
 * once (cached ones included) and every completion token once (reasoning included). The arms
 * report the same quantity in different shapes, kept raw beside the total:
 *
 * - Swarm (the AI SDK's usage): input includes cached input, output includes reasoning; the
 *   reasoning and cached figures are subsets, so its total is input plus output.
 * - OpenCode 1.14: its step-finish parts split the SDK's figures into disjoint parts (input
 *   without cache reads or writes, output without reasoning), so its total is the sum of all five.
 *
 * Calls the provider answered without usage are counted apart as unknown, never as zero, and a
 * total with unknown calls is a lower bound.
 */

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

/**
 * Swarm's spend by kind, summed over every loop's stopped event, with reasoning and cached as
 * the subsets the SDK reports. A kind no event reported is null, never zero; a stream from a
 * build before the events carried the breakdown reads as null whole, and one before they carried
 * the unknown-usage count reads that count as null.
 */
export function swarmUsage(stdout) {
  let total = null;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      const usage = parsed.schema === "swarm.event.v1" ? parsed.event?.usage : undefined;
      if (parsed.event?.type !== "stopped" || usage === undefined) continue;
      total = addUsage(total, {
        input: usage.inputTokens,
        output: usage.outputTokens,
        reasoning: usage.reasoningTokens,
        cacheRead: usage.cachedInputTokens,
        cacheWrite: null,
        unknownCalls: parsed.event.callsWithUnknownUsage ?? null,
        breakdown: "subsets",
      });
    } catch {}
  }
  return total;
}

/** OpenCode's spend by kind, summed over step-finish parts as it reports them (disjoint parts). */
export function opencodeUsage(stdout) {
  let total = null;
  for (const part of opencodeSteps(stdout)) {
    total = addUsage(total, {
      input: part.tokens.input ?? 0,
      output: part.tokens.output ?? 0,
      reasoning: part.tokens.reasoning ?? null,
      cacheRead: part.tokens.cache?.read ?? null,
      cacheWrite: part.tokens.cache?.write ?? null,
      // OpenCode writes zeros where the provider sent no usage; its SDK's total is absent then.
      unknownCalls: typeof part.tokens.total === "number" ? 0 : 1,
      breakdown: "disjoint",
    });
  }
  return total;
}

function* opencodeSteps(stdout) {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      const part = parsed.part ?? parsed;
      if (part?.type === "step-finish" && part.tokens) yield part;
    } catch {}
  }
}

function addUsage(total, part) {
  const add = (sum, value) => (value === null || value === undefined ? sum : (sum ?? 0) + value);
  const base = total ?? {
    input: 0,
    output: 0,
    reasoning: null,
    cacheRead: null,
    cacheWrite: null,
    unknownCalls: part.unknownCalls === null ? null : 0,
    breakdown: part.breakdown,
  };
  return {
    input: base.input + part.input,
    output: base.output + part.output,
    reasoning: add(base.reasoning, part.reasoning),
    cacheRead: add(base.cacheRead, part.cacheRead),
    cacheWrite: add(base.cacheWrite, part.cacheWrite),
    unknownCalls:
      base.unknownCalls === null || part.unknownCalls === null
        ? null
        : base.unknownCalls + part.unknownCalls,
    breakdown: base.breakdown,
  };
}

/** OpenCode's comparable total: the sum of its disjoint parts over every step-finish; null where none. */
export function opencodeTokens(stdout) {
  let total = 0;
  let seen = false;
  for (const part of opencodeSteps(stdout)) {
    const t = part.tokens;
    total +=
      (t.input ?? 0) +
      (t.output ?? 0) +
      (t.reasoning ?? 0) +
      (t.cache?.read ?? 0) +
      (t.cache?.write ?? 0);
    seen = true;
  }
  return seen ? total : null;
}

/**
 * What the arm's own stream says about how it ended, apart from its process exit and from any
 * later reading of its tree. Five things are kept separate on a record: the process exit (exit
 * code or signal), the terminal lifecycle (`ended`: exited on its own or killed at the deadline),
 * this explicit completion claim, the independently observed correctness (the visible and hidden
 * verdicts) and the stage's delivery rule, which the analysis applies over all of them.
 *
 * `claim` is "claimed" only where the arm said it finished: Swarm's own verdict acceptable, or an
 * OpenCode turn that ended on its own (`reason` "stop") with a message. It is "none" where the
 * stream shows it did not finish: a refused verdict, a reported error, or a last turn that ended
 * wanting tool results or at a length limit, whatever text it printed on the way (a turn's
 * "Now let me read the key files" is progress, not a claim; the 2026-10-21 accessor launch was
 * recorded as a success claim on exactly that, after a refused read ended its investigation).
 * It is "unknown" where the stream cannot say: no result line, no finished turn, a kill before
 * either.
 */
export function completionAccount(arm, exitCode, signal, stdout) {
  const ended = signal === null || signal === undefined ? "exited" : "killed";
  if (arm === "swarm") {
    const result = swarmResult(stdout);
    if (result === null)
      return { ended, claim: "unknown", basis: "no swarm.result.v1 line in the stream" };
    if (result.verdict?.acceptable !== true)
      return { ended, claim: "none", basis: "the product reported its verdict as not acceptable" };
    // The product's own lifecycle, where the result carries one: an acceptable verdict over a
    // loop that stopped at a limit is the sealed checks' reading, not the product saying the task
    // was finished. Launch 2 of the 2026-10-21 trial was read as claimed on that basis; the
    // product now reports its interrupted loop as such, and this reads it.
    const lifecycle = result.outcome?.lifecycle;
    if (typeof lifecycle === "string" && lifecycle !== "completed")
      return {
        ended,
        claim: "none",
        basis: `the product reported its verdict as acceptable and its loop stopped as ${lifecycle}, not completed`,
      };
    return { ended, claim: "claimed", basis: "the product reported its verdict as acceptable" };
  }
  const turns = opencodeTurns(stdout);
  if (turns.length === 0)
    return { ended, claim: "unknown", basis: "no finished turn in the stream" };
  if (/"type":"error"/.test(stdout))
    return { ended, claim: "none", basis: "the stream reports an error" };
  const last = turns.at(-1);
  if (last.reason !== "stop")
    return {
      ended,
      claim: "none",
      basis: `the last turn finished with reason ${JSON.stringify(last.reason)}, not on its own`,
    };
  if (!last.answered)
    return { ended, claim: "none", basis: "the last turn finished with no message" };
  return { ended, claim: "claimed", basis: "the last turn ended on its own with a message" };
}

/**
 * The one-word form kept on every record: the arm exited 0 and claimed completion. Records
 * before `completion` was written read a turn that ended wanting tool results as a claim; the
 * 2026-10-21 corrections name the one record that was wrong.
 */
export function claimedSuccess(arm, exitCode, stdout) {
  return exitCode === 0 && completionAccount(arm, exitCode, null, stdout).claim === "claimed";
}

/** OpenCode's finished turns: how each ended and whether it carried a message. */
function opencodeTurns(stdout) {
  const turns = [];
  let textInTurn = false;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "step_start") textInTurn = false;
      else if (parsed.type === "text") textInTurn = true;
      else if (parsed.type === "step_finish")
        turns.push({ reason: parsed.part?.reason ?? null, answered: textInTurn });
    } catch {}
  }
  return turns;
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

import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { summaryLines } from "./agent/report.ts";
import { type RunReport, runAgent } from "./agent/run.ts";
import { swarmHome } from "./agent/verification.ts";
import { buildVersion } from "./build-version.ts";
import { UsageError } from "./cli-command-definitions.ts";
import { readAgentConfig } from "./config/agent-config.ts";
import {
  NoModelError,
  type ResolvedModel,
  resolveAtContexts,
  resolveModel,
} from "./runtime/resolve.ts";
import type { ConfirmationPrompt } from "./tools/chokepoint.ts";

const write = (text: string) => process.stdout.write(`${text}\n`);

function count(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new UsageError(`${flag} needs a positive whole number`);
  return value;
}

/** A person at a terminal answers off-allowlist commands; with nobody there, they are refused. */
function terminalPrompt(): ConfirmationPrompt {
  if (!process.stdin.isTTY) return null;
  return async (request) => {
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await terminal.question(
        `${request.explanation} Run it? [y]es, [n]o, [a]lways: `,
      );
      return /^a/i.test(answer) ? "always" : /^y/i.test(answer) ? "yes" : "no";
    } finally {
      terminal.close();
    }
  };
}

/**
 * `run <task>`: discover or take the model, make the change in the workspace, check each
 * requirement with the verifier, and report what is complete and what is not.
 */
export async function run(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      endpoint: { type: "string" },
      model: { type: "string" },
      context: { type: "string" },
      "max-steps": { type: "string" },
      "max-tokens": { type: "string" },
      "turn-tokens": { type: "string" },
      "max-minutes": { type: "string" },
      host: { type: "boolean" },
      "no-apply": { type: "boolean" },
      "authorize-behavior-change": { type: "boolean" },
      review: { type: "boolean" },
      "linked-dependencies": { type: "boolean" },
      approve: { type: "string" },
    },
  });
  const task = positionals.join(" ").trim();
  if (task.length === 0) throw new UsageError("run needs the task, in quotes");
  if (values["linked-dependencies"] === true && values.host !== true) {
    throw new UsageError(
      "--linked-dependencies needs --host: a container never runs on the workspace's installed dependencies",
    );
  }
  const workspace = resolve(values.workspace ?? process.cwd());
  // swarm.toml is optional: without one, the model is discovered and the defaults below apply.
  const agent = await readAgentConfig(workspace);
  const approval = values.approve ?? agent?.approval ?? "ask";
  if (approval !== "ask" && approval !== "auto") throw new UsageError("--approve is ask or auto");
  const keyName = agent?.apiKeyEnv ?? "SWARM_API_KEY";
  const controller = new AbortController();
  // The first of these cancels and finalizes the run; a second one ends the process as usual.
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(name, () => controller.abort(new Error(`stopped by ${name}`)));
  }
  const modelName = values.model ?? agent?.model ?? "auto";
  const endpoint = values.endpoint ?? agent?.endpoint ?? null;
  const named = count(values.context, "--context");
  // A discovered Ollama model gets the largest context it fits; a named model or server, whose
  // capacity is not estimated here, the smaller one.
  const contexts =
    named !== undefined
      ? [named]
      : endpoint === null && modelName === "auto"
        ? discoveredContexts
        : [defaultContextTokens];

  write(`task         ${task}`);
  let model: ResolvedModel;
  let contextTokens: number;
  try {
    ({ resolved: model, contextTokens } = await resolveAtContexts(contexts, (context) =>
      resolveModel({
        model: modelName,
        endpoint,
        apiKey: process.env[keyName] ?? null,
        contextTokens: context,
        home: swarmHome(),
        log: (line) => process.stderr.write(`${line}\n`),
      }),
    ));
  } catch (error) {
    if (!(error instanceof NoModelError)) throw error;
    write(`blocked      ${error.message}`);
    return 5;
  }
  write(`model        ${model.name} (${model.reason})`);
  const maxMinutes = count(values["max-minutes"], "--max-minutes");
  const maxSteps = count(values["max-steps"], "--max-steps") ?? agent?.maxSteps ?? 50;
  const ran = await runAgent({
    workspace,
    task,
    model: model.client,
    modelReason: model.reason,
    escalation: model.escalation?.client ?? null,
    contextTokens,
    apply: values["no-apply"] !== true,
    // Only the user changes what existing tests may expect; nothing the model says can.
    behaviorChange: values["authorize-behavior-change"] === true ? "authorized" : "none",
    review: values.review === true,
    cost: model.cost,
    maxSteps,
    // Unset, the token budget is what the steps could use at this context, so steps and time end
    // a local run; set it to bound what a priced endpoint may spend.
    maxTokens:
      count(values["max-tokens"], "--max-tokens") ?? agent?.maxTokens ?? maxSteps * contextTokens,
    // Room for a reasoning model's thinking and one command, and a bound on a looping reply.
    turnTokens: count(values["turn-tokens"], "--turn-tokens") ?? agent?.turnTokens ?? 16_384,
    maxWallMs: maxMinutes === undefined ? null : maxMinutes * 60_000,
    isolation: values.host === true ? "host" : "isolated",
    ...(values["linked-dependencies"] === true ? { dependencies: "linked" as const } : {}),
    approval,
    confirm: terminalPrompt(),
    version: buildVersion,
    signal: controller.signal,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  for (const line of summaryLines(ran.report, { markdown: ran.reportPath })) write(line);
  write(`evidence     ${ran.sessionDirectory}`);
  if (ran.report.attestation !== null) write(`attestation  ${ran.report.attestation}`);
  return exitCodeOf(ran.report.state, ran.report.requirements);
}

/** The context a named model or server is used with: room for the task, instructions and a diff. */
const defaultContextTokens = 32_768;
/** Contexts tried for a discovered model, largest first: more of a repository before compaction. */
const discoveredContexts = [65_536, 32_768];

/** 0 complete, 1 a requirement failed or the run stopped short, 4 unverified only, 5 blocked. */
function exitCodeOf(state: string, requirements: RunReport["report"]["requirements"]): number {
  if (state === "complete") return 0;
  if (state === "blocked") return 5;
  return requirements.some((one) => one.status === "failed") ? 1 : 4;
}

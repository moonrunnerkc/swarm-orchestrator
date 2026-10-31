import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { openAiCompatible } from "./agent/model.ts";
import { summaryLines } from "./agent/report.ts";
import { type RunReport, runAgent } from "./agent/run.ts";
import { buildVersion } from "./build-version.ts";
import { UsageError } from "./cli-command-definitions.ts";
import { readAgentConfig } from "./config/agent-config.ts";
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

/** `run <task>`: the single-bash-tool loop on the workspace, judged by the verifier. */
export async function run(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      endpoint: { type: "string" },
      model: { type: "string" },
      "max-steps": { type: "string" },
      "max-tokens": { type: "string" },
      "turn-tokens": { type: "string" },
      "max-minutes": { type: "string" },
      approve: { type: "string" },
    },
  });
  const task = positionals.join(" ").trim();
  if (task.length === 0) throw new UsageError("run needs the task, in quotes");
  const workspace = resolve(values.workspace ?? process.cwd());
  const agent = await readAgentConfig(workspace);
  const endpoint = values.endpoint ?? agent?.endpoint;
  const model = values.model ?? agent?.model;
  if (endpoint === undefined || endpoint === null || model === undefined || model === null) {
    throw new UsageError(
      "run needs a model: --endpoint and --model, or [agent] endpoint and model in swarm.toml",
    );
  }
  const approval = values.approve ?? agent?.approval ?? "ask";
  if (approval !== "ask" && approval !== "auto") throw new UsageError("--approve is ask or auto");
  const keyName = agent?.apiKeyEnv ?? "SWARM_API_KEY";
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort(new Error("interrupted")));

  const maxMinutes = count(values["max-minutes"], "--max-minutes");
  write(`task         ${task}`);
  write(
    `model        ${model} (named by ${values.model === undefined ? "swarm.toml" : "--model"})`,
  );
  const ran = await runAgent({
    workspace,
    task,
    model: openAiCompatible({ endpoint, model, apiKey: process.env[keyName] ?? null }),
    modelReason: `named by ${values.model === undefined ? "swarm.toml" : "--model"}`,
    maxSteps: count(values["max-steps"], "--max-steps") ?? agent?.maxSteps ?? 50,
    maxTokens: count(values["max-tokens"], "--max-tokens") ?? agent?.maxTokens ?? 1_000_000,
    // Room for a reasoning model's thinking and one command, and a bound on a looping reply.
    turnTokens: count(values["turn-tokens"], "--turn-tokens") ?? agent?.turnTokens ?? 16_384,
    maxWallMs: maxMinutes === undefined ? null : maxMinutes * 60_000,
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

/** 0 complete, 1 a requirement failed or the run stopped short, 4 unverified only, 5 blocked. */
function exitCodeOf(state: string, requirements: RunReport["report"]["requirements"]): number {
  if (state === "complete") return 0;
  if (state === "blocked") return 5;
  return requirements.some((one) => one.status === "failed") ? 1 : 4;
}

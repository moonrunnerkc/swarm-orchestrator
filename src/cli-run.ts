import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { openAiCompatible } from "./agent/model.ts";
import { runAgent } from "./agent/run.ts";
import { buildVersion } from "./build-version.ts";
import { UsageError } from "./cli-command-definitions.ts";
import { readSwarmToml } from "./config/swarm-toml.ts";
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
      approve: { type: "string" },
    },
  });
  const task = positionals.join(" ").trim();
  if (task.length === 0) throw new UsageError("run needs the task, in quotes");
  const workspace = resolve(values.workspace ?? process.cwd());
  const agent = (await readSwarmToml(workspace))?.agent;
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

  const report = await runAgent({
    workspace,
    task,
    model: openAiCompatible({ endpoint, model, apiKey: process.env[keyName] ?? null }),
    maxSteps: count(values["max-steps"], "--max-steps") ?? agent?.maxSteps ?? 50,
    maxTokens: count(values["max-tokens"], "--max-tokens") ?? agent?.maxTokens ?? 1_000_000,
    // Room for a reasoning model's thinking and one command, and a bound on a looping reply.
    turnTokens: count(values["turn-tokens"], "--turn-tokens") ?? agent?.turnTokens ?? 16_384,
    approval,
    confirm: terminalPrompt(),
    version: buildVersion,
    signal: controller.signal,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  write(`stop         ${report.stop}`);
  if (report.reason !== null) write(`reason       ${report.reason}`);
  write(`verdict      ${report.verification?.verdict ?? "not verified"}`);
  const mutant = report.verification?.survivedMutant ?? null;
  if (mutant !== null) write(`mutant       survived at ${mutant}: no check failed when it changed`);
  write(`steps        ${report.steps}`);
  write(
    `tokens       ${report.tokens}${report.estimatedTurns > 0 ? ` (${report.estimatedTurns} turn(s) estimated: the endpoint reported no usage)` : ""}`,
  );
  write(`verified     ${report.verifications} time(s)`);
  write(`evidence     ${report.sessionDirectory}`);
  if (report.attestation !== null) write(`attestation  ${report.attestation}`);
  return report.stop === "verified" ? 0 : report.stop === "unmeasured" ? 4 : 1;
}

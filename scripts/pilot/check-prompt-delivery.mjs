/**
 * Whether each arm's model receives the whole task, read from the request each product actually
 * sends, with no inference: both products are pointed at the scripted endpoint, which records the
 * request bodies and answers with a closing text, in a workspace prepared exactly as a launch's.
 * The first request's user content must hold the prompt the harness builds (task text, visible
 * check, test command and the acceptance-directory rule) whole.
 *
 *   node scripts/pilot/check-prompt-delivery.mjs --set 2026-10-15 --stage A --swarm-cli <dist/cli.js>
 *     --swarm-gates <json file> --out <file>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { commandLog } from "../campaign/exec.mjs";
import {
  digestOf,
  opencodeArgv,
  swarmArgv,
  swarmContract,
  taskPrompt,
} from "../comparison/arms.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  prepareLaunchHome,
  taskEnvironment,
  writeArmConfiguration,
} from "../comparison/workspace.mjs";
import { taskSet } from "./task-sets.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const swarmCli = args.get("swarm-cli");
const { stageTasks } = await taskSet(args.get("set"));
const gates = args.has("swarm-gates")
  ? JSON.parse(readFileSync(args.get("swarm-gates"), "utf8"))
  : {};
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(swarmCli, "..", "providers", "scripted-endpoint.js")).href
);
const log = commandLog(join(comparisonRoot, "blobs"));

/** Every text a request's user messages carry, joined. */
function userText(request) {
  return (request?.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content ?? []).map((part) => part.text ?? "").join(""),
    )
    .join("\n");
}

const run = (argv, options) =>
  new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.stdout.resume();
    child.stderr.resume();
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

const rows = [];
for (const task of stageTasks(args.get("stage") ?? "A")) {
  for (const arm of ["swarm", "opencode"]) {
    const scratch = mkdtempSync(join(comparisonRoot, "work", `prompt-${task.id}.${arm}-`));
    const workspace = join(scratch, "workspace");
    const home = join(scratch, "home");
    const endpoint = await startScriptedEndpoint({ modelId: "stub", turns: [] });
    try {
      await cloneAtBase(log, task, task.baseCommit, workspace);
      const base = await commitVisibleCheck(log, task, workspace);
      const prepared = await prepare(log, task, workspace);
      if (!prepared.ok) throw new Error(`${task.id}: preparation failed`);
      writeArmConfiguration(workspace, arm, endpoint.url, "stub", task, gates[task.id] ?? {});
      prepareLaunchHome(home);
      const prompt = taskPrompt(task);
      const contractPath = join(scratch, "contract.json");
      writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
      const pins = { swarmCli, model: "stub", endpoint: endpoint.url };
      const argv =
        arm === "swarm"
          ? swarmArgv(pins, task, workspace, base, prompt, contractPath, 5 * 60_000)
          : opencodeArgv(pins, prompt, workspace);
      const environment = taskEnvironment(task);
      const exitCode = await run(argv, {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: environment.PATH,
          PWD: workspace,
          ...(arm === "swarm" ? { SWARM_CHILD_HOME: home } : { HOME: home }),
        },
      });
      const first = endpoint.requests[0] ?? null;
      const sent = userText(first);
      rows.push({
        task: task.id,
        arm,
        exitCode,
        requests: endpoint.requests.length,
        promptDigest: digestOf(prompt),
        promptChars: prompt.length,
        userChars: sent.length,
        wholePromptSent: sent.includes(prompt),
        taskTextSent: sent.includes(task.taskText.trim()),
        maxTokens: first?.max_tokens ?? null,
        thinkingOff: {
          enable_thinking: first?.enable_thinking ?? null,
          chat_template_kwargs: first?.chat_template_kwargs ?? null,
          reasoning_effort: first?.reasoning_effort ?? null,
        },
      });
      console.log(
        `${task.id} ${arm}: ${endpoint.requests.length} request(s); whole prompt sent: ${sent.includes(prompt)} (${prompt.length} chars in ${sent.length})`,
      );
    } finally {
      await endpoint.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
mkdirSync(join(args.get("out"), ".."), { recursive: true });
writeFileSync(
  args.get("out"),
  `${JSON.stringify({ schema: "swarm-comparison.prompt-delivery.v1", checkedAt: new Date().toISOString(), swarmCli, rows, holds: rows.every((row) => row.wholePromptSent) }, null, 2)}\n`,
);
process.exitCode = rows.every((row) => row.wholePromptSent) ? 0 : 1;

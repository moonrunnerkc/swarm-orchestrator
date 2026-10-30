/**
 * Runs the frozen task lists against three arms (mini-SWE-agent, OpenCode, swarm run) through
 * Harbor, which runs each agent inside the task's container and judges the result with the
 * benchmark's own tests. Every arm uses the endpoint and model named in swarm.toml's [agent].
 *
 *   node eval/run.mjs [--smoke] [--stub] [--suite swebench-verified|terminal-bench-2|all]
 *                     [--arms mini-swe-agent,opencode,swarm] [--limit n | --next n]
 *                     [--max-steps n] [--into <earlier run>]
 *   node eval/run.mjs --report
 *
 * --smoke runs the first three SWE-bench Verified tasks. --next n runs, for each arm, the first n
 * tasks of the frozen lists that arm has no stored row for. --stub replaces the model with a
 * server that answers every request with the same command, so the harness runs end to end
 * without one; nothing a stub run records is a model result. Tasks run in list order with every
 * arm on a task before the next task starts. One JSONL file per arm per run lands in
 * eval/results/<run>/ (the committed results store), then docs/results.md is rewritten from the
 * store; --report only rewrites it.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseSwarmToml } from "../src/config/swarm-toml.ts";
import { evaluationRows, writeReport } from "./report.mjs";
import { startStubModel } from "./stub-model.mjs";

const root = resolve(import.meta.dirname, "..");
const cache = process.env.SWARM_EVAL_CACHE ?? join(homedir(), ".cache", "swarm-eval");

export const suites = {
  "swebench-verified": { list: "tasks/swebench-verified.txt", dataset: "swebench-verified@1.0" },
  "terminal-bench-2": { list: "tasks/terminal-bench-2.txt", dataset: "terminal-bench@2.0" },
};

export const arms = {
  "mini-swe-agent": {
    agent: "mini_agent:MiniAgent",
    provider: "openai",
    connection: true,
    env: { MSWEA_COST_TRACKING: "ignore_errors" },
  },
  // OpenCode calls the Responses API for a provider named openai, so the slug names another.
  opencode: {
    agent: "opencode",
    provider: "local",
    connection: true,
    env: {},
    // 1.19.5 never exits after its last turn; 1.14.48 is the version earlier comparisons ran.
    kwargs: { version: "1.14.48" },
  },
  // The adapter reads the endpoint from SWARM_EVAL_ENDPOINT rather than Harbor's overrides.
  swarm: { agent: "swarm_agent:SwarmAgent", provider: "openai", connection: false, env: {} },
};

/** Task ids from a frozen list: one per line, comments and blank lines skipped. */
export function readTaskList(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Containers reach the host's loopback through host.docker.internal. */
export function containerEndpoint(endpoint) {
  return endpoint.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/])/, "//host.docker.internal");
}

/** One JSONL row from a Harbor trial's result.json. */
export function rowFromTrial(trial, context) {
  const reward = trial.verifier_result?.rewards?.reward ?? null;
  const started = Date.parse(trial.agent_execution?.started_at ?? "");
  const finished = Date.parse(trial.agent_execution?.finished_at ?? "");
  const input = trial.agent_result?.n_input_tokens;
  const output = trial.agent_result?.n_output_tokens;
  return {
    ...context,
    reward,
    // A trial the verifier never judged is not a failure of the agent, and not a pass either.
    pass: reward === null ? null : reward >= 1,
    wallSeconds: Number.isNaN(finished - started) ? null : Math.round((finished - started) / 1000),
    tokens: input == null && output == null ? null : (input ?? 0) + (output ?? 0),
    error: trial.exception_info?.exception_type ?? null,
  };
}

/** How a `swarm run` trial ended, from the outcome block its own output prints. */
export function swarmOutcome(text) {
  const field = (name) => text.match(new RegExp(`^${name} +(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { stop: field("stop"), verdict: field("verdict") };
}

function harbor(args, env) {
  return new Promise((settle) => {
    const child = spawn("harbor", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    child.on("close", (code) => settle({ code, log }));
  });
}

/**
 * For each arm, the first n tasks of the lists (in list order) it has no stored row for, merged
 * into one schedule of tasks, each with the arms that still need it.
 */
export function nextUnrun(lists, stored, armNames, n) {
  const done = new Set(stored.map((row) => `${row.arm} ${row.suite}/${row.task}`));
  const wanted = new Map(armNames.map((arm) => [arm, 0]));
  const plan = [];
  for (const { suite, tasks } of lists) {
    for (const task of tasks) {
      const needing = armNames.filter(
        (arm) => wanted.get(arm) < n && !done.has(`${arm} ${suite}/${task}`),
      );
      for (const arm of needing) wanted.set(arm, wanted.get(arm) + 1);
      if (needing.length > 0) plan.push({ suite, task, arms: needing });
    }
  }
  return plan;
}

async function main() {
  const { values } = parseArgs({
    options: {
      smoke: { type: "boolean" },
      stub: { type: "boolean" },
      suite: { type: "string", default: "all" },
      arms: { type: "string", default: Object.keys(arms).join(",") },
      limit: { type: "string" },
      "max-steps": { type: "string" },
      into: { type: "string" },
      next: { type: "string" },
      report: { type: "boolean" },
    },
  });
  if (values.report) {
    writeReport();
    return;
  }
  const agent = parseSwarmToml(readFileSync(join(root, "swarm.toml"), "utf8"), "swarm.toml").agent;
  const stub = values.stub ? await startStubModel() : null;
  const endpoint = stub === null ? agent.endpoint : `http://127.0.0.1:${stub.port}/v1`;
  const model = stub === null ? agent.model : "stub";
  if (!endpoint || !model) throw new Error("swarm.toml needs [agent] endpoint and model");
  const chosenSuites = values.smoke
    ? ["swebench-verified"]
    : values.suite === "all"
      ? Object.keys(suites)
      : [values.suite];
  const chosenArms = values.arms.split(",").map((name) => name.trim());
  for (const name of chosenArms) if (!(name in arms)) throw new Error(`no arm named ${name}`);
  const limit = values.smoke ? 3 : values.limit === undefined ? Infinity : Number(values.limit);
  // --limit bounds the lists in both modes, so --next never reaches past the first n tasks.
  const lists = chosenSuites.map((suite) => ({
    suite,
    tasks: readTaskList(join(root, "eval", suites[suite].list)).slice(0, limit),
  }));
  const plan =
    values.next === undefined
      ? lists.flatMap(({ suite, tasks }) =>
          tasks.map((task) => ({ suite, task, arms: chosenArms })),
        )
      : nextUnrun(lists, evaluationRows(), chosenArms, Number(values.next));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // --into reruns arms inside an earlier run; their earlier rows are kept beside, not deleted.
  const run = values.into ?? `${stamp}${values.smoke ? "-smoke" : ""}${stub ? "-stub" : ""}`;
  const results = join(root, "eval", "results", run);
  mkdirSync(results, { recursive: true });
  for (const name of chosenArms) {
    const earlier = join(results, `${name}.jsonl`);
    if (values.into !== undefined && existsSync(earlier))
      renameSync(earlier, `${earlier}.superseded-${stamp}`);
  }
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();

  // The swarm arm installs exactly this checkout, packed the way npm would publish it.
  const packDir = join(cache, "package");
  mkdirSync(packDir, { recursive: true });
  const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .at(-1);
  const env = {
    SWARM_EVAL_API_KEY: "local",
    SWARM_EVAL_PACKAGE: join(packDir, packed),
    SWARM_EVAL_ENDPOINT: containerEndpoint(endpoint),
    SWARM_EVAL_MAX_STEPS: values["max-steps"] ?? String(agent.maxSteps ?? 50),
    PYTHONPATH: join(root, "eval", "harbor"),
    DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM ?? "linux/amd64",
  };

  for (const { suite, task, arms: needing } of plan) {
    for (const armName of needing) {
      // Unique per invocation: Harbor reuses a finished job of the same name instead of running it.
      const job = `${stamp}-${armName}-${task}`;
      const args = [
        "run",
        "-d",
        suites[suite].dataset,
        "-i",
        task,
        "-a",
        arms[armName].agent,
        "-m",
        `${arms[armName].provider}/${model}`,
        ...(arms[armName].connection
          ? [
              "--base-url",
              containerEndpoint(endpoint),
              "--api-format",
              "openai_chat_completions",
              "--api-key-name",
              "SWARM_EVAL_API_KEY",
            ]
          : []),
        ...Object.entries(arms[armName].env).flatMap(([key, value]) => ["--ae", `${key}=${value}`]),
        ...Object.entries(arms[armName].kwargs ?? {}).flatMap(([key, value]) => [
          "--ak",
          `${key}=${value}`,
        ]),
        "-n",
        "1",
        "-o",
        join(cache, "jobs"),
        "--job-name",
        job,
        "-y",
        "-q",
      ];
      process.stderr.write(`${suite} ${armName} ${task}: running\n`);
      const ran = await harbor(args, env);
      const jobDir = join(cache, "jobs", job);
      const trialDir = (existsSync(jobDir) ? readdirSync(jobDir) : []).find((entry) =>
        entry.startsWith(`${task}__`),
      );
      const context = { run, commit, suite, task, arm: armName, model, stub: stub !== null };
      const row =
        trialDir === undefined
          ? {
              ...context,
              reward: null,
              pass: null,
              wallSeconds: null,
              tokens: null,
              error: `harbor exited ${ran.code}: ${ran.log.slice(-300)}`,
            }
          : rowFromTrial(
              JSON.parse(readFileSync(join(cache, "jobs", job, trialDir, "result.json"), "utf8")),
              context,
            );
      const swarmOutput = join(jobDir, trialDir ?? "", "agent", "swarm-run.txt");
      if (trialDir !== undefined && existsSync(swarmOutput)) {
        Object.assign(row, swarmOutcome(readFileSync(swarmOutput, "utf8")));
      }
      appendFileSync(join(results, `${armName}.jsonl`), `${JSON.stringify(row)}\n`);
      process.stderr.write(
        `${suite} ${armName} ${task}: pass ${row.pass} reward ${row.reward} ${row.wallSeconds}s tokens ${row.tokens}${row.error ? ` error ${row.error}` : ""}\n`,
      );
    }
  }
  await stub?.close();
  process.stdout.write(`results in ${results}\n`);
  writeReport();
}

if (import.meta.filename === process.argv[1]) {
  await main();
}

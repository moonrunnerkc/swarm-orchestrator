#!/usr/bin/env node
/**
 * A README-only onboarding simulation: a fresh container from a pinned image, a fresh clone of
 * one selected repository, and an AI observer that is handed only the public swarm-verify
 * README and the repository's README and asked to get a first result, then to see the
 * verifier refuse a deliberately broken disposable copy. The observer runs shell commands in
 * the container through this driver, which logs every command, its output, the observer's
 * stated belief at each step, every prompt it hit and every detour it took. The implementing
 * agent may read the log afterwards and fix the product; it never speaks to the observer.
 *
 * This is an AI onboarding simulation, and the record says so: it is not a human tester and
 * not customer validation. The observer is a local model served by Ollama; nothing leaves
 * this machine but the container's own network access to GitHub and npm.
 *
 *   node scripts/onboarding/observer.mjs <config.json> <output directory>
 *
 * config: { image, imageDigest, repository, category, prerequisites: [{name, command}],
 *           verifierReadme, model, endpoint, maxSteps, version }
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [configPath, output] = process.argv.slice(2);
if (!configPath || !output) {
  console.error("usage: observer.mjs <config.json> <output directory>");
  process.exit(2);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
mkdirSync(output, { recursive: true });
const log = join(output, "transcript.jsonl");
const startedAt = Date.now();
const record = (entry) =>
  appendFileSync(log, `${JSON.stringify({ t: Date.now() - startedAt, ...entry })}\n`);

const name = `swarm-onboarding-${Date.now()}`;
function docker(args, options = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64_000_000,
    timeout: options.timeoutMs ?? 600_000,
  });
}

// A fresh container with nothing but the pinned image; prerequisites are provisioned exactly
// as the repository or the verifier README states them, and each provisioning command is logged.
const created = docker([
  "run",
  "-d",
  "--name",
  name,
  "--add-host=host.docker.internal:host-gateway",
  "-w",
  "/home/dev",
  config.image,
  "sleep",
  "infinity",
]);
if (created.status !== 0) throw new Error(`container: ${created.stderr}`);
record({ kind: "container", image: config.image, digest: config.imageDigest, name });

function shell(command, timeoutMs = 600_000) {
  const ran = docker(["exec", "-w", "/home/dev", name, "bash", "-lc", command], { timeoutMs });
  const stdout = (ran.stdout ?? "").slice(0, 12_000);
  const stderr = (ran.stderr ?? "").slice(0, 6_000);
  return { status: ran.status, stdout, stderr, timedOut: ran.signal === "SIGTERM" };
}

try {
  for (const step of config.prerequisites) {
    const ran = shell(step.command, 900_000);
    record({
      kind: "prerequisite",
      name: step.name,
      command: step.command,
      status: ran.status,
      stderr: ran.stderr.slice(-800),
    });
    if (ran.status !== 0)
      throw new Error(`prerequisite ${step.name} failed: ${ran.stderr.slice(-800)}`);
  }
  const clone = shell(
    `git clone --quiet https://github.com/${config.repository}.git repo`,
    900_000,
  );
  record({
    kind: "clone",
    repository: config.repository,
    status: clone.status,
    stderr: clone.stderr.slice(-400),
  });
  if (clone.status !== 0) throw new Error(`clone failed: ${clone.stderr}`);
  const repoReadme = shell("cd repo && cat README.md 2>/dev/null | head -c 20000").stdout;
  const versions = shell(
    "node --version; npm --version; git --version; python3 --version 2>/dev/null",
  ).stdout;
  record({ kind: "environment", versions });

  const system = [
    "You are a software developer trying a tool called swarm-verify for the first time, on a real repository you have just cloned into ./repo inside a fresh Linux machine.",
    "You have exactly two documents: the public README of swarm-verify and the README of the repository. Nothing else about swarm-verify is known to you; do not assume commands or flags the README does not show.",
    "Your goal, in order: (1) get a first result from swarm-verify on ./repo; (2) then make a disposable copy of the repository (for example `cp -r repo broken`), break one of its tests or one line of its implementation on purpose, run swarm-verify in that copy, and see whether it refuses; (3) report.",
    "You act by calling the run tool with one shell command at a time. Read outputs carefully. If a prerequisite the repository README states is missing, install it the way the README says. Do not install anything the READMEs do not call for. Never edit files under ./repo; only edit the disposable copy.",
    "Before each command, state in one sentence what you believe will happen and why. When you are done, or stuck after honest attempts, call the finish tool with your report: whether you got a first result, what it said, whether the broken copy was refused, what confused you, and how long it took in steps.",
    "",
    "=== swarm-verify README ===",
    config.verifierReadme,
    "",
    `=== README of ${config.repository} ===`,
    repoReadme,
  ].join("\n");

  const tools = [
    {
      type: "function",
      function: {
        name: "run",
        description:
          "Run one shell command in the machine's home directory and return its exit status, stdout and stderr.",
        parameters: {
          type: "object",
          properties: {
            belief: {
              type: "string",
              description: "One sentence: what you expect this command to do.",
            },
            command: { type: "string" },
          },
          required: ["belief", "command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "End the session with your report.",
        parameters: {
          type: "object",
          properties: {
            firstResult: { type: "boolean" },
            firstResultText: { type: "string" },
            brokenCopyRefused: { type: "boolean" },
            confusions: { type: "array", items: { type: "string" } },
            report: { type: "string" },
          },
          required: ["firstResult", "brokenCopyRefused", "report"],
        },
      },
    },
  ];
  const messages = [
    { role: "system", content: system },
    { role: "user", content: "Begin. State your first belief and run your first command." },
  ];
  let firstResultAt = null;
  let outcome = null;
  // One model call, with the two failures a local server produces handled as what they are:
  // a 5xx is the server refusing the model's own malformed tool call, so the observer is told
  // and asked again; a transport failure (the server busy past the client's header timeout) is
  // waited out. Neither is a finding about the product, and neither ends the session.
  const complete = async () => {
    let failure = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0,
            stream: false,
            ...(config.extraBody ?? {}),
          }),
        });
        if (response.status >= 500) {
          const text = await response.text();
          record({
            kind: "model-error",
            attempt,
            status: response.status,
            text: text.slice(0, 400),
          });
          messages.push({
            role: "user",
            content:
              "Your previous tool call could not be parsed by the server. Call the tool again with well-formed arguments.",
          });
          continue;
        }
        if (!response.ok) throw new Error(`model: ${response.status} ${await response.text()}`);
        return await response.json();
      } catch (cause) {
        failure = cause;
        record({
          kind: "model-transport-failure",
          attempt,
          detail: String(cause?.cause ?? cause).slice(0, 200),
        });
        await new Promise((resolve) => setTimeout(resolve, 30_000 * attempt));
      }
    }
    throw failure ?? new Error("the model server refused three attempts");
  };
  for (let step = 1; step <= config.maxSteps; step += 1) {
    const completion = await complete();
    const choice = completion.choices?.[0]?.message;
    if (!choice) throw new Error("model answered with no message");
    messages.push(choice);
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      record({ kind: "observer-text", step, text: choice.content ?? "" });
      messages.push({
        role: "user",
        content: "Use the run tool to act, or the finish tool to report.",
      });
      continue;
    }
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (call.function.name === "finish") {
        // A model sometimes hands the list as one string; the summary keeps it as a list.
        if (typeof args.confusions === "string") args.confusions = [args.confusions];
        outcome = { step, ...args };
        record({ kind: "finish", step, ...args });
        break;
      }
      const command = String(args.command ?? "");
      record({ kind: "belief", step, belief: args.belief ?? "", command });
      const ran = shell(command);
      record({
        kind: "command",
        step,
        command,
        status: ran.status,
        stdout: ran.stdout,
        stderr: ran.stderr,
        timedOut: ran.timedOut,
      });
      if (firstResultAt === null && /^result {7}/m.test(ran.stdout)) {
        firstResultAt = Date.now() - startedAt;
        record({
          kind: "first-result",
          step,
          ms: firstResultAt,
          line: ran.stdout.split("\n").find((line) => line.startsWith("result ")),
        });
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          status: ran.status,
          stdout: ran.stdout,
          stderr: ran.stderr,
          timedOut: ran.timedOut,
        }),
      });
    }
    if (outcome !== null) break;
  }
  const summary = {
    repository: config.repository,
    category: config.category,
    image: config.image,
    imageDigest: config.imageDigest,
    model: config.model,
    version: config.version,
    steps: messages.filter((m) => m.role === "tool").length,
    firstResultMs: firstResultAt,
    outcome,
    finishedAt: new Date().toISOString(),
    label: "AI onboarding simulation by a local model; not a human tester",
  };
  writeFileSync(join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  docker(["rm", "-f", name]);
  record({ kind: "container-removed", name });
}

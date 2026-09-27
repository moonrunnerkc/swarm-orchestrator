#!/usr/bin/env node
/**
 * The task-truth arm of the AI-authored pull request study, apart from the verifier arm.
 *
 * For each executed row, a reviewer role that never saw the verifier's verdict writes one
 * executable acceptance check from the pull request's stated requirement (title, body, linked
 * issues), reading the repository at the head as it needs to, but never the test files the
 * pull request itself changed, so the check is not a copy of the author's own tests. The check
 * is then executed in a network-disabled container on the base (where it must fail, or it does
 * not test the requirement) and on the head (judged). A requirement the reviewer cannot state
 * executably is recorded as unjudged, never guessed. The reviewer is a local model; its every
 * read, its check and both executions are the record.
 *
 *   node scripts/ai-pr-study/adjudicate.mjs <rows directory> [--only <index,index>] [--limit <n>]
 *        [--model <name>] [--endpoint <url>] [--image <node image>] [--python-image <image>]
 *
 * Resumable: a row with an adjudication is skipped.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const positional = [];
const flags = new Map();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith("--")) {
    flags.set(arg.slice(2), args[index + 1]);
    index += 1;
  } else positional.push(arg);
}
const [rowsDirectory] = positional;
if (!rowsDirectory) {
  console.error(
    "usage: adjudicate.mjs <rows directory> [--only <indexes>] [--limit <n>] [--model <name>] [--endpoint <url>]",
  );
  process.exit(2);
}
const rowsRoot = resolve(rowsDirectory);
const limit = Number(flags.get("limit") ?? "1000");
const only = flags.has("only") ? new Set(String(flags.get("only")).split(",").map(Number)) : null;
const model = flags.get("model") ?? "qwen3.6:35b-a3b";
const endpoint = flags.get("endpoint") ?? "http://localhost:11434";
const nodeImage = flags.get("image") ?? "node:24-bookworm";
const pythonImage = flags.get("python-image") ?? "ghcr.io/astral-sh/uv:python3.12-bookworm";
const maxSteps = 30;
const workingRoot = join(homedir(), ".cache", "swarm-ai-pr-study");

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64_000_000, ...options });

const reviewerSystem = [
  "You are a reviewer establishing whether a merged pull request did what it claims, independently of its own tests.",
  "You are given the pull request's title, body and linked issues, the names of the files it changed, and tools to read the repository at the pull request's head. You may not read the test files the pull request changed, and the read tool refuses them; write your check from the stated requirement and the code's public interfaces.",
  "Write ONE executable acceptance check that fails if the stated requirement is not met and passes if it is. It must be self-contained: one file, run by one command from the repository root, using only what the repository already installs (its test runner, or plain `node --test` / `python -m pytest`). It must not need the network.",
  "Your check must fail on the code BEFORE the pull request and pass AFTER it; it will be run on both, and a check that passes on both tests nothing.",
  "If the requirement cannot be stated as an executable check (it is a refactor with no observable behaviour, a documentation change, or its acceptance needs a service you cannot reach), call finish with unjudged=true and say why. Never guess.",
  "Act by calling tools: `list` a directory, `read` a file, then `finish` with the check. Keep reads purposeful; you have at most 30 tool calls.",
].join("\n");

const tools = [
  {
    type: "function",
    function: {
      name: "list",
      description: "List a directory of the repository at the head.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description:
        "Read a file of the repository at the head (refuses the test files the pull request changed).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Hand over the acceptance check, or say the requirement is not executable.",
      parameters: {
        type: "object",
        properties: {
          unjudged: { type: "boolean", description: "true when no executable check can be stated" },
          reason: {
            type: "string",
            description: "why it is unjudged, or what the check establishes",
          },
          requirement: { type: "string", description: "the requirement, in one or two sentences" },
          checkPath: { type: "string", description: "repository-relative path for the check file" },
          checkContents: { type: "string" },
          command: {
            type: "string",
            description: "one shell command, run from the repository root, that runs the check",
          },
        },
        required: ["unjudged", "reason"],
      },
    },
  },
];

function listDirectory(root, path) {
  const target = resolve(root, path);
  if (!target.startsWith(root)) return "outside the repository";
  try {
    return readdirSync(target)
      .filter((name) => name !== "node_modules" && name !== ".git" && name !== ".venv")
      .map((name) => (statSync(join(target, name)).isDirectory() ? `${name}/` : name))
      .join("\n");
  } catch (cause) {
    return `cannot list: ${cause.message}`;
  }
}

function readFile(root, path, forbidden) {
  const target = resolve(root, path);
  if (!target.startsWith(root)) return "outside the repository";
  const relative = target.slice(root.length + 1);
  if (forbidden.has(relative)) return "refused: this is a test file the pull request changed";
  try {
    const bytes = readFileSync(target, "utf8");
    return bytes.length > 60_000
      ? `${bytes.slice(0, 60_000)}\n[truncated at 60000 characters]`
      : bytes;
  } catch (cause) {
    return `cannot read: ${cause.message}`;
  }
}

/**
 * A failure on the head counts only where each failing assertion is stated in the requirement.
 * A second, code-blind call is handed the requirement text and the check's failing output and
 * must quote the sentence each failure comes from; an assertion it cannot quote is the
 * reviewer's own addition, and the row stays unjudged rather than call it a violation.
 */
async function traceFailure(requirement, failingOutput) {
  const traceTools = [
    {
      type: "function",
      function: {
        name: "trace",
        description: "Map each failing assertion to the requirement sentence it comes from.",
        parameters: {
          type: "object",
          properties: {
            traceable: {
              type: "boolean",
              description:
                "true only when every failing assertion is stated in the requirement text",
            },
            mapping: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  assertion: { type: "string" },
                  quote: {
                    type: "string",
                    description: "verbatim words from the requirement, or empty",
                  },
                },
                required: ["assertion", "quote"],
              },
            },
          },
          required: ["traceable", "mapping"],
        },
      },
    },
  ];
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You audit an acceptance check against a pull request's stated requirement. You see only the requirement text and the check's failing output. For each failing assertion, quote the exact words of the requirement that state it. If any failing assertion is not stated in the requirement (it is an inference, a style preference or a stricter reading than the text), set traceable to false. Call the trace tool once.",
        },
        {
          role: "user",
          content: `Requirement:\n${requirement}\n\nFailing output:\n${failingOutput}`,
        },
      ],
      tools: traceTools,
      tool_choice: { type: "function", function: { name: "trace" } },
      temperature: 0,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`model: ${response.status} ${await response.text()}`);
  const completion = await response.json();
  const call = completion.choices?.[0]?.message?.tool_calls?.[0];
  try {
    const parsed = JSON.parse(call?.function?.arguments ?? "{}");
    const mapping = Array.isArray(parsed.mapping) ? parsed.mapping : [];
    // The audit's own word is not enough: every quote must appear in the requirement text.
    const quotesHold =
      mapping.length > 0 &&
      mapping.every(
        (entry) =>
          typeof entry.quote === "string" &&
          entry.quote.trim().length > 0 &&
          requirement.includes(entry.quote.trim()),
      );
    return { traceable: parsed.traceable === true && quotesHold, mapping };
  } catch {
    return { traceable: false, mapping: [] };
  }
}

async function ask(messages) {
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`model: ${response.status} ${await response.text()}`);
  const completion = await response.json();
  const choice = completion.choices?.[0]?.message;
  if (!choice) throw new Error("model answered with no message");
  return choice;
}

/**
 * Run the check inside a network-disabled container over the clone at one commit. The check
 * file is written once by the caller and stays across both commits: deleting and recreating a
 * file between two container runs is exactly what a desktop mount's cache gets wrong.
 */
function executeCheck(clone, image, commit, check, lockfileChanged, manifest) {
  const checkedOut = run("git", ["checkout", "--quiet", "--force", "--detach", commit], {
    cwd: clone,
  });
  if (checkedOut.status !== 0)
    return { ran: false, detail: `checkout failed: ${checkedOut.stderr.slice(-300)}` };
  const install =
    lockfileChanged && manifest === "package.json"
      ? "npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; "
      : lockfileChanged && manifest === "pyproject.toml"
        ? "uv sync --locked >/dev/null 2>&1; "
        : "";
  const ran = run(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      `--volume=${clone}:/workspace:rw`,
      "--workdir=/workspace",
      "--memory=2g",
      "--pids-limit=256",
      "--entrypoint",
      "/bin/sh",
      image,
      "-c",
      `test -f ${JSON.stringify(check.checkPath)} || { echo "check file missing" >&2; exit 125; }; ${install}${check.command}`,
    ],
    { timeout: 900_000 },
  );
  const exitCode = ran.status;
  return {
    // 125 is the missing file, 126 and 127 are a command that could not run: none of these
    // is the check's own verdict.
    ran: ran.error === undefined && ran.signal !== "SIGTERM" && ![125, 126, 127].includes(exitCode),
    exitCode,
    timedOut: ran.signal === "SIGTERM",
    stdout: (ran.stdout ?? "").slice(-4000),
    stderr: (ran.stderr ?? "").slice(-4000),
  };
}

let done = 0;
for (const name of readdirSync(rowsRoot)
  .filter((file) => /^\d+\.json$/.test(file))
  .sort()) {
  if (done >= limit) break;
  const rowPath = join(rowsRoot, name);
  const row = JSON.parse(readFileSync(rowPath, "utf8"));
  if (only !== null && !only.has(row.index)) continue;
  if (!["executed", "fetched"].includes(row.outcome) || row.adjudication) continue;
  done += 1;
  const clone = join(workingRoot, `${row.repository.replace("/", "__")}-${row.number}`);
  const transcriptPath = rowPath.replace(/\.json$/, ".adjudication.jsonl");
  const record = (entry) =>
    writeFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
  rmSync(transcriptPath, { force: true });
  const forbidden = new Set(row.testChanges ?? []);
  const requirement = [
    `Repository: ${row.repository}`,
    `Pull request #${row.number}: ${row.title}`,
    "",
    "Body:",
    row.body || "(empty)",
    ...(row.linkedIssues ?? []).flatMap((issue) => [
      "",
      `Linked issue #${issue.number}: ${issue.title}`,
      issue.body || "(empty)",
    ]),
    "",
    `Files the pull request changed: ${(row.changedFiles ?? []).join(", ")}`,
    `Test files it changed (not readable): ${(row.testChanges ?? []).join(", ") || "none"}`,
  ].join("\n");
  const adjudication = {
    reviewer: {
      model,
      endpoint,
      promptDigest: `sha256:${createHash("sha256").update(reviewerSystem).digest("hex")}`,
    },
    startedAt: new Date().toISOString(),
  };
  const finish = (result) => {
    row.adjudication = { ...adjudication, ...result, finishedAt: new Date().toISOString() };
    writeFileSync(rowPath, `${JSON.stringify(row, null, 2)}\n`);
    console.log(`${row.index} ${row.repository}#${row.number}: ${result.status}`);
  };
  try {
    run("git", ["checkout", "--quiet", "--force", "--detach", row.head], { cwd: clone });
    const messages = [
      { role: "system", content: reviewerSystem },
      { role: "user", content: `${requirement}\n\nBegin: read what you need, then finish.` },
    ];
    let check = null;
    let reads = 0;
    for (let step = 1; step <= maxSteps && check === null; step += 1) {
      const choice = await ask(messages);
      messages.push(choice);
      const calls = choice.tool_calls ?? [];
      if (calls.length === 0) {
        record({ kind: "reviewer-text", step, text: choice.content ?? "" });
        messages.push({ role: "user", content: "Use the tools: list, read, or finish." });
        continue;
      }
      for (const call of calls) {
        let callArgs = {};
        try {
          callArgs = JSON.parse(call.function.arguments || "{}");
        } catch {
          callArgs = {};
        }
        let content = "";
        if (call.function.name === "list")
          content = listDirectory(clone, String(callArgs.path ?? "."));
        else if (call.function.name === "read") {
          reads += 1;
          content = readFile(clone, String(callArgs.path ?? ""), forbidden);
        } else if (call.function.name === "finish") {
          const path = typeof callArgs.checkPath === "string" ? callArgs.checkPath : "";
          if (
            callArgs.unjudged !== true &&
            (forbidden.has(path) || (row.changedFiles ?? []).includes(path))
          ) {
            // The check would overwrite a file the pull request changed; that is the author's
            // file, not the reviewer's. One more chance to name a fresh path, within the step cap.
            content = `refused: ${path} is a file the pull request changed; write the check to a new path (for example a new file beside the tests) and call finish again`;
          } else {
            check = callArgs;
            content = "recorded";
          }
        } else content = "unknown tool";
        record({ kind: call.function.name, step, args: callArgs, result: content.slice(0, 2000) });
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    if (check === null) {
      finish({
        status: "unjudged",
        reason: `the reviewer produced no check within ${maxSteps} steps`,
        reads,
      });
      continue;
    }
    if (check.unjudged === true || !check.checkPath || !check.checkContents || !check.command) {
      finish({
        status: "unjudged",
        reason: check.reason ?? "no executable check",
        requirement: check.requirement ?? null,
        reads,
      });
      continue;
    }
    const checkDigest = `sha256:${createHash("sha256").update(check.checkContents).digest("hex")}`;
    const manifest = row.execution?.manifest ?? null;
    const image = manifest === "pyproject.toml" ? pythonImage : nodeImage;
    const lockfileChanged = (row.changedFiles ?? []).some((path) =>
      /(^|\/)(package-lock\.json|pnpm-lock\.yaml|uv\.lock)$/.test(path),
    );
    run("git", ["checkout", "--quiet", "--force", "--detach", row.head], { cwd: clone });
    run("git", ["clean", "-fdq", "-e", "node_modules", "-e", ".venv"], { cwd: clone });
    const checkFile = join(clone, check.checkPath);
    mkdirSync(join(checkFile, ".."), { recursive: true });
    writeFileSync(checkFile, check.checkContents);
    const onHead = executeCheck(clone, image, row.head, check, false, manifest);
    const onBase = executeCheck(clone, image, row.base, check, lockfileChanged, manifest);
    rmSync(checkFile, { force: true });
    // Leave the clone at the head with its installed dependencies for any later replay.
    if (lockfileChanged)
      executeCheck(clone, image, row.head, { ...check, command: "true" }, true, manifest);
    else run("git", ["checkout", "--quiet", "--force", "--detach", row.head], { cwd: clone });
    const baseFails = onBase.ran && onBase.exitCode !== 0;
    const headPasses = onHead.ran && onHead.exitCode === 0;
    let trace = null;
    if (onBase.ran && onHead.ran && baseFails && !headPasses) {
      trace = await traceFailure(requirement, `${onHead.stdout}\n${onHead.stderr}`.trim());
      record({ kind: "trace", ...trace });
    }
    const status =
      !onBase.ran || !onHead.ran
        ? "unjudged"
        : !baseFails
          ? "unjudged"
          : headPasses
            ? "requirement-met"
            : trace?.traceable === true
              ? "requirement-violated"
              : "unjudged";
    finish({
      status,
      reason:
        status === "unjudged"
          ? !baseFails
            ? "the check does not fail on the base, so it does not test the requirement"
            : trace !== null
              ? "the head fails an assertion that is not stated in the requirement, so the failure is the reviewer's addition"
              : "the check could not be executed on both commits"
          : check.reason,
      trace,
      requirement: check.requirement ?? null,
      check: {
        path: check.checkPath,
        command: check.command,
        digest: checkDigest,
        contents: check.checkContents,
      },
      reads,
      base: onBase,
      head: onHead,
      image,
    });
  } catch (cause) {
    finish({ status: "unjudged", reason: `harness error: ${cause.message.split("\n")[0]}` });
  }
}
console.log(`${done} row(s) adjudicated; results in ${rowsRoot}`);

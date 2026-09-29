#!/usr/bin/env node
/**
 * The task-truth arm of the AI-authored pull request study, apart from the verifier arm.
 *
 * Per row with a standing fetch, as an immutable attempt of the run (see attempts.mjs):
 *
 * 1. The check author, a local model, reads the pull request's title, body, linked issues and
 *    changed file names, and a fresh checkout of the BASE commit (never the candidate
 *    implementation), states the requirements and writes checks per requirement.
 * 2. A second reviewer, a different local model, states the requirements blind from the text,
 *    then judges each of the author's requirements and checks (see reviewers.mjs).
 * 3. The checks run in a network-disabled container on the head and on the base of a checkout
 *    made only for this arm, after that commit's dependencies are prepared from its lockfile.
 *    Each side is classified (side-outcome.mjs): only an assertion failure or a missing feature
 *    on the base with a pass on the head establishes a met requirement, and a startup crash,
 *    a broken check, an install failure or a timeout is never detection.
 * 4. A violation candidate must pass the code-blind trace audit, quoting the pull request.
 * 5. What each check executes decides its truth class (check-execution.mjs), and the two
 *    reviewers' agreement decides what is scored (reviewers.mjs `scoreRow`).
 *
 * The hidden checks are written only into this arm's own checkout and into the row; never into
 * a checkout the verifier or the suite arm reads, and never into any model's context but the
 * second reviewer's judgement and the trace audit.
 *
 *   node scripts/ai-pr-study/adjudicate.mjs --run <runId> [--only <index,index>] [--limit <n>]
 *        [--author-model <name>] [--second-model <name>] [--endpoint <url>] [--working-root <dir>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harnessIdentity, openRun, sha256 } from "./attempts.mjs";
import { checkoutModuleResolver, classifyCheckExecution } from "./check-execution.mjs";
import { removeFileInside, writeFileInside } from "./containment.mjs";
import {
  chatCompletion,
  ModelTransportError,
  modelIdentity,
  toolArguments,
} from "./model-client.mjs";
import {
  detectProject,
  imageIdentity,
  prepareDependencies,
  checkPath as projectPath,
  runInContainer,
} from "./plain-ci.mjs";
import { checkPathRefusal, listDirectory, readFile } from "./reviewer-tools.mjs";
import {
  authorSystem,
  authorTools,
  blindSystem,
  blindTools,
  judgeSystem,
  judgeTools,
  promptDigest,
  pullRequestText,
  reviewerDisclosure,
  scoreRow,
  traceHolds,
  traceSystem,
  traceTools,
  validateAuthorFinish,
} from "./reviewers.mjs";
import { additionsOfDiff, classifySide, decideCheck } from "./side-outcome.mjs";
import {
  attemptDirectory,
  defaultWorkingRoot,
  freshCheckout,
  parseArguments,
  repositoryRoot,
  run,
  runArm,
  standingFetch,
} from "./study-run.mjs";

const { flags } = parseArguments(process.argv.slice(2));
if (!flags.has("run")) {
  console.error(
    "usage: adjudicate.mjs --run <runId> [--only <indexes>] [--limit <n>] [--author-model <name>] [--second-model <name>] [--endpoint <url>]",
  );
  process.exit(2);
}
const workingRoot = flags.get("working-root") ?? defaultWorkingRoot;
const runRecord = {
  ...openRun(workingRoot, {
    resume: String(flags.get("run")),
    identity: { harnessCommit: harnessIdentity(repositoryRoot).commit },
  }),
  workingRoot,
};
const limit = Number(flags.get("limit") ?? "1000");
const only = flags.has("only") ? new Set(String(flags.get("only")).split(",").map(Number)) : null;
const authorModel = flags.get("author-model") ?? "qwen3.6:35b-a3b";
const secondModel = flags.get("second-model") ?? "gemma4-31b-greedy-128k:latest";
const endpoint = flags.get("endpoint") ?? "http://localhost:11434";
if (authorModel === secondModel) {
  console.error("the second reviewer must be a different model from the check author");
  process.exit(2);
}
const budgets = runRecord.budgets;
const frame = JSON.parse(readFileSync(runRecord.framePath, "utf8"));

/** Ask a model for exactly one tool call and return its parsed arguments, or null. */
async function askOnce(model, system, user, tools, tool) {
  const completed = await chatCompletion(endpoint, {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools,
    tool_choice: { type: "function", function: { name: tool } },
    temperature: 0,
    stream: false,
  });
  return toolArguments(completed, tool);
}

/** The check author's tool loop over the base checkout. */
async function authorReview(clone, prText, pr, record) {
  const pathRefusal = (path) => {
    const checked = checkPathRefusal(path, new Set(), pr.changedFiles ?? []);
    if (checked.refusal !== null) return checked;
    if (existsSync(join(clone, checked.path)))
      return {
        refusal: `refused: ${checked.path} exists in the repository; write each check to a new file`,
      };
    return checked;
  };
  const messages = [
    { role: "system", content: authorSystem },
    {
      role: "user",
      content: `${prText}\n\nFiles the pull request changed (their new contents are not shown): ${(pr.changedFiles ?? []).join(", ")}\n\nBegin: read what you need at the base, then finish.`,
    },
  ];
  const reads = [];
  const budget = { used: 0 };
  for (let step = 1; step <= budgets.reviewerMaxSteps; step += 1) {
    const completed = await chatCompletion(endpoint, {
      model: authorModel,
      messages,
      tools: authorTools,
      tool_choice: "auto",
      temperature: 0,
      stream: false,
    });
    const choice = completed.choices?.[0]?.message;
    if (!choice) throw new ModelTransportError("the model answered with no message");
    messages.push(choice);
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      record({ role: "author", kind: "text", step, text: choice.content ?? "" });
      messages.push({ role: "user", content: "Use the tools: list, read, or finish." });
      continue;
    }
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      let content;
      if (call.function.name === "list") content = listDirectory(clone, String(args.path ?? "."));
      else if (call.function.name === "read") {
        reads.push(String(args.path ?? ""));
        content = readFile(clone, String(args.path ?? ""), new Set(), budget);
      } else if (call.function.name === "finish") {
        const validated = validateAuthorFinish(args, pathRefusal);
        record({ role: "author", kind: "finish", step, args, refusal: validated.refusal ?? null });
        if (validated.accepted !== undefined)
          return { accepted: validated.accepted, reads, steps: step };
        content = validated.refusal;
      } else content = "unknown tool";
      if (call.function.name !== "finish")
        record({
          role: "author",
          kind: call.function.name,
          step,
          args,
          result: content.slice(0, 2000),
        });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return { accepted: null, reads, steps: budgets.reviewerMaxSteps };
}

/** Run every check at one commit of the arm's checkout, dependencies prepared first. */
function executeSide(clone, commit, image, checks) {
  const checkedOut = run("git", ["checkout", "--quiet", "--force", "--detach", commit], {
    cwd: clone,
  });
  if (checkedOut.status !== 0)
    return {
      commit,
      ran: false,
      notRunReason: `checkout failed: ${checkedOut.stderr.slice(-300)}`,
      runs: {},
    };
  const project = detectProject(clone);
  const install = prepareDependencies(clone, image, project, {
    timeoutMs: budgets.installTimeoutMs,
  });
  const setup = {
    install,
    environment: {
      image: imageIdentity(image),
      path: `${projectPath}:<image PATH>`,
      network: { install: "bridge (registry, this one command)", check: "none" },
    },
  };
  if (install.status === "failed")
    return {
      commit,
      setup,
      setupFailed: true,
      notRunReason: `dependencies could not be prepared at ${commit.slice(0, 9)}: ${(install.outputTail ?? install.detail ?? "").trim().split("\n").at(-1) ?? ""}`,
      runs: {},
    };
  const runs = {};
  for (const check of checks) {
    const ran = runInContainer(
      clone,
      image,
      `test -f ${JSON.stringify(check.path)} || { echo "check file missing" >&2; exit 125; }; ${check.command}`,
      { timeoutMs: budgets.checkTimeoutMs, memory: "2g" },
    );
    runs[check.id] = {
      ran: ran.error === null || ran.timedOut,
      exitCode: ran.exitCode,
      timedOut: ran.timedOut,
      durationMs: ran.durationMs,
      stdout: ran.stdout.slice(-4000),
      stderr: ran.stderr.slice(-4000),
    };
  }
  return { commit, setup, runs };
}

async function adjudicate(fetch, attempt) {
  const { pr } = fetch;
  const work = attemptDirectory(runRecord.paths.work, pr.index, "adjudication", attempt);
  const artifacts = attemptDirectory(runRecord.paths.artifacts, pr.index, "adjudication", attempt);
  const transcriptPath = join(artifacts, "transcript.jsonl");
  const record = (entry) =>
    writeFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
  const prText = pullRequestText(pr);
  const identities = {
    author: await modelIdentity(endpoint, authorModel),
    second: await modelIdentity(endpoint, secondModel),
  };
  const reviewers = {
    disclosure: reviewerDisclosure,
    author: {
      role: "check author",
      ...identities.author,
      promptDigest: promptDigest(authorSystem, authorTools),
      exposure: {
        pullRequestText: true,
        changedFileNames: true,
        baseCheckout: true,
        headContents: false,
        verifierVerdict: false,
        executionResults: false,
      },
    },
    second: {
      role: "independent judge",
      ...identities.second,
      promptDigests: {
        blind: promptDigest(blindSystem, blindTools),
        judge: promptDigest(judgeSystem, judgeTools),
        trace: promptDigest(traceSystem, traceTools),
      },
      exposure: {
        pullRequestText: true,
        changedFileNames: false,
        baseCheckout: false,
        headContents: false,
        authorRequirementsAndChecks: "after its own blind statement",
        executionResults: "only the head's failing output, in the trace audit",
        verifierVerdict: false,
      },
    },
  };
  // This arm's own checkout, at the base for the author; no other arm reads it.
  const clone = freshCheckout(pr.execution.objectClone, join(work, "checkout"), pr.base);
  const authored = await authorReview(clone, prText, pr, record);
  reviewers.author.reads = authored.reads;
  reviewers.author.steps = authored.steps;
  const blind = await askOnce(secondModel, blindSystem, prText, blindTools, "state");
  record({ role: "second", kind: "blind", args: blind });
  const author = authored.accepted;
  let judge = null;
  if (author !== null && author.unjudged !== true) {
    const shown = author.requirements.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      quote: requirement.quote,
      checks: requirement.checks.map((check) => ({
        id: check.id,
        path: check.path,
        command: check.command,
        asserts: check.asserts,
        contents: check.contents,
      })),
    }));
    judge = await askOnce(
      secondModel,
      judgeSystem,
      `${prText}\n\nYour own earlier statement:\n${JSON.stringify(blind, null, 2)}\n\nThe other reviewer's task type: ${author.taskType}\n\nThe other reviewer's requirements and checks:\n${JSON.stringify(shown, null, 2)}`,
      judgeTools,
      "judge",
    );
    record({ role: "second", kind: "judge", args: judge });
  }
  const outcomes = {};
  const execution = {};
  if (author !== null && author.unjudged !== true) {
    const checks = author.requirements.flatMap((requirement) => requirement.checks);
    const added = additionsOfDiff(readFileSync(pr.diff.path, "utf8"));
    const needs = author.needs[0];
    if (needs === undefined) {
      run("git", ["checkout", "--quiet", "--force", "--detach", pr.head], { cwd: clone });
      // Written once, at the head, and kept across both commits: every check path is new at
      // the base and not a changed file, so neither checkout touches it.
      const files = new Map(checks.map((check) => [check.path, check.contents]));
      for (const [path, contents] of files) writeFileInside(clone, path, contents);
      execution.head = executeSide(clone, pr.head, pr.execution.image, checks);
      // Classified at the head, where a module the pull request adds exists to be resolved.
      const resolver = checkoutModuleResolver(clone);
      for (const check of checks)
        outcomes[check.id] = {
          truthClass: classifyCheckExecution(check, { projectModule: resolver }),
        };
      execution.base = executeSide(clone, pr.base, pr.execution.image, checks);
      for (const path of files.keys()) removeFileInside(clone, path);
    }
    const checkPaths = [...new Set(checks.map((check) => check.path))];
    for (const requirement of author.requirements) {
      for (const check of requirement.checks) {
        const sideOf = (side) =>
          side === undefined
            ? { ran: false, notRunReason: "not executed" }
            : side.setupFailed
              ? { setupFailed: true, notRunReason: side.notRunReason }
              : side.ran === false
                ? side
                : side.runs[check.id];
        const base = classifySide(sideOf(execution.base), { checkPaths, added });
        const head = classifySide(sideOf(execution.head), { checkPaths, added });
        const decided = decideCheck({
          taskType: author.taskType,
          base,
          head,
          requirementText: prText,
          needs,
        });
        let decision = decided.decision;
        let reason = decided.reason;
        let trace = null;
        if (decision === "violated-candidate") {
          const side = execution.head.runs[check.id];
          const audit = await askOnce(
            secondModel,
            traceSystem,
            `Requirement:\n${prText}\n\nFailing output:\n${`${side.stdout}\n${side.stderr}`.trim()}`,
            traceTools,
            "trace",
          );
          trace = traceHolds(audit, prText);
          record({ role: "second", kind: "trace", check: check.id, ...trace });
          decision = trace.traceable ? "violated" : "unjudged";
          if (!trace.traceable)
            reason =
              "the head fails an assertion the trace audit could not quote from the pull request, so the failure is the check author's addition";
        }
        const truthClass = outcomes[check.id]?.truthClass ?? classifyCheckExecution(check);
        outcomes[check.id] = {
          decision,
          reason,
          base,
          head,
          trace,
          truthClass: truthClass.class,
          truthClassReason: truthClass.reason,
        };
      }
    }
  }
  const truth = scoreRow({ author, blind, judge, outcomes });
  return {
    adjudication: {
      procedure: "two-reviewer, base-only author (2026-09-29 amendment)",
      reviewers,
      pullRequestTextDigest: sha256(prText),
      author,
      blind,
      judge,
      execution,
      outcomes,
      truth: {
        class: truth.class,
        status: truth.status,
        reason: truth.reason,
        requirements: truth.requirements,
        disagreements: truth.disagreements,
        uncertainty: truth.uncertainty,
      },
      status: truth.status ?? "unscored",
      transcript: `${transcriptPath} (outside the repository)`,
    },
    summary: `${truth.class} ${truth.status ?? "unscored"}: ${truth.reason}`,
  };
}

let done = 0;
for (const selected of frame.selected) {
  if (done >= limit) break;
  if (only !== null && !only.has(selected.index)) continue;
  const fetch = standingFetch(runRecord, selected.index);
  if (fetch === null || fetch.failure) continue;
  done += 1;
  const inputs = {
    diff: fetch.pr.diff.digest,
    fetchAttempt: fetch.attempt,
    pullRequestText: sha256(pullRequestText(fetch.pr)),
    prompts: {
      author: promptDigest(authorSystem, authorTools),
      judge: promptDigest(judgeSystem, judgeTools),
    },
    models: { author: authorModel, second: secondModel },
  };
  await runArm(runRecord, selected.index, "adjudication", inputs, async (attempt) => {
    try {
      return await adjudicate(fetch, attempt);
    } catch (cause) {
      if (cause instanceof ModelTransportError)
        return { failure: { kind: "infrastructure", reason: cause.message } };
      throw cause;
    }
  });
}
console.log(`${done} row(s) visited for adjudication in run ${runRecord.runId}`);

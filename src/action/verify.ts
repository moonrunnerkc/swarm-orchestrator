import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVersion } from "../build-version.ts";
import { scrubText } from "../evidence/scrub.ts";
import type { ActionContext } from "./environment.ts";
import { commitId } from "./environment.ts";
import { canonicalVerdict, type Verdict, verdictSchemaName } from "./verdict.ts";

/**
 * The producer: fetch the exact objects the event names into a checkout the Action owns, run
 * the verifier over them with candidate commands behind the requested boundary, and write the
 * report, the summary and the verdict document beside the evidence bundle. Nothing here signs
 * or publishes; those are later steps that read what this one wrote.
 */
export interface VerifyOutputs {
  readonly status: number;
  readonly result: Verdict["decision"]["result"];
  readonly directory: string;
  readonly report: string;
  readonly summary: string;
  readonly verdict: string;
  readonly verdictDigest: string;
  readonly artifact: string;
  readonly head: string;
  readonly base: string;
  readonly tree: string | null;
}

interface Spawned {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface VerifyDependencies {
  /** Spawns a process and waits; injected so a test can stand in for the verifier itself. */
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string>; timeoutMs: number },
  ) => Spawned;
  readonly entry: string;
  readonly now: () => number;
}

function defaultEntry(): string {
  // This module is emitted beside the binary's entry: dist/action/verify.js next to dist/swarm-verify.js.
  return fileURLToPath(new URL("../swarm-verify.js", import.meta.url).href).replace(/\.ts$/, ".ts");
}

export const defaultDependencies: VerifyDependencies = {
  spawn: (file, args, options) => {
    const ran = spawnSync(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: 16_000_000,
    });
    return { status: ran.status ?? 1, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
  },
  entry: defaultEntry(),
  now: () => Date.now(),
};

class RefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RefusedError";
  }
}

function digestOf(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function git(
  deps: VerifyDependencies,
  cwd: string,
  home: string,
  args: readonly string[],
): Spawned {
  return deps.spawn("git", ["-c", "credential.helper=", ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: home, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 300_000,
  });
}

function fetched(
  deps: VerifyDependencies,
  cwd: string,
  home: string,
  url: string,
  refs: readonly string[],
  token: string | null,
): Spawned {
  // A token travels on this one command's header and is never written to the checkout's
  // configuration, which candidate commands later see mounted.
  const auth =
    token === null
      ? []
      : [
          "-c",
          `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
        ];
  return git(deps, cwd, home, [
    ...auth,
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    url,
    ...refs,
  ]);
}

/**
 * The Action's result from the verifier's report. A failed check the base already had is the
 * base control's measurement about the base, not a failure of this patch: with the regression
 * dimension passing it does not make the result "not verified", and the comment's reason names
 * it as inherited. A failure the base did not have still does.
 */
export function decideResult(parsed: CiReport | null): Verdict["decision"]["result"] {
  if (parsed === null) return "incomplete";
  const failed =
    parsed.regression === "fail" ||
    parsed.task === "rejected" ||
    (parsed.checks ?? []).some(
      (check) => check.status === "failed" && check.inheritedFromBase !== true,
    );
  return parsed.verified === true
    ? "verified"
    : failed
      ? "not-verified"
      : parsed.refusal
        ? "refused"
        : parsed.regression === "pass" && parsed.task === "unjudged"
          ? "regression-only"
          : "incomplete";
}

/** Resolve what to verify, fetching it into an owned checkout where the caller supplied none. */
function resolveSource(
  context: ActionContext,
  deps: VerifyDependencies,
  directory: string,
  home: string,
) {
  const { inputs, pullRequest } = context;
  if (inputs.workspace !== null && inputs.head !== null && inputs.base !== null) {
    return {
      workspace: resolve(inputs.workspace),
      head: commitId.parse(inputs.head),
      base: commitId.parse(inputs.base),
      eventHead: pullRequest?.head ?? null,
    };
  }
  const workspace = join(directory, "source");
  mkdirSync(workspace, { mode: 0o700 });
  const init = git(deps, workspace, home, ["init", "-q"]);
  if (init.status !== 0) throw new RefusedError(`git init failed: ${init.stderr.slice(0, 500)}`);
  const repository = pullRequest?.baseRepository ?? context.repository;
  const url = inputs.sourceUrl ?? `${context.serverUrl}/${repository}.git`;
  let head: string;
  let base: string;
  if (pullRequest !== null) {
    base = pullRequest.base;
    if (inputs.target === "merge") {
      const mergeRef = `refs/pull/${pullRequest.number}/merge`;
      const ran = fetched(
        deps,
        workspace,
        home,
        url,
        [base, `+${mergeRef}:refs/swarm/merge`],
        inputs.token,
      );
      if (ran.status !== 0)
        throw new RefusedError(
          `the test merge for pull request ${pullRequest.number} is not available (conflicts, or the ref is gone): ${ran.stderr.slice(0, 500)}`,
        );
      const merge = git(deps, workspace, home, [
        "rev-parse",
        "--verify",
        "refs/swarm/merge^{commit}",
      ]);
      const parent = git(deps, workspace, home, ["rev-parse", "--verify", "refs/swarm/merge^2"]);
      if (merge.status !== 0 || parent.status !== 0)
        throw new RefusedError("the fetched merge commit could not be read");
      head = commitId.parse(merge.stdout.trim());
      if (parent.stdout.trim() !== pullRequest.head)
        return {
          workspace,
          head,
          base,
          eventHead: pullRequest.head,
          headChanged: parent.stdout.trim(),
        };
    } else {
      head = pullRequest.head;
      const ran = fetched(deps, workspace, home, url, [base, head], inputs.token);
      if (ran.status !== 0)
        throw new RefusedError(
          `the pull request's head ${head} and base ${base} could not be fetched from ${repository}: ${ran.stderr.slice(0, 500)}`,
        );
    }
    return { workspace, head, base, eventHead: pullRequest.head };
  }
  if (inputs.head === null || inputs.base === null)
    throw new RefusedError("this event carries no pull request; supply head and base to verify");
  head = commitId.parse(inputs.head);
  base = commitId.parse(inputs.base);
  const ran = fetched(deps, workspace, home, url, [base, head], inputs.token);
  if (ran.status !== 0)
    throw new RefusedError(
      `head ${head} and base ${base} could not be fetched: ${ran.stderr.slice(0, 500)}`,
    );
  return { workspace, head, base, eventHead: null };
}

interface CiReport {
  readonly verified?: boolean;
  readonly regression?: string;
  readonly task?: string;
  readonly refusal?: string | null;
  readonly advice?: string;
  readonly unmeasured?: boolean;
  readonly executionTrust?: string;
  readonly assessmentDigest?: string;
  readonly bundleDirectory?: string;
  readonly checks?: readonly {
    readonly id: string;
    readonly status: string;
    readonly inheritedFromBase?: boolean;
  }[];
  readonly sourceIdentity?: { readonly comparisonBase?: string; readonly patchDigest?: string };
  readonly challenges?: {
    readonly satisfied?: boolean;
    readonly requirements?: readonly { readonly id: string; readonly outcome: string }[];
  };
}

/** Run the verification and write everything a later step reads. */
export function runActionVerify(
  context: ActionContext,
  deps: VerifyDependencies = defaultDependencies,
): VerifyOutputs {
  if (context.runnerEnvironment !== "github-hosted" && !context.inputs.allowSelfHosted)
    throw new RefusedError(
      "this Action runs on a disposable GitHub-hosted runner; set allow-self-hosted to true to state otherwise knowingly",
    );
  if (context.eventName === "pull_request_target" && context.inputs.isolation !== "docker")
    throw new RefusedError(
      "a pull_request_target run executes candidate code only behind docker isolation",
    );
  const artifact = `swarm-verify-${randomUUID()}`;
  const directory = mkdtempSync(join(context.runnerTemp, "swarm-verify-"));
  const home = join(directory, "home");
  mkdirSync(home, { mode: 0o700 });
  const report = join(directory, "report.json");
  const summary = join(directory, "summary.md");
  const verdictPath = join(directory, "verdict.json");
  const bundle = join(directory, "bundle");

  const write = (verdict: Verdict): VerifyOutputs => {
    const canonical = canonicalVerdict(verdict);
    writeFileSync(verdictPath, canonical.bytes, { mode: 0o600 });
    return {
      status: verdict.decision.status,
      result: verdict.decision.result,
      directory,
      report,
      summary,
      verdict: verdictPath,
      verdictDigest: canonical.digest,
      artifact,
      head: verdict.head,
      base: verdict.base,
      tree: verdict.tree,
    };
  };
  const goalContractDigest =
    context.inputs.goalContract === null
      ? null
      : digestOf(readFileSync(resolve(context.inputs.goalContract)));
  const skeleton = (
    head: string,
    base: string,
    eventHead: string | null,
  ): Omit<Verdict, "decision" | "evidence" | "tree" | "comparisonBase" | "patchDigest"> => ({
    schema: verdictSchemaName,
    repository: context.pullRequest?.baseRepository ?? context.repository,
    pullRequest: context.pullRequest?.number ?? null,
    target: context.inputs.target,
    head,
    eventHead,
    base,
    verifier: { name: "swarm-verify", version: buildVersion },
    policy: {
      isolation: context.inputs.isolation,
      image: context.inputs.isolation === "docker" ? context.inputs.image : null,
      goalContractDigest,
      oracle: context.inputs.oracle,
      packages: [...context.inputs.packages],
      install: context.inputs.install,
      requireTask: context.inputs.requireTask,
      challenges: context.inputs.challenges,
    },
    execution: {
      eventName: context.eventName,
      runId: context.runId,
      runAttempt: context.runAttempt,
      workflowRef: context.workflowRef,
      runnerEnvironment: context.runnerEnvironment,
      executionTrust: "not-run",
    },
  });
  const noEvidence = {
    reportDigest: null,
    summaryDigest: null,
    assessmentDigest: null,
    bundleChainHead: null,
  };

  let source: ReturnType<typeof resolveSource>;
  try {
    source = resolveSource(context, deps, directory, home);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const head = context.pullRequest?.head ?? context.inputs.head ?? "0".repeat(40);
    const base = context.pullRequest?.base ?? context.inputs.base ?? "0".repeat(40);
    return write({
      ...skeleton(head, base, context.pullRequest?.head ?? null),
      tree: null,
      comparisonBase: null,
      patchDigest: null,
      evidence: noEvidence,
      decision: {
        status: 4,
        verifierStatus: null,
        result: "refused",
        regression: null,
        task: null,
        unmeasured: [],
        reason: reason.slice(0, 2000),
        challenges: null,
      },
    });
  }
  if ("headChanged" in source && source.headChanged !== undefined) {
    return write({
      ...skeleton(source.head, source.base, source.eventHead),
      tree: null,
      comparisonBase: null,
      patchDigest: null,
      evidence: noEvidence,
      decision: {
        status: 4,
        verifierStatus: null,
        result: "head-changed",
        regression: null,
        task: null,
        unmeasured: [],
        reason: `the pull request head moved from ${source.eventHead} to ${source.headChanged} before the test merge was read; rerun on the current head`,
        challenges: null,
      },
    });
  }

  const treeRead = git(deps, source.workspace, home, [
    "rev-parse",
    "--verify",
    `${source.head}^{tree}`,
  ]);
  const tree =
    treeRead.status === 0 && /^[0-9a-f]{40}$/.test(treeRead.stdout.trim())
      ? treeRead.stdout.trim()
      : null;

  const args = [
    deps.entry,
    "ci",
    "--workspace",
    source.workspace,
    "--branch",
    source.head,
    "--base",
    source.base,
    "--json",
    "--summary",
    summary,
    "--bundle",
    bundle,
  ];
  if (context.inputs.isolation === "docker")
    args.push("--isolation", `docker:${context.inputs.image}`, "--require-isolation");
  if (context.inputs.goalContract !== null) {
    args.push("--goal-contract", resolve(context.inputs.goalContract));
    args.push("--challenges", context.inputs.challenges);
  }
  if (context.inputs.oracle !== null) args.push("--oracle", context.inputs.oracle);
  for (const unit of context.inputs.packages) args.push("--package", unit);
  if (context.inputs.install) args.push("--install");
  const ran = deps.spawn(process.execPath, args, {
    cwd: directory,
    env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
    timeoutMs: 1_800_000,
  });
  const reportBytes = scrubText(ran.stdout).value;
  writeFileSync(report, reportBytes, { mode: 0o600 });
  writeFileSync(
    join(directory, "diagnostic.txt"),
    scrubText(ran.stderr).value.slice(0, 1_000_000),
    { mode: 0o600 },
  );
  let parsed: CiReport | null = null;
  try {
    const line =
      reportBytes
        .trim()
        .split("\n")
        .findLast((one) => one.startsWith("{")) ?? "";
    parsed = JSON.parse(line) as CiReport;
  } catch {
    parsed = null;
  }
  let summaryBytes: string | null = null;
  try {
    summaryBytes = readFileSync(summary, "utf8");
  } catch {
    summaryBytes = null;
  }
  let chainHead: string | null = null;
  try {
    chainHead =
      (JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as { chainHead?: string })
        .chainHead ?? null;
  } catch {
    chainHead = null;
  }
  const unmeasured = [
    ...(parsed?.unmeasured ? ["regression"] : []),
    ...(parsed?.checks ?? [])
      .filter((check) => check.status === "not-applicable")
      .map((check) => check.id),
    ...(parsed?.task === "unjudged" ? ["task"] : []),
  ];
  const result = decideResult(parsed);
  const status =
    result === "verified" || (result === "regression-only" && !context.inputs.requireTask)
      ? 0
      : result === "not-verified" || result === "regression-only"
        ? 1
        : 4;
  return write({
    ...skeleton(source.head, source.base, source.eventHead),
    execution: {
      ...skeleton(source.head, source.base, source.eventHead).execution,
      executionTrust: parsed?.executionTrust ?? "not-run",
    },
    tree,
    comparisonBase: parsed?.sourceIdentity?.comparisonBase ?? null,
    patchDigest: parsed?.sourceIdentity?.patchDigest ?? null,
    evidence: {
      reportDigest: digestOf(reportBytes),
      summaryDigest: summaryBytes === null ? null : digestOf(summaryBytes),
      assessmentDigest: parsed?.assessmentDigest ?? null,
      bundleChainHead: chainHead,
    },
    decision: {
      status,
      verifierStatus: ran.status,
      result,
      regression: parsed?.regression ?? null,
      task: parsed?.task ?? null,
      unmeasured,
      reason:
        parsed === null
          ? `the verifier exited ${ran.status} without a report; see diagnostic.txt in the evidence artifact`
          : (parsed.refusal ?? (parsed.verified ? null : (parsed.advice ?? null))),
      challenges: challengesOf(parsed),
    },
  });
}

const challengeOutcomes = [
  "detected",
  "gap",
  "invalid-evidence",
  "unjudged",
  "inapplicable",
] as const;

function challengesOf(parsed: CiReport | null): Verdict["decision"]["challenges"] {
  const requirements = parsed?.challenges?.requirements;
  if (requirements === undefined) return null;
  return {
    satisfied: parsed?.challenges?.satisfied === true,
    requirements: requirements.map((entry) => ({
      id: entry.id,
      outcome: (challengeOutcomes as readonly string[]).includes(entry.outcome)
        ? (entry.outcome as (typeof challengeOutcomes)[number])
        : "unjudged",
    })),
  };
}

/** Write the step's outputs and its summary the way the runner reads them. */
export function publishOutputs(context: ActionContext, outputs: VerifyOutputs): void {
  if (context.outputPath !== null)
    appendFileSync(
      context.outputPath,
      Object.entries({
        status: String(outputs.status),
        result: outputs.result,
        report: outputs.report,
        summary: outputs.summary,
        evidence: outputs.directory,
        verdict: outputs.verdict,
        "verdict-digest": outputs.verdictDigest,
        artifact: outputs.artifact,
        head: outputs.head,
        base: outputs.base,
        tree: outputs.tree ?? "",
        target: context.inputs.target,
      })
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
  if (context.summaryPath !== null) {
    let summary: string;
    try {
      summary = readFileSync(outputs.summary, "utf8");
    } catch {
      summary = `swarm-verify produced no assessment (${outputs.result}). Consult diagnostic.txt in the evidence artifact.\n`;
    }
    appendFileSync(
      context.summaryPath,
      `${summary}\nVerdict ${outputs.verdictDigest} for head ${outputs.head}; evidence in artifact ${outputs.artifact}.\n`,
    );
  }
}

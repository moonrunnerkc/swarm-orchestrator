/**
 * Immutable run and attempt identity for the study's arms.
 *
 * Every run lives under `<working root>/v2/runs/<runId>/`, where the run id names the verifier
 * version, the frame's digest, the harness commit and the moment the run began. The run's
 * manifest (`run.json`) is created once, exclusively, and fixes the budgets: attempt caps and
 * timeouts. Each arm writes each row's attempts as `rows/<NN>.<arm>.attempt-<k>.started.json`
 * (intent, before any effect) and `rows/<NN>.<arm>.attempt-<k>.json` (the result), both with
 * exclusive create, so no attempt is ever overwritten. A resumed run keeps the same id and every
 * earlier attempt, counts an attempt that started and never finished as used, and cannot change
 * the budgets its manifest fixed.
 *
 * Retries are the harness's own, under one written rule (`retryDecision`): only a failure
 * classified as infrastructure (the network, the container daemon, the model endpoint, an
 * interrupted attempt) may be retried, up to the manifest's `maxAttempts`, and every attempt is
 * kept. A failure of the product, the repository or the check is final.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childPath, writeFileInside } from "./containment.mjs";

export const layoutVersion = "v2";
export const arms = ["verifier", "adjudication", "a2"];

export class RunIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunIdentityError";
  }
}

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** `20260929T101500Z` from a Date. */
export function compactTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/**
 * The run id: `[dev-]sv<version>-f<frame digest, 12>-h<harness commit, 12>-<timestamp>`. A
 * development run is labelled in its id, so it can never be read as the study's run.
 */
export function makeRunId({ verifierVersion, frameDigest, harnessCommit, startedAt, development }) {
  if (!/^\d+\.\d+\.\d+([-.][\w.]+)?$/.test(verifierVersion))
    throw new RunIdentityError(`${JSON.stringify(verifierVersion)} is not a verifier version`);
  const frame = String(frameDigest).replace(/^sha256:/, "");
  if (!/^[0-9a-f]{12,}$/.test(frame))
    throw new RunIdentityError("the frame digest is not a sha256");
  if (!/^[0-9a-f]{12,}$/.test(harnessCommit))
    throw new RunIdentityError("the harness commit is not a git object id");
  return `${development ? "dev-" : ""}sv${verifierVersion}-f${frame.slice(0, 12)}-h${harnessCommit.slice(0, 12)}-${compactTimestamp(startedAt)}`;
}

/** Where this layout keeps runs, and the versioned git object clones every run reads from. */
export function layoutPaths(workingRoot) {
  const root = join(workingRoot, layoutVersion);
  return { root, runs: join(root, "runs"), objects: join(root, "objects") };
}

export function runPaths(workingRoot, runId) {
  const run = childPath(layoutPaths(workingRoot).runs, runId);
  return {
    run,
    manifest: join(run, "run.json"),
    rows: join(run, "rows"),
    artifacts: join(run, "artifacts"),
    work: join(run, "work"),
  };
}

/** The harness commit and whether the study scripts differ from it. */
export function harnessIdentity(repositoryRoot) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain", "--", "scripts/ai-pr-study"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (head.status !== 0) throw new RunIdentityError("the harness commit could not be read");
  return { commit: head.stdout.trim(), dirty: status.stdout.trim() !== "" };
}

const manifestKeys = ["verifierVersion", "frameDigest", "harnessCommit"];

/**
 * Create a run's manifest exclusively, or, when resuming, read it and hold the caller to it:
 * the same verifier, frame and harness commit, and no budget of its own. Returns the manifest.
 */
export function openRun(workingRoot, { resume, identity, budgets, development, extra = {} }) {
  if (resume !== undefined) {
    const paths = runPaths(workingRoot, resume);
    if (!existsSync(paths.manifest))
      throw new RunIdentityError(`there is no run ${resume} to resume`);
    const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
    for (const key of manifestKeys)
      if (identity[key] !== undefined && identity[key] !== manifest[key])
        throw new RunIdentityError(
          `run ${resume} was made with ${key} ${manifest[key]}; this invocation has ${identity[key]}, so it cannot resume it`,
        );
    if (budgets !== undefined && Object.keys(budgets).length > 0)
      throw new RunIdentityError(
        `a resumed run keeps the budgets its manifest fixed (${JSON.stringify(manifest.budgets)}); none may be passed on resume`,
      );
    return { ...manifest, paths };
  }
  const startedAt = new Date();
  const runId = makeRunId({ ...identity, startedAt, development });
  const paths = runPaths(workingRoot, runId);
  mkdirSync(paths.rows, { recursive: true, mode: 0o700 });
  mkdirSync(paths.artifacts, { recursive: true, mode: 0o700 });
  const manifest = {
    kind: "ai-pr-study-run",
    layout: layoutVersion,
    runId,
    development: development === true,
    ...identity,
    budgets: { ...defaultBudgets, ...(budgets ?? {}) },
    createdAt: startedAt.toISOString(),
    ...extra,
  };
  const written = writeFileInside(paths.run, "run.json", `${JSON.stringify(manifest, null, 2)}\n`, {
    exclusive: true,
  });
  if (!written.written) throw new RunIdentityError(`run ${runId} already exists`);
  return { ...manifest, paths };
}

export const defaultBudgets = {
  maxAttempts: 3,
  verifierTimeoutMs: 3_600_000,
  installTimeoutMs: 900_000,
  testTimeoutMs: 1_800_000,
  checkTimeoutMs: 900_000,
  reviewerMaxSteps: 30,
};

const pad = (index) => String(index).padStart(2, "0");
const attemptName = (index, arm, attempt, started) =>
  `${pad(index)}.${arm}.attempt-${attempt}${started ? ".started" : ""}.json`;

/** Every attempt of one row's arm, in order, with its intent and (when it finished) its result. */
export function listAttempts(rowsDirectory, index, arm) {
  if (!existsSync(rowsDirectory)) return [];
  const prefix = `${pad(index)}.${arm}.attempt-`;
  const numbers = new Set();
  for (const name of readdirSync(rowsDirectory)) {
    if (!name.startsWith(prefix)) continue;
    const match = name.slice(prefix.length).match(/^(\d+)(\.started)?\.json$/);
    if (match !== null) numbers.add(Number(match[1]));
  }
  return [...numbers]
    .sort((a, b) => a - b)
    .map((attempt) => {
      const read = (started) => {
        const path = join(rowsDirectory, attemptName(index, arm, attempt, started));
        return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
      };
      return { attempt, started: read(true), result: read(false) };
    });
}

/**
 * Write an attempt's intent (before any effect) exclusively. Returns the attempt number. The
 * caller passes the identity fields every attempt carries.
 */
export function beginAttempt(rowsDirectory, index, arm, fields) {
  for (let attempt = listAttempts(rowsDirectory, index, arm).length + 1; ; attempt += 1) {
    const name = attemptName(index, arm, attempt, true);
    const record = { ...fields, index, arm, attempt, startedAt: new Date().toISOString() };
    const written = writeFileInside(rowsDirectory, name, `${JSON.stringify(record, null, 2)}\n`, {
      exclusive: true,
    });
    if (written.written) return { attempt, record };
  }
}

/** Write an attempt's result exclusively; an existing result is never replaced. */
export function finishAttempt(rowsDirectory, index, arm, attempt, result) {
  const name = attemptName(index, arm, attempt, false);
  const written = writeFileInside(rowsDirectory, name, `${JSON.stringify(result, null, 2)}\n`, {
    exclusive: true,
  });
  if (!written.written)
    throw new RunIdentityError(`attempt ${attempt} of row ${index} (${arm}) already has a result`);
  return written.path;
}

const infrastructurePatterns = [
  /Could not resolve host|Connection reset|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|unable to access 'https:/i,
  /Cannot connect to the Docker daemon|docker: Error response from daemon|error during connect/i,
  /npm ERR! (code )?(E(CONN|TIMEDOUT|AI_AGAIN|NOTFOUND)|FETCH_ERROR)|network request to .* failed/i,
  /\b(502|503|504) (Bad Gateway|Service Unavailable|Gateway Time-?out)\b|HTTP 5\d\d|rate limit/i,
  /model endpoint|model transport/i,
];

/**
 * Whether a finished attempt's failure is infrastructure: the harness's environment, never the
 * pull request, the product or the check. A result with no failure is final.
 */
export function classifyFailure(result) {
  if (result === null)
    return { kind: "infrastructure", reason: "the attempt started and never finished" };
  if (result.failure === undefined || result.failure === null)
    return { kind: "none", reason: "the attempt completed" };
  if (result.failure.kind === "infrastructure")
    return { kind: "infrastructure", reason: result.failure.reason };
  const text = String(result.failure.reason ?? "");
  if (infrastructurePatterns.some((pattern) => pattern.test(text)))
    return { kind: "infrastructure", reason: text };
  return { kind: result.failure.kind ?? "final", reason: text };
}

/**
 * The written replacement rule: whether a row's arm needs a new attempt. A completed attempt or
 * a non-infrastructure failure is final; an infrastructure failure (including an attempt that
 * never finished) may be retried while fewer than `maxAttempts` attempts exist.
 */
export function retryDecision(attempts, maxAttempts) {
  if (attempts.length === 0) return { run: true, reason: "no attempt yet" };
  const last = attempts.at(-1);
  const failure = classifyFailure(last.result);
  if (failure.kind !== "infrastructure")
    return { run: false, reason: `attempt ${last.attempt} is final (${failure.reason})` };
  if (attempts.length >= maxAttempts)
    return {
      run: false,
      reason: `attempt ${last.attempt} failed on infrastructure (${failure.reason}) and the run's ${maxAttempts} attempts are spent`,
    };
  return {
    run: true,
    reason: `attempt ${last.attempt} failed on infrastructure (${failure.reason}); retry ${attempts.length + 1} of ${maxAttempts}`,
    retryOf: last.attempt,
  };
}

/** The attempt that stands for a row's arm: the last one with a result, and every attempt kept. */
export function standingAttempt(attempts) {
  const finished = attempts.filter((entry) => entry.result !== null);
  return {
    standing: finished.at(-1)?.result ?? null,
    history: attempts.map((entry) => ({
      attempt: entry.attempt,
      startedAt: entry.started?.startedAt ?? null,
      finished: entry.result !== null,
      failure: classifyFailure(entry.result),
    })),
  };
}

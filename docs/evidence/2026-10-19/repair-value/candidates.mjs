/**
 * Reading a launch's candidates off its own chain: the ledger with each record's payload, the
 * stage each candidate came from (the first implementation loop, then one per repair), what the
 * stage's model calls cost, and a candidate's patch against the base in `git diff` form. Shared
 * by the O1 reconstruction and the per-candidate scoring of later launches. Nothing here reaches a
 * model or a launch's workspace.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Every record of one ledger, with its payload read from the session's blobs: beside it as a packed
 * launch keeps them (`<session>.blobs`), or a live session's own `blobs` directory.
 */
export function loadLedger(ledger, blobs = ledger.replace(/\.ledger\.jsonl$/, ".blobs")) {
  return readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const record = JSON.parse(line);
      const name = record.payloadDigest?.replace("sha256:", "");
      let payload = null;
      for (const file of [join(blobs, `${name}.json`), join(blobs, name ?? "")]) {
        if (name !== undefined && existsSync(file)) {
          const bytes = readFileSync(file, "utf8");
          try {
            payload = JSON.parse(bytes);
          } catch {
            payload = bytes;
          }
          break;
        }
      }
      return { ...record, payload };
    });
}

/**
 * One stage per model loop, in order: attempt 0 is the first implementation, attempt N the Nth
 * repair. A loop ends with its own `session-stopped` record (the one carrying token counts; the
 * harness's own stop record carries none), and its gate cycle runs after it, up to the
 * diagnostics or acceptance gate's record of that attempt.
 */
export function stageBoundaries(records) {
  const stops = records.filter(
    (one) => one.type === "session-stopped" && typeof one.payload?.inputTokens === "number",
  );
  return stops.map((stop, index) => {
    const attempt = index;
    const from = index === 0 ? -1 : stops[index - 1].sequence;
    const closing = records.filter(
      (one) =>
        one.type === "gate-run" &&
        one.payload.attempt === attempt &&
        one.sequence > stop.sequence &&
        ["task-diagnostics", "task-acceptance"].includes(one.payload.gateId),
    );
    return {
      name: attempt === 0 ? "attempt-0" : `repair-${attempt}`,
      attempt,
      startedAfter: from,
      stoppedAt: stop.sequence,
      gatesFrom: stop.sequence,
      gatesTo: Math.max(stop.sequence, ...closing.map((one) => one.sequence)),
    };
  });
}

/** The stage's model calls: count, tokens as each call reported them, and response time. */
export function stageUsage(records, stage) {
  const calls = records.filter(
    (one) => one.type === "model-call" && one.sequence > stage.startedAfter && one.sequence <= stage.stoppedAt,
  );
  const started = records.find(
    (one) => one.type === "model-call-started" && one.sequence > stage.startedAfter && one.sequence <= stage.stoppedAt,
  );
  const stop = records.find((one) => one.sequence === stage.stoppedAt);
  return {
    calls: calls.length,
    callsWithoutUsage: calls.filter((one) => typeof one.payload.inputTokens !== "number").length,
    inputTokens: calls.reduce((sum, one) => sum + (one.payload.inputTokens ?? 0), 0),
    outputTokens: calls.reduce((sum, one) => sum + (one.payload.outputTokens ?? 0), 0),
    responseMs: Math.round(
      calls.reduce((sum, one) => sum + (one.payload.performance?.responseTimeMs ?? 0), 0),
    ),
    loopWallMs: started === undefined ? 0 : stop.timestamp - started.timestamp,
    steps: stop.payload.steps,
    stopReason: stop.payload.stopReason,
  };
}

/** One file's change against the base, as `git diff` writes it, from a throwaway repository. */
export function candidatePatch(baseText, text, path) {
  const directory = mkdtempSync(join(tmpdir(), "swarm-candidate-patch-"));
  const git = (...args) => {
    const ran = spawnSync(
      "git",
      ["-c", "user.name=candidate", "-c", "user.email=candidate@localhost", "-c", "core.autocrlf=false", ...args],
      { cwd: directory, encoding: "utf8" },
    );
    if (ran.status !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr}`);
    return ran.stdout;
  };
  try {
    git("init", "-q");
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), baseText);
    git("add", path);
    git("commit", "-q", "-m", "base");
    writeFileSync(join(directory, path), text);
    return git("diff", "--binary");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

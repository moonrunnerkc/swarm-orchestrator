import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readSessionEvidence } from "../durable/session-evidence.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { BlindingAudit } from "./feedback-study.ts";
import {
  fileSetOfSession,
  type InvocationFileSet,
  type InvocationUsage,
  usageOfModelCalls,
} from "./reach-pressure.ts";

/**
 * One agent invocation's session, read after it ended and moved out of the home it ran under.
 *
 * Every invocation of the study runs under a home and a scratch directory of its own, and its
 * session is copied out and both removed as soon as the invocation ends. The scratch directory is
 * not a detail: the agent gives every command it runs a home under its own scratch directory, so a
 * private home with a shared scratch directory still put every tool process in the shared home. A home shared between invocations holds every
 * earlier session, prompts included, and an interpreter the tool policy allows can read a file
 * the lexical guard does not name: the neutral arm could read the prompt the reach arm of the same
 * pair was given. With one home per invocation there is nothing of another invocation to read.
 */
export interface AgentSession {
  readonly runId: string | null;
  readonly ledgerDigest: string | null;
  readonly ledgerRecords: number | null;
  readonly fileSet: InvocationFileSet | null;
  readonly usage: InvocationUsage;
  readonly stopReason: string | null;
  readonly blinding: BlindingAudit;
}

const unknownUsage: InvocationUsage = {
  modelCalls: null,
  failedCalls: null,
  inputTokens: null,
  outputTokens: null,
  status: "unknown",
};

/** The run id the CLI printed last on its `--json` output, or null where it printed none. */
export function runIdOf(stdout: string): string | null {
  for (const line of stdout.split("\n").reverse()) {
    try {
      const parsed: unknown = JSON.parse(line);
      const runId = (parsed as { runId?: unknown } | null)?.runId;
      if (typeof runId === "string" && /^[a-zA-Z0-9_-]+$/.test(runId)) return runId;
    } catch {}
  }
  return null;
}

/**
 * Every place outside this invocation's own workspace that the session names, among the places
 * the held-back half or another invocation lives: the mined checkouts, whose history holds the
 * pull request's test file, and the study's own stores. Named by the text that follows each root
 * up to the first character a path cannot hold, so a reference is shown and not only counted.
 * A path is the invocation's own where it is one of its own paths, lies under one, or is an
 * ancestor of one; the last is what a wrapped, truncated or partly coloured rendering of its own
 * path leaves, and it is also a bare mention of a directory above the workspace, which names
 * nothing held there.
 *
 * What this can and cannot see: it reads every payload the session recorded, tool calls and
 * their outputs alike, so a path the agent named or a command printed is found. A process the
 * agent started that read a file and printed nothing about it is not.
 */
export function blindingReferences(input: {
  readonly texts: readonly string[];
  readonly forbiddenRoots: readonly string[];
  /** This invocation's own workspace and home, which it may name freely. */
  readonly ownPaths: readonly string[];
}): string[] {
  const found = new Set<string>();
  for (const text of input.texts) {
    for (const root of input.forbiddenRoots) {
      let at = text.indexOf(root);
      while (at !== -1) {
        const rest = text.slice(at);
        // A path ends at the first character a path here cannot hold. The payloads are JSON
        // text, where every escape begins with a backslash: a colourised tool output ends a path
        // with `\u001b[39m`, and reading through it made the agent's own workspace look like
        // somewhere else. A full stop or comma after a path in prose is not part of it either.
        const end = rest.search(/[^A-Za-z0-9._~@+%=/-]/);
        const reference = (end === -1 ? rest : rest.slice(0, end)).replace(/[.,]+$/, "");
        // An ancestor of the invocation's own path is how that path reads when a tool wraps it
        // at a column, truncates it or colours part of it: generation 3 of the feedback study
        // recorded its own workspace hard-wrapped by a stack trace as `…/g3/runs/lo`. A path
        // into anything that is not its own, a sibling arm, a mined checkout or a stored oracle,
        // is never an ancestor of its own and is still named.
        const own = input.ownPaths.some(
          (path) =>
            reference === path || reference.startsWith(`${path}/`) || path.startsWith(reference),
        );
        if (!own) found.add(reference.slice(0, 240));
        at = text.indexOf(root, at + root.length);
      }
    }
  }
  return [...found].sort();
}

/** The reason the session's own loop stopped, from its last top-level `session-stopped` record. */
function stopReasonOf(
  payloads: readonly { readonly type: string; readonly payload: unknown }[],
): string | null {
  let reason: string | null = null;
  for (const entry of payloads) {
    if (entry.type !== "session-stopped") continue;
    const payload = entry.payload as { stopReason?: unknown; repair?: unknown };
    // A gate-repair loop inside the invocation records its own stop; the invocation's is the other.
    if (payload.repair === true) continue;
    if (typeof payload.stopReason === "string") reason = payload.stopReason;
  }
  return reason;
}

/**
 * Copies the invocation's session out of its home into `keptRoot`, reads it, audits it, and
 * removes the home. A session that cannot be read keeps its run id and reads as unknown usage
 * and an unchecked audit, which is never a clean one.
 */
export async function takeAgentSession(input: {
  readonly stdout: string;
  readonly home: string;
  /** The invocation's own scratch directory, under which its tools' home lives. Removed too. */
  readonly scratch?: string;
  readonly keptRoot: string;
  readonly forbiddenRoots: readonly string[];
  readonly ownWorkspace: string;
}): Promise<AgentSession> {
  const runId = runIdOf(input.stdout);
  const unread: AgentSession = {
    runId,
    ledgerDigest: null,
    ledgerRecords: null,
    fileSet: null,
    usage: unknownUsage,
    stopReason: null,
    blinding: { checked: false, references: [] },
  };
  try {
    if (runId === null) return unread;
    const kept = join(input.keptRoot, runId);
    await cp(join(input.home, ".swarm", "sessions", runId), kept, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const evidence = await readSessionEvidence(input.keptRoot, runId);
    const entries = evidence.records.map((record) => ({
      type: record.type,
      payload: evidence.payloads.get(record.payloadDigest),
    }));
    return {
      runId,
      ledgerDigest: digestOfBytes(await readFile(join(kept, "ledger.jsonl"), "utf8")),
      ledgerRecords: evidence.records.length,
      // The payloads were read and digest-checked as JSON, which is what the replay reads them as.
      fileSet: fileSetOfSession({
        records: () => evidence.records,
        payloads: () => evidence.payloads,
      } as Parameters<typeof fileSetOfSession>[0]),
      usage: usageOfModelCalls(entries),
      stopReason: stopReasonOf(entries),
      blinding: {
        checked: true,
        references: blindingReferences({
          texts: entries.map((entry) => JSON.stringify(entry.payload ?? null)),
          forbiddenRoots: input.forbiddenRoots,
          ownPaths: [
            input.ownWorkspace,
            input.home,
            ...(input.scratch === undefined ? [] : [input.scratch]),
          ],
        }),
      },
    };
  } catch {
    return unread;
  } finally {
    await rm(input.home, { recursive: true, force: true });
    if (input.scratch !== undefined) await rm(input.scratch, { recursive: true, force: true });
  }
}

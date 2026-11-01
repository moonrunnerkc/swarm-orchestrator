import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { snapshotWorkingTree } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { estimateTokens } from "./context.ts";
import { gitText } from "./git.ts";
import { type ModelClient, ModelError } from "./model.ts";
import { truncate } from "./prompt.ts";
import type { RequirementRecord } from "./requirement-record.ts";

/** What the reviewer writes, alone on a line, when it finds nothing. */
export const noFinding = "NO_FINDING";

export const reviewPrompt = [
  "You review a change another engineer made, with a fresh context. You see the task, the",
  "requirements they recorded and their diff. Their tests already pass. Look for one case the task",
  "asks for that the change gets wrong.",
  "",
  "Reply with exactly one of these:",
  "",
  `1. ${noFinding} on a line of its own, when you find no such case.`,
  "",
  "2. One sentence naming the case, then one fenced bash block holding one command that exits 0",
  "   when the task's behavior is right and nonzero when it is wrong. It runs from the repository",
  "   root against the changed tree. It must not change the repository's files: use an inline",
  "   script, or write only under .swarm/review/.",
].join("\n");

export type ParsedReview =
  | { readonly kind: "no-finding" }
  | { readonly kind: "finding"; readonly finding: string; readonly command: string }
  | { readonly kind: "unusable" };

const block = /```(?:bash|sh|shell)?[ \t]*\n([\s\S]*?)\n?```/;

export function parseReview(reply: string): ParsedReview {
  const found = reply.match(block);
  const command = (found?.[1] ?? "").trim();
  if (found !== null && command.length > 0) {
    const said = reply.slice(0, found.index).trim().slice(0, 500);
    return { kind: "finding", finding: said.length > 0 ? said : "(no sentence given)", command };
  }
  if (new RegExp(`^\\s*${noFinding}\\s*$`, "m").test(reply)) return { kind: "no-finding" };
  return { kind: "unusable" };
}

export interface ReviewOutcome {
  /**
   * confirmed: the reviewer's own check failed on the delivered tree. refuted: it passed.
   * no-finding, unusable (no reply form, or a command the policy refused), model-error.
   */
  readonly outcome: "confirmed" | "refuted" | "no-finding" | "unusable" | "model-error";
  readonly finding: string | null;
  readonly command: string | null;
  readonly exitCode: number | null;
  /** The command changed the tree, and the tree was put back as it was. */
  readonly restored: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inferenceMs: number | null;
  /** What the coding model reads when a confirmed finding reopens the work. */
  readonly handoff: string | null;
}

/** Puts the managed worktree back to a snapshot taken against the same base. */
async function restore(workspace: string, base: string, patch: string): Promise<void> {
  await gitText(workspace, ["reset", "-q", "--hard", base]);
  await gitText(workspace, ["clean", "-qfd", "-e", ".swarm"]);
  await gitText(workspace, ["apply", "--binary", "--whitespace=nowarn", patch]);
}

/**
 * One fresh-context review of the delivered change. A finding counts only when its own command
 * fails on the tree; even then it reopens the work and decides nothing: the verifier still
 * judges completion.
 */
export async function runReview(input: {
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  readonly task: string;
  readonly record: RequirementRecord;
  readonly diff: string;
  readonly workspace: string;
  readonly base: string;
  readonly directory: string;
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
}): Promise<ReviewOutcome> {
  const requirements = input.record.requirements.map(({ id, text, kind }) => ({ id, text, kind }));
  const prompt = `Task:\n${input.task}\n\nRequirements:\n${JSON.stringify(requirements, null, 1)}\n\nDiff:\n${truncate(input.diff, 40_000)}`;
  const empty = {
    finding: null,
    command: null,
    exitCode: null,
    restored: false,
    inputTokens: 0,
    outputTokens: 0,
    inferenceMs: null,
    handoff: null,
  };
  let reply: Awaited<ReturnType<ModelClient["complete"]>>;
  try {
    reply = await input.model.complete(
      [
        { role: "system", content: reviewPrompt },
        { role: "user", content: prompt },
      ],
      { signal: input.signal, maxTokens: input.turnTokens },
    );
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    return { ...empty, outcome: "model-error", finding: error.message };
  }
  const tokens = {
    inputTokens: reply.inputTokens ?? estimateTokens(reviewPrompt + prompt),
    outputTokens: reply.outputTokens ?? estimateTokens(reply.content),
    inferenceMs: reply.inferenceMs,
  };
  const parsed = parseReview(reply.content);
  await input.evidence.record({
    type: "model-call",
    actor: input.model.model,
    provenance: ["model"],
    payload: { review: true, reply: reply.content, ...tokens, parsed: parsed.kind },
  });
  if (parsed.kind !== "finding") return { ...empty, ...tokens, outcome: parsed.kind };

  await mkdir(input.directory, { recursive: true });
  const before = await snapshotWorkingTree(
    input.workspace,
    input.base,
    join(input.directory, "before.patch"),
  );
  const ran = await input.chokepoint.run(parsed.command);
  const after = await snapshotWorkingTree(
    input.workspace,
    input.base,
    join(input.directory, "after.patch"),
  );
  const restored = after.sha256 !== before.sha256;
  if (restored) await restore(input.workspace, input.base, before.path);
  const shared = { ...tokens, finding: parsed.finding, command: parsed.command, restored };
  if (ran.decision !== "allowed")
    return { ...shared, outcome: "unusable", exitCode: null, handoff: null };
  if (ran.exitCode === 0) return { ...shared, outcome: "refuted", exitCode: 0, handoff: null };
  return {
    ...shared,
    outcome: "confirmed",
    exitCode: ran.exitCode,
    handoff: [
      `A reviewer with a fresh context reports a case your change gets wrong: ${parsed.finding}`,
      `Its check, run on your tree, exited ${ran.exitCode}:`,
      `$ ${parsed.command}`,
      truncate(ran.output),
      "If the case is part of the task, fix it and add a test for it. If the check is wrong, say why in R1's assumptions. Then mark the task complete again; the verifier still decides.",
    ].join("\n"),
  };
}

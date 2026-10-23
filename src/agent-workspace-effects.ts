import type { ToolCallOutcome } from "./core/model-client.ts";
import type { ToolInvocation, ToolInvoker } from "./core/tool-invoker.ts";
import { workspaceEffectLine } from "./core/working-state.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { openWorkspaceIdentity, type TreeChange } from "./gates/scratch-index.ts";

/**
 * What each shell command did to the workspace, measured rather than read out of the command.
 *
 * A command can move, rewrite or delete files without a recorded edit, and both the working state
 * and the worker used to be told so in the abstract ("shell commands may also change files")
 * because the harness did not look. Held-out block 1's fastify control renamed eleven files with
 * `mv` and the working state still counted the tree as the one its earlier checks ran on. So the
 * tree is measured before and after every shell command, through one scratch index kept for the
 * run (src/gates/scratch-index.ts), and the result says which paths the command changed. Where
 * the measurement fails, the result says that instead, and the working state reads the command
 * as one that may have changed anything.
 *
 * A move or a deletion leaves the question every mechanical change has: what still names the old
 * path. The measured tree is searched for the old path's name where a path would be written
 * (after a slash or a quote), and what is found is listed, bounded. That is a lexical aid, not a
 * resolution of imports; a reference built at run time is not found.
 *
 * Each measurement is put on the chain beside the call it measured, so the line the worker reads
 * is a harness observation with a record, like the exit status.
 */
export interface WorkspaceEffectOptions {
  readonly workspace: string;
  readonly baseRef: string;
  readonly evidence: EvidenceRecorder;
  /** Tools whose effect is measured: the shell. */
  readonly measured: ReadonlySet<string>;
  /** Tools that write through the file tools, after which the last measurement is stale. */
  readonly writers: ReadonlySet<string>;
}

export interface MeasuredInvoker {
  readonly invoker: ToolInvoker;
  close(): Promise<void>;
}

const maxChangesShown = 20;
const maxReferencesShown = 12;

const evidenceTrailer = /\n\[evidence record sha256:[0-9a-f]{64} kind [^\]]*\]$/;

/** The output with one harness line put before the evidence trailer, so the trailer stays last. */
export function insertBeforeTrailer(output: string, line: string): string {
  const trailer = evidenceTrailer.exec(output);
  return trailer === null
    ? `${output}\n${line}`
    : `${output.slice(0, trailer.index)}\n${line}${trailer[0]}`;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a removed file's path is still written: its name after a slash or a quote, with or
 * without an extension, closed by a quote, a slash, whitespace or the end of the line.
 */
export function referencePattern(path: string): string | null {
  const name = path.split("/").at(-1) ?? path;
  const stem = name.replace(/(\.d)?\.[A-Za-z0-9]+$/, "");
  if (stem.length < 3) return null;
  return `[/'"\`]${escapeRegex(stem)}(\\.[A-Za-z0-9]+)*(['"\`/[:space:]]|$)`;
}

export function withWorkspaceEffects(
  inner: ToolInvoker,
  options: WorkspaceEffectOptions,
): MeasuredInvoker {
  let identity: ReturnType<typeof openWorkspaceIdentity> | null = null;
  const opened = () => {
    identity ??= openWorkspaceIdentity({
      workspaceRoot: options.workspace,
      baseRef: options.baseRef,
    });
    return identity;
  };
  // The tree as last measured, or null where a file tool has written since.
  let known: string | null = null;

  const measure = async (): Promise<{ tree: string } | { unmeasured: string }> => {
    try {
      return { tree: await (await opened()).measure() };
    } catch (cause) {
      return { unmeasured: String((cause as Error)?.message ?? cause).split("\n")[0] ?? "" };
    }
  };

  async function invokeMeasured(invocation: ToolInvocation): Promise<ToolCallOutcome> {
    const before = known === null ? await measure() : { tree: known };
    const outcome = await inner.invoke(invocation);
    const after = await measure();
    known = "tree" in after ? after.tree : null;
    let changes: readonly TreeChange[] = [];
    let unmeasured: string | null = null;
    if ("tree" in before && "tree" in after) {
      try {
        changes = await (await opened()).changes(before.tree, after.tree);
      } catch (cause) {
        unmeasured = String((cause as Error)?.message ?? cause).split("\n")[0] ?? "";
      }
    } else
      unmeasured =
        "unmeasured" in before ? before.unmeasured : (after as { unmeasured: string }).unmeasured;
    const references = unmeasured === null ? await leftBehind(changes).catch(() => null) : null;
    await options.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "workspace-effect-v1",
        callId: invocation.callId,
        toolName: invocation.toolName,
        dispatched: !outcome.failed,
        before: "tree" in before ? before.tree : null,
        after: "tree" in after ? after.tree : null,
        unmeasured,
        changes: changes.slice(0, 200),
        changeCount: changes.length,
        references: references ?? [],
      }),
    });
    // A refused call ran nothing; it is told nothing about the workspace unless it changed.
    if (outcome.failed && unmeasured === null && changes.length === 0) return outcome;
    const lines = [
      workspaceEffectLine(
        unmeasured === null
          ? {
              changes: changes.slice(0, maxChangesShown),
              more: Math.max(0, changes.length - maxChangesShown),
            }
          : { unmeasured },
      ),
      ...(references === null || references.length === 0
        ? []
        : [
            `[paths this command removed are still named at: ${references.join("; ")}${references.length >= maxReferencesShown ? "; and possibly more" : ""}]`,
          ]),
    ];
    return { ...outcome, output: insertBeforeTrailer(outcome.output, lines.join("\n")) };
  }

  async function leftBehind(changes: readonly TreeChange[]): Promise<readonly string[]> {
    const removed = changes
      .flatMap((change) =>
        change.status === "D" ? [change.path] : change.status === "R" ? [change.from ?? ""] : [],
      )
      .filter((path) => path.length > 0);
    const patterns = removed.map(referencePattern).filter((one): one is string => one !== null);
    if (patterns.length === 0) return [];
    const found = await (await opened()).matches(patterns.join("|"), maxReferencesShown);
    return found.map((line) => (line.length > 160 ? `${line.slice(0, 160)}...` : line));
  }

  return {
    invoker: {
      async invoke(invocation) {
        if (options.measured.has(invocation.toolName)) return invokeMeasured(invocation);
        const outcome = await inner.invoke(invocation);
        if (options.writers.has(invocation.toolName) && !outcome.failed) known = null;
        return outcome;
      },
    },
    async close() {
      if (identity !== null) await (await identity).close();
    },
  };
}

import { type FileEdit, readEditBlock, readWriteBlock } from "../tools/file-edit.ts";

/** What the model writes, alone on a line, when it considers the task done. */
export const completionMarker = "SWARM_TASK_COMPLETE";

/** Bytes of command output (or verifier failure) a turn carries; the rest is cut from the middle. */
export const outputCap = 10_000;

export const systemPrompt = [
  "You are a software engineer working in a git repository. You run commands with bash and change",
  "files with edit and write blocks.",
  "",
  "Every reply contains exactly one of these:",
  "",
  "1. One fenced bash block holding one command. The harness runs it from the repository root,",
  "   non-interactively, and replies with its exit code and output.",
  "",
  "```bash",
  "your command here",
  "```",
  "",
  "2. One fenced edit block, naming one file after `edit`, with one or more SEARCH and REPLACE",
  "   parts. Each SEARCH part must match the file exactly once, whitespace included; if one matches",
  "   nothing or several places, nothing in the file changes and you are told which. The harness",
  "   reads edit and write blocks itself: `edit` and `write` are not shell commands.",
  "",
  "```edit path/to/file",
  "<<<<<<< SEARCH",
  "the lines as the file has them now",
  "=======",
  "the lines that replace them",
  ">>>>>>> REPLACE",
  "```",
  "",
  "   Or one fenced write block, naming one file after `write`, holding the file's whole new text.",
  "   It creates the file, and its directories, or replaces all of it. Where the text holds a line",
  "   of three backticks, open and close the block with four.",
  "",
  "```write path/to/file",
  "the whole text of the file",
  "```",
  "",
  "3. One fenced requirements block: a JSON array that records what the task requires and which",
  "   tests show it. R1 is the task itself; keep its id. Add R2 and on for parts you separate.",
  '   Each entry: {"id": "R1", "text": "...", "kind": "fix" | "feature" | "refactor" | "upgrade" | "other",',
  '   "assumptions": ["..."], "evidence": {"tests": [{"name": "test name"}], "checks": ["check name"],',
  '   "structure": [{"path": "file", "contains": "text"}], "packages": [{"name": "pkg", "ecosystem": "npm", "version": "x.y.z"}]}}.',
  '   A test is named by its title, its suite, or a path such as "suite > title". A check is one',
  "   the project declares (package scripts such as test, lint, build); a command you ran is not.",
  "   A package's version is the one the task asks for: exact, or a range such as 9.x where the",
  "   task gives one, never simply what you installed.",
  "   Send it early and again whenever the mapping changes.",
  "",
  "```requirements",
  '[{"id": "R1", "text": "...", "kind": "feature", "evidence": {"tests": [{"name": "..."}]}}]',
  "```",
  "",
  `4. ${completionMarker} on a line of its own, when the task is done.`,
  "",
  "An independent verifier then runs the project's checks on your working tree in a clean checkout",
  "and decides each requirement's status from executed results only: satisfied, failed,",
  "unverified or blocked. Your own statements never decide it. A fix or feature needs a test that",
  "fails before your change and passes after it; a refactor needs the existing tests to keep",
  "passing; an upgrade needs the new version in the lockfile. If anything is not satisfied, the",
  "verifier's findings come back to you and you continue.",
  "",
  "Write scratch files (helper scripts, notes) under .swarm/scratch/: nothing under .swarm/ is",
  "delivered, and paths outside the repository are refused.",
  "",
  "Change only what the task needs: do not delete or rewrite files it does not concern, and keep",
  "to the versions and limits it states. Your report lists every file you change.",
  "",
  "Change source, tests, manifests and lockfiles as the task needs. The base commit's own tests",
  "still judge your change: rewriting a test's expectation does not make a failing original pass.",
].join("\n");

export type ParsedReply =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "edit"; readonly edit: FileEdit }
  | { readonly kind: "requirements"; readonly json: string; readonly complete: boolean }
  | { readonly kind: "complete" }
  | { readonly kind: "malformed"; readonly reason: string };

// A fence of three or more backticks closes on the same number, so a write block of four can
// hold a file whose text has a line of three. What follows the language names the edited file.
const fenced = /(?<!`)(`{3,})([a-z]*)(?:[ \t]+([^\n]*?))?[ \t]*\n([\s\S]*?)\n?(?<!`)\1(?!`)/g;
const markerCommand = new RegExp(`^(?:echo\\s+)?(["']?)${completionMarker}\\1$`);
const shells = new Set(["", "bash", "sh", "shell"]);
const editors = new Set(["edit", "write"]);

export function parseReply(content: string): ParsedReply {
  const blocks = [...content.matchAll(fenced)].map((match) => ({
    language: match[2] ?? "",
    info: match[3] ?? "",
    raw: match[4] ?? "",
    body: (match[4] ?? "").trim(),
  }));
  const commands = blocks.filter((block) => shells.has(block.language));
  const records = blocks.filter((block) => block.language === "requirements");
  const edits = blocks.filter((block) => editors.has(block.language));
  const outside = content.replace(fenced, "");
  const marked = new RegExp(`^\\s*${completionMarker}\\s*$`, "m").test(outside);
  // An edit or write block whose own text holds a fence closes early, and its rest reads as more.
  const fourBackticks =
    "where a block's text holds a line of three backticks, fence the block with four";
  if (commands.length + records.length + edits.length > 1) {
    // A bare fence after an edit or write block is that block's own text closing it early; two
    // whole blocks are two changes, which go in two replies (t6, 2026-11-03, sent two writes).
    const closedEarly = edits.length > 0 && blocks.some((block) => block.language === "");
    return {
      kind: "malformed",
      reason: closedEarly
        ? `the reply has more than one fenced block; ${fourBackticks}`
        : "the reply has more than one fenced block; send one block a reply, and the next in the next",
    };
  }
  const [edit] = edits;
  if (edit !== undefined) {
    // A fence left over means the block closed early, on a line of its own text.
    if (/^`{3,}/m.test(outside)) {
      return {
        kind: "malformed",
        reason: `the ${edit.language} block closed before its end; ${fourBackticks}`,
      };
    }
    const read =
      edit.language === "edit"
        ? readEditBlock(edit.info, edit.raw)
        : readWriteBlock(edit.info, edit.raw);
    return "malformed" in read
      ? { kind: "malformed", reason: read.malformed }
      : { kind: "edit", edit: read };
  }
  const [record] = records;
  if (record !== undefined) return { kind: "requirements", json: record.body, complete: marked };
  const [command] = commands;
  // The marker put in a bash block, bare or echoed, says the same thing as the marker alone; local
  // models do it after a requirements block (seen on dossier, 2026-10-31), and running it as a
  // command would only print it back.
  if (command !== undefined && markerCommand.test(command.body)) return { kind: "complete" };
  if (command === undefined) {
    return marked
      ? { kind: "complete" }
      : {
          kind: "malformed",
          reason:
            "the reply has no bash, edit, write or requirements block, and no completion marker",
        };
  }
  return command.body.length === 0
    ? { kind: "malformed", reason: "the bash block is empty" }
    : { kind: "command", command: command.body };
}

/**
 * The reply as the loop reads it. The content comes first. A server's reasoning parser moves
 * everything before a stray `</think>` out of it (Rapid-MLX with thinking off, 2026-11-01), so a
 * reply form found only with the reasoning put back is still the model's reply.
 */
export function readReply(
  content: string,
  reasoning: string | undefined,
): { readonly text: string; readonly parsed: ParsedReply; readonly fromReasoning: boolean } {
  const parsed = parseReply(content);
  if (parsed.kind !== "malformed" || reasoning === undefined) {
    return { text: content, parsed, fromReasoning: false };
  }
  const text = `${reasoning}\n\n${content}`.trim();
  const whole = parseReply(text);
  return whole.kind === "malformed"
    ? { text: content, parsed, fromReasoning: false }
    : { text, parsed: whole, fromReasoning: true };
}

/** Keeps the start and the end, which is where a command's errors and summaries are. */
export function truncate(text: string, cap: number = outputCap): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= cap) return text;
  const half = Math.floor(cap / 2);
  const omitted = bytes.length - 2 * half;
  return `${bytes.subarray(0, half).toString()}\n[... ${omitted} bytes omitted ...]\n${bytes.subarray(bytes.length - half).toString()}`;
}

const beforeTheEnd =
  "Whatever stands when they end is verified as it is: send the requirements block that maps the tests showing your change, and mark the task complete once it is done. The verifier runs every check at the base too, so there is no need to check the base yourself.";

/**
 * Said when a fifth of the turns remain (ten at most), so a run does not spend its end on checks
 * that are not the change. Runs of fewer than five turns get no notice.
 */
export function stepsLeftNotice(left: number, max: number): string | null {
  const at = Math.min(10, Math.floor(max / 5));
  if (at < 1 || left !== at) return null;
  const turns = left === 1 ? "1 turn remains" : `${left} turns remain`;
  return `${turns} of ${max}. ${beforeTheEnd}`;
}

/** The same, when a fifth of the wall budget remains for turns; a slow model meets it first. */
export function timeLeftNotice(leftMs: number, wallMs: number): string | null {
  if (!Number.isFinite(wallMs) || leftMs > wallMs / 5) return null;
  const minutes = Math.max(1, Math.round(leftMs / 60_000));
  const time = minutes === 1 ? "About 1 minute remains" : `About ${minutes} minutes remain`;
  return `${time} for turns, with final verification reserved after them. ${beforeTheEnd}`;
}

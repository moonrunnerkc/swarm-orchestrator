/** What the model writes, alone on a line, when it considers the task done. */
export const completionMarker = "SWARM_TASK_COMPLETE";

/** Bytes of command output (or verifier failure) a turn carries; the rest is cut from the middle. */
export const outputCap = 10_000;

export const systemPrompt = [
  "You are a software engineer working in a git repository. Your only tool is bash.",
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
  "2. One fenced requirements block: a JSON array that records what the task requires and which",
  "   tests show it. R1 is the task itself; keep its id. Add R2 and on for parts you separate.",
  '   Each entry: {"id": "R1", "text": "...", "kind": "fix" | "feature" | "refactor" | "upgrade" | "other",',
  '   "assumptions": ["..."], "evidence": {"tests": [{"name": "test name"}], "checks": ["check name"],',
  '   "structure": [{"path": "file", "contains": "text"}], "packages": [{"name": "pkg", "ecosystem": "npm", "version": "x.y.z"}]}}.',
  '   A test is named by its title, its suite, or a path such as "suite > title". A check is one',
  "   the project declares (package scripts such as test, lint, build); a command you ran is not.",
  "   Send it early and again whenever the mapping changes.",
  "",
  "```requirements",
  '[{"id": "R1", "text": "...", "kind": "feature", "evidence": {"tests": [{"name": "..."}]}}]',
  "```",
  "",
  `3. ${completionMarker} on a line of its own, when the task is done.`,
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
  "Change source, tests, manifests and lockfiles as the task needs. The base commit's own tests",
  "still judge your change: rewriting a test's expectation does not make a failing original pass.",
].join("\n");

/** The top of every turn: the task, the tree's status and the latest findings, all verbatim. */
export function turnHeader(task: string, status: string, findings: string | null): string {
  return [
    "Task:",
    task,
    "",
    "git status --short:",
    status.trim().length === 0 ? "(clean)" : status.trimEnd(),
    ...(findings === null ? [] : ["", "Latest verifier findings:", truncate(findings)]),
    "",
  ].join("\n");
}

export type ParsedReply =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "requirements"; readonly json: string; readonly complete: boolean }
  | { readonly kind: "complete" }
  | { readonly kind: "malformed"; readonly reason: string };

const fenced = /```([a-z]*)[ \t]*\n([\s\S]*?)\n?```/g;
const markerCommand = new RegExp(`^(?:echo\\s+)?(["']?)${completionMarker}\\1$`);
const shells = new Set(["", "bash", "sh", "shell"]);

export function parseReply(content: string): ParsedReply {
  const blocks = [...content.matchAll(fenced)].map((match) => ({
    language: match[1] ?? "",
    body: (match[2] ?? "").trim(),
  }));
  const commands = blocks.filter((block) => shells.has(block.language));
  const records = blocks.filter((block) => block.language === "requirements");
  const marked = new RegExp(`^\\s*${completionMarker}\\s*$`, "m").test(content.replace(fenced, ""));
  if (commands.length + records.length > 1) {
    return { kind: "malformed", reason: "the reply has more than one fenced block" };
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
          reason: "the reply has no bash block, requirements block or completion marker",
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

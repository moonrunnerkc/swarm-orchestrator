/** What the model writes, alone on a line, when it considers the task done. */
export const completionMarker = "SWARM_TASK_COMPLETE";

/** Bytes of command output (or verifier failure) a turn carries; the rest is cut from the middle. */
export const outputCap = 10_000;

export const systemPrompt = [
  "You are a software engineer working in a git repository. Your only tool is bash.",
  "",
  "Every reply must contain exactly one fenced bash block holding one command:",
  "",
  "```bash",
  "your command here",
  "```",
  "",
  "The harness runs it from the repository root, non-interactively, and replies with its exit",
  "code and output. Use cat, grep, sed, heredocs and the project's own tools to read and edit.",
  "",
  `When the task is done, reply with ${completionMarker} on a line of its own and no bash block.`,
  "An independent verifier then reruns the project's checks on your working tree in a clean",
  "checkout. If it refuses the change, its output comes back to you and you continue.",
  "",
  "The verifier refuses a change that edits tests, CI configuration, lockfiles, package",
  "manifests or swarm.toml together with source files. Fix the source.",
].join("\n");

/** The top of every turn: the task, the tree's status and the last refusal, all verbatim. */
export function turnHeader(task: string, status: string, failure: string | null): string {
  return [
    "Task:",
    task,
    "",
    "git status --short:",
    status.trim().length === 0 ? "(clean)" : status.trimEnd(),
    ...(failure === null ? [] : ["", "Most recent verifier failure:", truncate(failure)]),
    "",
  ].join("\n");
}

export type ParsedReply =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "complete" }
  | { readonly kind: "malformed"; readonly reason: string };

const bashBlock = /```(?:bash|sh|shell)?[ \t]*\n([\s\S]*?)\n?```/g;

export function parseReply(content: string): ParsedReply {
  const blocks = [...content.matchAll(bashBlock)].map((match) => (match[1] ?? "").trim());
  if (blocks.length === 0) {
    return new RegExp(`^\\s*${completionMarker}\\s*$`, "m").test(content)
      ? { kind: "complete" }
      : { kind: "malformed", reason: "the reply has no bash block and no completion marker" };
  }
  if (blocks.length > 1)
    return { kind: "malformed", reason: "the reply has more than one bash block" };
  const command = blocks[0] ?? "";
  return command.length === 0
    ? { kind: "malformed", reason: "the bash block is empty" }
    : { kind: "command", command };
}

/** Keeps the start and the end, which is where a command's errors and summaries are. */
export function truncate(text: string, cap: number = outputCap): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= cap) return text;
  const half = Math.floor(cap / 2);
  const omitted = bytes.length - 2 * half;
  return `${bytes.subarray(0, half).toString()}\n[... ${omitted} bytes omitted ...]\n${bytes.subarray(bytes.length - half).toString()}`;
}

// Replay the allowed write and edit tool calls a session ledger recorded over a git working tree,
// exactly as the product's edit tool applies them (one occurrence, or every one under replaceAll),
// and read the tree's change as the product records it: a zero-context diff against the base,
// whose digest the ledger's independent-verification and workspace-diff records carry. Blob
// abbreviations are pinned to seven characters, the length a shallow clone's index lines had.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const repository = "sinonjs/sinon";
export const base = "8c663edeccc5e2fa5ddaaf4cab979726cf78304a";
export const upstream = "002ee82bc5329fd88e7083aeedb7520c0260d1ab";

export const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

export function readLedger(session) {
  const records = readFileSync(join(session, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const payload = (record) => {
    const path = join(session, "blobs", `${record.payloadDigest.slice(7)}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  };
  return { records, payload };
}

export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "core.abbrev=7", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A bare mirror of the repository, cloned from GitHub where the machine has none, holding both commits. */
export function ensureMirror(mirror = join(homedir(), ".cache/swarm-comparison/mirrors", `${repository.replace("/", "__")}.git`)) {
  if (!existsSync(mirror)) {
    mkdirSync(dirname(mirror), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--mirror", `https://github.com/${repository}.git`, mirror]);
  }
  for (const commit of [base, upstream])
    try {
      execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: mirror });
    } catch {
      execFileSync("git", ["fetch", "--quiet", `https://github.com/${repository}.git`, commit], { cwd: mirror });
    }
  return mirror;
}

/** A working tree at the base, cloned from the mirror. */
export function cloneBase(mirror, directory) {
  execFileSync("git", ["clone", "--quiet", "--no-checkout", `file://${mirror}`, directory]);
  git(directory, "checkout", "--quiet", "--detach", base);
  return directory;
}

/** One recorded call applied to the tree, by the edit tool's own rule. */
export function applyCall(tree, payload, sequence) {
  const path = join(tree, payload.input.path);
  if (payload.toolName === "write") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, payload.input.content);
    return `${sequence}: write ${payload.input.path} (${payload.input.content.length} chars)`;
  }
  const before = readFileSync(path, "utf8");
  const occurrences = before.split(payload.input.find).length - 1;
  if (occurrences === 0)
    throw new Error(`${sequence}: edit of ${payload.input.path} found no occurrence`);
  if (occurrences > 1 && payload.input.replaceAll !== true)
    throw new Error(`${sequence}: edit of ${payload.input.path} matched ${occurrences} times`);
  const after =
    payload.input.replaceAll === true
      ? before.split(payload.input.find).join(payload.input.replace)
      : before.replace(payload.input.find, () => payload.input.replace);
  writeFileSync(path, after);
  return `${sequence}: edit ${payload.input.path} (${occurrences} occurrence)`;
}

/** Every allowed write or edit in [from, to), in ledger order, applied to the tree. */
export function replayRange(tree, ledger, from, to) {
  const applied = [];
  for (const record of ledger.records) {
    if (record.sequence < from || record.sequence >= to || record.type !== "tool-call") continue;
    const payload = ledger.payload(record);
    if (payload === undefined || payload.decision !== "allowed") continue;
    if (payload.toolName !== "write" && payload.toolName !== "edit") continue;
    applied.push(applyCall(tree, payload, record.sequence));
  }
  return applied;
}

/** The tree's change against a commit, as the product's workspace-diff record spells it, and as a patch another checkout can apply. */
export function changeAgainst(tree, commit) {
  git(tree, "add", "-A");
  try {
    const diff = git(tree, "diff", "--no-color", "--no-ext-diff", "--unified=0", "--cached", commit, "--");
    const patch = git(tree, "diff", "--no-color", "--no-ext-diff", "--binary", "--full-index", "--cached", commit, "--");
    return { diff, digest: digestOf(diff), patch };
  } finally {
    git(tree, "reset", "--quiet");
  }
}

/** The tree put back to its checked-out commit, with nothing untracked left behind but installed dependencies. */
export function resetTree(tree) {
  git(tree, "checkout", "--quiet", "--", ".");
  git(tree, "clean", "--quiet", "-fdx", "--exclude=node_modules");
}

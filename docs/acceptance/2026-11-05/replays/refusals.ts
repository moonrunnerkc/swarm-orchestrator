// Rebuilds each edited file of a recorded session from its base and the session's accepted edits,
// and diagnoses every refused edit against the file as it then stood.
// Usage: node refusals.ts <session-id> <clone-at-base>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { applyReplacements, readEditBlock } from "/Users/brad/projects/recovery-2026-10-31/swarm-orchestrator/src/tools/file-edit.ts";

const [sid, clone] = process.argv.slice(2);
const dir = join(homedir(), ".swarm", "sessions", sid ?? "");
const recs = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const payload = (r: { payloadDigest: string }) => JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.split(":")[1]}.json`), "utf8"));
const files = new Map<string, string>();
const read = (path: string) => files.get(path) ?? (() => { try { return readFileSync(join(clone ?? "", path), "utf8"); } catch { return null; } })();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const norm = (text: string) => text.split("\n").map((line) => line.trimEnd()).join("\n");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
for (const r of recs) {
  if (r.type !== "tool-call") continue;
  const p = payload(r);
  if (p.tool !== "edit" && p.tool !== "write") continue;
  if (p.decision === "requested") continue;
  const text = String(p.command ?? "");
  const [head, ...body] = text.split("\n");
  if (p.tool === "write") { if (p.decision === "allowed") files.set(p.path, body.join("\n")); continue; }
  const edit = readEditBlock((head ?? "").replace(/^edit /, ""), body.join("\n"));
  if ("malformed" in edit) { console.log("malformed", p.path, edit.malformed); continue; }
  const now = read(p.path);
  if (p.decision === "allowed") {
    if (now !== null && p.beforeSha256 !== undefined && sha(now) !== p.beforeSha256) console.log(`  (reconstruction of ${p.path} differs from the recorded before; a shell command changed it)`);
    if (now !== null) { const next = applyReplacements(now, edit.pairs); if ("text" in next) files.set(p.path, next.text); }
    continue;
  }
  if (now === null) { console.log("refused, no file:", p.path); continue; }
  for (const [at, pair] of edit.pairs.entries()) {
    const exact = now.split(pair.search).length - 1;
    if (exact === 1) continue;
    const trailing = norm(now).split(norm(pair.search)).length - 1;
    const spacing = squash(now).includes(squash(pair.search));
    const lines = pair.search.split("\n");
    const missing = lines.filter((line) => line.trim() !== "" && !now.includes(line.trim()));
    console.log(`REFUSED ${p.path} part ${at + 1}: exact ${exact}, trailing-space-insensitive ${trailing}, whitespace-insensitive ${spacing ? "found" : "absent"}; ${missing.length} of ${lines.length} lines nowhere in the file${missing.length > 0 ? `: ${JSON.stringify(missing.slice(0, 3))}` : ""}`);
  }
}

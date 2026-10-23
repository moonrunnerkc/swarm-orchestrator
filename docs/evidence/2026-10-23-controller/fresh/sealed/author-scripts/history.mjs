// Lists one repository's family pool: first-parent history of the default branch from a
// recorded head, newest first, filtered by whole-word subject keywords of the block-2 rule.
// Read-only over the comparison mirror.
//   node history.mjs <owner/name> <head> <family 1|2|3> <out.json> [limit]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const familyPatterns = {
  1: /\b(feat|feats|feature|features|add|adds|added|adding|support\w*|option\w*|compat\w*)\b/i,
  2: /\b(rename|renames|renamed|renaming|move|moves|moved|moving|refactor\w*|migrat\w*)\b/i,
  3: /\b(fix|fixes|fixed|fixing|fixup)\b/i,
};
const [repository, head, family, out, limit = "40"] = process.argv.slice(2);
const mirror = join(homedir(), ".cache/swarm-comparison/mirrors", `${repository.replace("/", "__")}.git`);
const git = (...args) => execFileSync("git", ["--git-dir", mirror, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const rows = [];
for (const line of git("log", "--first-parent", "--format=%ct%x09%H%x09%P%x09%s", head).trim().split("\n")) {
  const [time, sha, parents, ...subject] = line.split("\t");
  const text = subject.join("\t");
  if (!familyPatterns[family].test(text)) continue;
  const stat = git("diff", "--numstat", "-M", parents.split(" ")[0], sha).trim().split("\n").filter(Boolean)
    .map((row) => { const [add, del, ...p] = row.split("\t"); return `${p.join("\t")} +${add}-${del}`; });
  rows.push({ family: Number(family), repository, date: new Date(Number(time) * 1000).toISOString(), changeCommit: sha, baseCommit: parents.split(" ")[0], parents: parents.split(" ").length, subject: text, files: stat });
  if (rows.length >= Number(limit)) break;
}
writeFileSync(out, `${JSON.stringify({ repository, head, family: Number(family), candidates: rows }, null, 1)}\n`);
for (const row of rows) console.log(`${row.changeCommit.slice(0, 9)} ${row.date.slice(0, 10)} [${row.files.length}f] ${row.subject}`);

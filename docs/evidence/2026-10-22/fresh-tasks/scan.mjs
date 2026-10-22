#!/usr/bin/env node
/**
 * Applies criteria 1 to 4 of selection-rule.md to each repository's mirror, newest commit first,
 * and writes every commit that meets them, in order, to the output. Reads commit metadata and
 * per-file line counts only; no diff body is printed.
 *
 *   node scan.mjs --mirrors <dir> --out <scan.json>
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { mirrors: { type: "string" }, out: { type: "string" } } });
const repositories = ["acornjs/acorn", "fb55/entities", "fb55/htmlparser2", "jsdom/whatwg-url"];
const since = "2024-01-01";
const git = (mirror, args) =>
  execFileSync("git", ["--git-dir", mirror, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

const testFile = (path) =>
  /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
const sourceFile = (path) => /\.[cm]?[jt]s$/.test(path) && !testFile(path);
const markdown = (path) => /\.md$/i.test(path);

const report = { rule: "selection-rule.md criteria 1-4", since, repositories: [] };
for (const repository of repositories) {
  const mirror = join(values.mirrors, `${repository.replace("/", "__")}.git`);
  const head = git(mirror, ["symbolic-ref", "HEAD"]).trim();
  const log = git(mirror, ["log", "--first-parent", `--since=${since}`, "--format=%H%x09%P%x09%cI%x09%s", head])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  const eligible = [];
  let examined = 0;
  for (const line of log) {
    const [sha, parents, date, subject] = line.split("\t");
    examined += 1;
    if (parents.split(" ").length !== 1) continue;
    if (!/^fix\b/i.test(subject)) continue;
    const numstat = git(mirror, ["show", "--numstat", "--format=", sha])
      .trim()
      .split("\n")
      .filter((one) => one.length > 0)
      .map((one) => {
        const [added, deleted, path] = one.split("\t");
        return { path, changed: (Number(added) || 0) + (Number(deleted) || 0) };
      });
    const tests = numstat.filter((file) => testFile(file.path));
    const sources = numstat.filter((file) => sourceFile(file.path));
    const others = numstat.filter((file) => !testFile(file.path) && !sourceFile(file.path) && !markdown(file.path));
    const sourceLines = sources.reduce((sum, file) => sum + file.changed, 0);
    if (tests.length === 0 || sources.length < 1 || sources.length > 3) continue;
    if (sourceLines < 4 || sourceLines > 80 || others.length > 0) continue;
    const base = parents;
    let lockfile = true;
    try {
      git(mirror, ["cat-file", "-e", `${base}:package-lock.json`]);
    } catch {
      lockfile = false;
    }
    if (!lockfile) continue;
    eligible.push({
      sha,
      base,
      date,
      subject,
      sources: sources.map((file) => file.path),
      tests: tests.map((file) => file.path),
      sourceLines,
    });
  }
  report.repositories.push({ repository, branch: head, examined, eligible });
}
writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
for (const entry of report.repositories)
  console.log(`${entry.repository}: ${entry.examined} examined, ${entry.eligible.length} meet 1-4`);

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const destination = resolve(process.argv[2]);
mkdirSync(destination, {recursive: true});
const repositories = ["pallets/click", "python-attrs/attrs", "pytest-dev/pluggy", "sindresorhus/p-limit", "fastify/fastify", "sindresorhus/p-queue"];
const families = [
  ["compatibility", /upgrade|bump|compatib|dependenc|drop support/i],
  ["refactor", /refactor|simplify|extract|rework|deduplicat/i],
  ["feature", /\badd\b|support|implement|introduce/i],
  ["bugfix", /\bfix\b|correct|regression|handle/i],
];
const exposed = new Set(["a1d87858abd77fa8e3ffc204670ccd75b96c4781", "5aa76a4450c311d87eda43946ec0ecd743572649", "97f8d175656bc03c373a1c9038048a4d312c307c"]);
const candidates = [], unfilled = [];
for (const repository of repositories) {
  const mirror = join(destination, `${repository.replace("/", "__")}.git`);
  if (!existsSync(mirror)) execFileSync("git", ["clone", "--quiet", "--bare", "--filter=blob:none", "--single-branch", `https://github.com/${repository}.git`, mirror]);
  const git = (...args) => execFileSync("git", ["--git-dir", mirror, ...args], {encoding: "utf8", maxBuffer: 32 * 1024 * 1024}).trim();
  const head = git("rev-parse", "HEAD");
  const commits = git("log", "--no-merges", "--before=2026-09-01T00:00:00Z", "--format=%H%x09%P%x09%s", "-1500").split("\n").map(line => {
    const [sha, parent, ...subject] = line.split("\t"); return {sha, parent, subject: subject.join("\t")};
  });
  const chosen = new Set();
  for (const [family, pattern] of families) {
    if (repository === "sindresorhus/p-queue" && family !== "refactor") continue;
    let found;
    for (const commit of commits) {
      if (exposed.has(commit.sha) || /^(docs?:|bumped? v)|dev dependencies|lockfile/i.test(commit.subject) || chosen.has(commit.sha) || !pattern.test(commit.subject) || commit.parent.includes(" ") || !commit.parent) continue;
      const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", commit.sha).split("\n");
      const code = files.filter(path => !/^(docs?|\.github)\//.test(path) && !/\.(md|rst|txt)$/.test(path));
      if (code.length < 2 || !code.some(path => /\.(py|[cm]?js|ts)$/.test(path) || /(^|\/)(package\.json|pyproject\.toml)$/.test(path))) continue;
      if (!code.some(path => /\.(py|[cm]?js|ts)$/.test(path) && !/(^|\/)(tests?|scripts|docs?|examples?|benchmarks?)(\/|\.)|config|conftest|setup\.py/.test(path))) continue;
      found = {id: `${repository.replace("/", "-")}-${family}`, repository, family, repositoryHead: head,
        baseCommit: commit.parent, changeCommit: commit.sha, subject: commit.subject, files,
        status: "candidate only: exposure, task wording and evaluator validation pending"};
      chosen.add(commit.sha); break;
    }
    if (found) candidates.push(found); else unfilled.push({repository, family});
  }
}
writeFileSync(join(destination, "candidates.json"), JSON.stringify({selectedAt: new Date().toISOString(), cutoff: "2026-09-01", candidates, unfilled}, null, 2));
console.log(JSON.stringify({candidates: candidates.length, unfilled}));

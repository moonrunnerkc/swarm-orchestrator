/**
 * Resolves every path a tracked markdown file names and reports the ones that miss.
 *
 * Paths resolve against what git tracks, not the disk, so a pointer that only works on the
 * machine that wrote it still fails. A markdown link is relative to its file; a backticked
 * mention is repo-root-relative (or file-relative) and only counts when it starts with a
 * directory this repository has and ends like a path. A path git ignores names generated
 * output and is reported, not failed.
 *
 * A released changelog section (`## 1.2.3 - 2026-01-01`) describes the tree of that release,
 * so its paths resolve against the release tag's tree as well as today's.
 *
 *   node scripts/check-doc-paths.mjs [repository root]
 */
import { execFile, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const runGit = promisify(execFile);
const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
const backtickPattern = /`([^`\n]+)`/g;
const releasedHeading = /^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}/;
const rootedPrefixes = ["src/", "docs/", "scripts/", ".github/", "dist/", "packages/", "eval/"];
const pathSuffixes = [".ts", ".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".toml", ".sh"];
/** Changelogs and the tag prefix their releases carry. */
const changelogTags = new Map([
  ["CHANGELOG.md", "v"],
  ["packages/swarm-verify/CHANGELOG.md", "swarm-verify-v"],
]);

function looksLikeAPath(raw) {
  if (/[\s*?<>{}$|]/.test(raw) || raw.includes("://")) return false;
  if (!rootedPrefixes.some((prefix) => raw.startsWith(prefix))) return false;
  return raw.endsWith("/") || pathSuffixes.some((suffix) => raw.endsWith(suffix));
}

/** Every path in a tree, plus every directory on the way to one. */
async function pathsAt(root, ref) {
  const args = ref === null ? ["ls-files", "-z"] : ["ls-tree", "-r", "-z", "--name-only", ref];
  const { stdout } = await runGit("git", args, { cwd: root, maxBuffer: 64_000_000 });
  const paths = new Set();
  for (const path of stdout.split("\0").filter((entry) => entry.length > 0)) {
    paths.add(path);
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      paths.add(`${parts.slice(0, depth).join("/")}/`);
    }
  }
  return paths;
}

function ignoredAmong(root, candidates) {
  if (candidates.length === 0) return new Set();
  const ran = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    input: `${candidates.join("\0")}\0`,
    encoding: "utf8",
  });
  return new Set((ran.stdout ?? "").split("\0").filter((path) => path.length > 0));
}

/** The file split into sections, each with the tag whose tree it describes (null for now). */
function sectionsOf(path, text) {
  const prefix = changelogTags.get(path);
  if (prefix === undefined) return [{ ref: null, text }];
  const sections = [{ ref: null, lines: [] }];
  for (const line of text.split("\n")) {
    const released = releasedHeading.exec(line);
    if (released !== null) sections.push({ ref: `${prefix}${released[1]}`, lines: [] });
    else if (line.startsWith("## ")) sections.push({ ref: null, lines: [] });
    sections.at(-1).lines.push(line);
  }
  return sections.map((section) => ({ ref: section.ref, text: section.lines.join("\n") }));
}

function repoRelative(root, target, wantsDirectory) {
  const path = relative(root, target).split(sep).join("/");
  return wantsDirectory && !path.endsWith("/") ? `${path}/` : path;
}

export async function checkDocumentationPaths(root) {
  const trees = new Map([[null, await pathsAt(root, null)]]);
  const treeAt = async (ref) => {
    if (!trees.has(ref)) trees.set(ref, await pathsAt(root, ref).catch(() => null));
    return trees.get(ref);
  };
  const files = [...trees.get(null)].filter(
    (path) => path.endsWith(".md") && !path.startsWith("src/fixtures/"),
  );
  const unresolved = [];
  let checked = 0;

  for (const path of files.sort()) {
    const file = join(root, path);
    const here = dirname(file);
    for (const section of sectionsOf(path, await readFile(file, "utf8"))) {
      const now = trees.get(null);
      const then = section.ref === null ? now : ((await treeAt(section.ref)) ?? now);
      const record = (raw, kind, candidates) => {
        checked += 1;
        if (!candidates.some((candidate) => now.has(candidate) || then.has(candidate))) {
          unresolved.push({ file, raw, kind });
        }
      };
      for (const match of section.text.matchAll(linkPattern)) {
        const raw = (match[1] ?? "").split("#")[0] ?? "";
        if (raw.length === 0 || /^(https?|mailto):/.test(raw)) continue;
        const target = isAbsolute(raw) ? raw : resolve(here, raw);
        record(raw, "link", [
          repoRelative(root, target, raw.endsWith("/")),
          repoRelative(root, target, true),
        ]);
      }
      for (const match of section.text.matchAll(backtickPattern)) {
        const raw = (match[1] ?? "").trim();
        if (!looksLikeAPath(raw)) continue;
        record(raw, "mention", [raw, repoRelative(root, resolve(here, raw), raw.endsWith("/"))]);
      }
    }
  }

  const inside = (raw) => resolve(root, raw).startsWith(`${root}${sep}`);
  const ignored = ignoredAmong(root, unresolved.map((entry) => entry.raw).filter(inside));
  const generated = unresolved.filter((entry) => ignored.has(entry.raw));
  const misses = unresolved.filter((entry) => !ignored.has(entry.raw));
  return { fileCount: files.length, checked, misses, generated };
}

if (import.meta.filename === process.argv[1]) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, ".."));
  const { fileCount, checked, misses, generated } = await checkDocumentationPaths(root);
  process.stdout.write(`resolved ${checked} path reference(s) across ${fileCount} file(s)\n`);
  for (const entry of generated) {
    process.stdout.write(`  generated: ${entry.file}: ${entry.raw} (git ignores it)\n`);
  }
  process.stdout.write(`${misses.length} miss(es)\n`);
  for (const miss of misses) {
    process.stdout.write(`  ${miss.file}: ${miss.raw} (${miss.kind})\n`);
  }
  if (misses.length > 0) process.exitCode = 1;
}

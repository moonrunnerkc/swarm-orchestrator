/**
 * Resolves every path a documentation file names, and reports the ones that miss.
 *
 * This is the defect class the 08-18 run found in `redteam/pass5`: a document pointing at a
 * file that is not there. A reader following the pointer discovers it; nothing else does.
 *
 * Resolved against what git tracks, not against the filesystem. A pointer that resolves only
 * on the machine that wrote it is the same broken pointer to everyone who clones the
 * repository, and checking the working tree hides exactly that: an earlier spelling of this
 * script passed here and failed in CI, on three paths that exist on this disk and in no commit.
 *
 * Three outcomes rather than two, because a path git deliberately ignores is a third thing:
 *
 *   - **tracked**: the pointer resolves for anyone.
 *   - **generated**: git ignores it, so it names build or run output that exists once
 *     something makes it (`dist/`, a driver's state directory). Naming one is not a broken
 *     pointer, and it is counted and reported rather than passed over in silence.
 *   - **missing**: neither of those. That is the defect.
 *
 * Two kinds of reference, because the documents use two:
 *
 *   - A markdown link, `[text](path)`, is relative to the file that holds it. That is what
 *     markdown means by a relative link and what a reader's viewer will do with it.
 *   - A path named in backticks inside prose is written repo-root-relative in these files
 *     (`src/tools/chokepoint.ts` means the one at the root, read from any document), and is
 *     accepted against either the root or the file's own directory.
 *
 * A backtick mention is only read as a pointer where it claims to be one: it has to start with
 * a directory this repository actually has. Prose says `verify.mjs` meaning the thing rather
 * than a location, `verifier/verify.mjs` as a fragment of a longer path, `~/.swarm/` for
 * somewhere else, and `coverage/` quoting a line of .gitignore. Resolving any of those would
 * invent a pointer nobody wrote and bury the real misses under them.
 *
 *   node scripts/check-doc-paths.mjs [repository root]
 */
import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const runGit = promisify(execFile);

/** `[text](target)`, with any anchor left for the caller to strip. */
const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Anything in backticks, which is then filtered down to what looks like a path. */
const backtickPattern = /`([^`\n]+)`/g;

/** The directories a rooted reference can start with. A mention outside these is not a claim. */
const rootedPrefixes = ["src/", "docs/", "fuzz/", "scripts/", "redteam/", ".github/", "dist/"];

const pathSuffixes = [
  ".md",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonl",
  ".html",
  ".txt",
  ".toml",
  ".yml",
  ".yaml",
  ".cast",
  ".lock",
];

/**
 * Paths a document names in order to say they are gone. A record of a removal is not a
 * dangling pointer, and the two are indistinguishable without reading the sentence, which is
 * the judge this project does not build. Named here, with the reason, rather than by widening
 * the rules above until they stop showing up.
 */
const documentedAsRemoved = new Map([
  ["redteam/leep/", "removed by the 08-18 run, which the documents naming it record"],
]);

/**
 * Prose mentions a lot of things in backticks that are not paths: identifiers, flags, commands,
 * JSON fragments, shell lines. A reference has to look like a path and only like a path.
 */
function looksLikeAPath(raw) {
  if (raw.length === 0 || raw.startsWith("http") || raw.startsWith("#")) {
    return false;
  }
  // A space, a quote, or a shell operator makes it a command or a sentence, not a path.
  if (/[\s()<>*|$"'{}[\],;=]/.test(raw)) {
    return false;
  }
  // A colon spells a revision and a path, `schema-v1:src/contract/schema/v1.json`, which names
  // a file at a commit rather than one in this tree.
  if (raw.includes(":")) {
    return false;
  }
  if (!rootedPrefixes.some((prefix) => raw.startsWith(prefix))) {
    return false;
  }
  return raw.endsWith("/") || pathSuffixes.some((suffix) => raw.endsWith(suffix));
}

/** Every path in the index, plus every directory on the way to one. */
async function trackedPaths(root) {
  const { stdout } = await runGit("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64_000_000 });
  const tracked = new Set();
  for (const path of stdout.split("\0")) {
    if (path.length === 0) {
      continue;
    }
    tracked.add(path);
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      tracked.add(`${parts.slice(0, depth).join("/")}/`);
    }
  }
  return tracked;
}

/**
 * What git is told to ignore, asked in one batch rather than once per path. Spawned rather
 * than run through execFile, which takes no stdin: handed one it waits on a pipe nobody
 * writes to, which is a hang rather than an error.
 */
function ignoredAmong(root, candidates) {
  if (candidates.length === 0) {
    return Promise.resolve(new Set());
  }

  return new Promise((settle) => {
    const child = spawn("git", ["check-ignore", "--stdin", "-z"], { cwd: root });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    // Exit 1 means nothing matched, which is an answer; an error means git could not be asked,
    // and then nothing is called generated rather than everything being.
    child.on("close", () => {
      settle(new Set(stdout.split("\0").filter((path) => path.length > 0)));
    });
    child.on("error", () => {
      settle(new Set());
    });
    child.stdin.end(`${candidates.join("\0")}\0`);
  });
}

/** Every markdown file under docs/, plus the ones at the root that carry the same pointers. */
async function documentationFiles(root, tracked) {
  const files = [];
  for (const entry of await readdir(join(root, "docs"), {
    withFileTypes: true,
    recursive: true,
  })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(join(entry.parentPath, entry.name));
    }
  }
  for (const name of ["README.md", "CHANGELOG.md", "CLAUDE.md", "AGENTS.md", "fuzz/README.md"]) {
    if (tracked.has(name)) {
      files.push(join(root, name));
    }
  }
  return files.sort();
}

/** Repo-relative, with a trailing slash kept, which is how the tracked set spells a directory. */
function repoRelative(root, target, wantsDirectory) {
  const path = relative(root, target).split(sep).join("/");
  return wantsDirectory && !path.endsWith("/") ? `${path}/` : path;
}

export async function checkDocumentationPaths(root) {
  const tracked = await trackedPaths(root);
  const files = await documentationFiles(root, tracked);
  const misses = [];
  const known = [];
  const generated = [];
  const unresolved = [];
  let checked = 0;

  const record = (file, raw, kind, candidates) => {
    checked += 1;
    if (candidates.some((candidate) => tracked.has(candidate))) {
      return;
    }
    const reason = documentedAsRemoved.get(raw);
    if (reason !== undefined) {
      known.push({ file, raw, reason });
      return;
    }
    unresolved.push({ file, raw, kind });
  };

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const here = dirname(file);

    for (const match of text.matchAll(linkPattern)) {
      const raw = (match[1] ?? "").split("#")[0] ?? "";
      if (raw.length === 0 || raw.startsWith("http") || raw.startsWith("mailto:")) {
        continue;
      }
      const target = isAbsolute(raw) ? raw : resolve(here, raw);
      record(file, raw, "link", [
        repoRelative(root, target, raw.endsWith("/")),
        repoRelative(root, target, true),
      ]);
    }

    for (const match of text.matchAll(backtickPattern)) {
      const raw = (match[1] ?? "").trim();
      if (!looksLikeAPath(raw) || isAbsolute(raw)) {
        continue;
      }
      record(file, raw, "mention", [
        raw,
        repoRelative(root, resolve(root, raw), raw.endsWith("/")),
        repoRelative(root, resolve(here, raw), raw.endsWith("/")),
      ]);
    }
  }

  // Asked once, at the end: a path git ignores names something generated rather than a pointer
  // that broke, and asking per path would spawn git several hundred times.
  const ignored = await ignoredAmong(
    root,
    unresolved.map((entry) => entry.raw.replace(/\/$/, "")),
  );
  for (const entry of unresolved) {
    if (ignored.has(entry.raw.replace(/\/$/, ""))) {
      generated.push(entry);
    } else {
      misses.push(entry);
    }
  }

  return { fileCount: files.length, checked, misses, known, generated };
}

if (import.meta.filename === process.argv[1]) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, ".."));
  const { fileCount, checked, misses, known, generated } = await checkDocumentationPaths(root);

  process.stdout.write(
    `resolved ${checked} path reference(s) across ${fileCount} documentation file(s), ` +
      "against what git tracks\n",
  );
  for (const entry of generated) {
    process.stdout.write(`  generated: ${entry.file}: ${entry.raw} (git ignores it)\n`);
  }
  for (const entry of known) {
    process.stdout.write(`  known: ${entry.file}: ${entry.raw} (${entry.reason})\n`);
  }
  if (misses.length === 0) {
    process.stdout.write(
      `zero misses, ${known.length} known and named, ${generated.length} generated\n`,
    );
  } else {
    process.stdout.write(`${misses.length} miss(es):\n`);
    for (const miss of misses) {
      process.stdout.write(`  ${miss.file}: ${miss.raw} (${miss.kind})\n`);
    }
    process.exitCode = 1;
  }
}

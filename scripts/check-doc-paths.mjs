/**
 * Resolves every path a documentation file names, and reports the ones that miss.
 *
 * This is the defect class the 08-18 run found in `redteam/pass5`: a document pointing at a
 * file that is not there. A reader following the pointer discovers it; nothing else does.
 *
 * Two kinds of reference, resolved two ways, because the documents use them two ways:
 *
 *   - A markdown link, `[text](path)`, is relative to the file that holds it. That is what
 *     markdown means by a relative link and what a reader's viewer will do with it.
 *   - A path named in backticks inside prose is written repo-root-relative in these files
 *     (`src/tools/chokepoint.ts` means the one at the root, read from any document). It is
 *     accepted if it resolves against either the root or the file's own directory, since
 *     both spellings appear and both are unambiguous to a reader.
 *
 * A backticked mention is only read as a pointer where it claims to be one: it has to start
 * with a directory this repository actually has. Prose says `verify.mjs` meaning the thing
 * rather than a location, `verifier/verify.mjs` as a fragment of a longer path, `~/.swarm/`
 * for somewhere else entirely, and `coverage/` quoting a line of .gitignore. Resolving any of
 * those would invent a pointer nobody wrote and bury the real misses under them. A markdown
 * link is always resolved, since a link is a location by definition.
 *
 *   node scripts/check-doc-paths.mjs [repository root]
 */
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** `[text](target)`, with any anchor left for the caller to strip. */
const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Anything in backticks, which is then filtered down to what looks like a path. */
const backtickPattern = /`([^`\n]+)`/g;

/** The directories a rooted reference can start with. A mention outside these is not a claim. */
const rootedPrefixes = ["src/", "docs/", "fuzz/", "scripts/", "redteam/", ".github/", "dist/"];

/**
 * Paths a document names in order to say they are gone. A record of a removal is not a
 * dangling pointer, and the two are indistinguishable without reading the sentence, which is
 * the judge this project does not build. Named here, with the reason, rather than by widening
 * the rule above until they stop showing up.
 */
const documentedAsRemoved = new Map([
  ["redteam/leep/", "removed by the 08-18 run, which both documents record"],
]);

const pathSuffixes = [
  ".md",
  ".ts",
  ".mjs",
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
  if (raw.endsWith("/")) {
    return true;
  }
  return pathSuffixes.some((suffix) => raw.endsWith(suffix));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Every markdown file under docs/, plus the ones at the root that carry the same pointers. */
async function documentationFiles(root) {
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
    const candidate = join(root, name);
    if (await exists(candidate)) {
      files.push(candidate);
    }
  }
  return files.sort();
}

export async function checkDocumentationPaths(root) {
  const files = await documentationFiles(root);
  const misses = [];
  const known = [];
  let checked = 0;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const here = dirname(file);

    for (const match of text.matchAll(linkPattern)) {
      const raw = (match[1] ?? "").split("#")[0] ?? "";
      if (raw.length === 0 || raw.startsWith("http") || raw.startsWith("mailto:")) {
        continue;
      }
      checked += 1;
      const target = isAbsolute(raw) ? raw : resolve(here, raw);
      if (!(await exists(target))) {
        misses.push({ file, raw, kind: "link" });
      }
    }

    for (const match of text.matchAll(backtickPattern)) {
      const raw = (match[1] ?? "").trim();
      if (!looksLikeAPath(raw) || isAbsolute(raw)) {
        continue;
      }
      checked += 1;
      if (!(await exists(resolve(root, raw))) && !(await exists(resolve(here, raw)))) {
        const reason = documentedAsRemoved.get(raw);
        if (reason === undefined) {
          misses.push({ file, raw, kind: "mention" });
        } else {
          known.push({ file, raw, reason });
        }
      }
    }
  }

  return { fileCount: files.length, checked, misses, known };
}

if (import.meta.filename === process.argv[1]) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, ".."));
  const { fileCount, checked, misses, known } = await checkDocumentationPaths(root);

  process.stdout.write(
    `resolved ${checked} path reference(s) across ${fileCount} documentation file(s)\n`,
  );
  for (const entry of known) {
    process.stdout.write(`  known: ${entry.file}: ${entry.raw} (${entry.reason})\n`);
  }
  if (misses.length === 0) {
    process.stdout.write(`zero misses, ${known.length} known and named\n`);
  } else {
    process.stdout.write(`${misses.length} miss(es):\n`);
    for (const miss of misses) {
      process.stdout.write(`  ${miss.file}: ${miss.raw} (${miss.kind})\n`);
    }
    process.exitCode = 1;
  }
}

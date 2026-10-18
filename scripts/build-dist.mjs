/**
 * Builds the published package into dist/.
 *
 * tsc alone is not enough. Five files under src/ are not TypeScript and are read at
 * runtime relative to import.meta.url: the bundled shortlist, the pricing table, the
 * calibration golden set, and the embedded verifier with its types. tsc does not copy
 * them, so a dist/ built by tsc alone has a CLI that throws ENOENT on its first
 * shortlist read. That is how this was found.
 *
 * The asset list is discovered rather than written down, so adding a JSON file under src/
 * cannot silently miss the package.
 *
 *   node scripts/build-dist.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { argv, exit, stdout } from "node:process";

const root = join(import.meta.dirname, "..");

/**
 * A directory whose contents a test reads and the runtime never does. It sits under src/
 * because a fixture belongs beside the test that asserts against it, and it stays out of the
 * package for the same reason the test file does.
 */
const fixtureDirectory = "fixtures";

/** Every file under `directory` that tsc will not emit and the runtime does read. */
export async function assetsUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name.endsWith(".ts")) {
      continue;
    }
    const path = relative(directory, join(entry.parentPath, entry.name));
    if (path.split(sep).includes(fixtureDirectory)) {
      continue;
    }
    found.push(path);
  }
  return found.sort();
}

/**
 * The compiler this build needs, or an error saying why it is not there.
 *
 * `npm install -g <git ref>` cannot work for this package and the raw failure does not say so.
 * npm inherits the global context into its git-dependency preparation, places the clone as a
 * root package rather than building a tree inside it, and runs `prepare` without ever
 * installing the clone's devDependencies. `tsc` is one of those, so the build spawns a path
 * that does not exist and the reader gets `ENOENT` on a file they never named. Installing the
 * same ref without `-g` builds normally, and the published package needs no build at all.
 */
export function compilerPath(root) {
  const compiler = join(root, "node_modules", ".bin", "tsc");
  if (existsSync(compiler)) return compiler;

  throw new Error(
    `no TypeScript compiler at ${compiler}. This package builds itself on install and needs ` +
      "its devDependencies to do it. npm does not install them when a git ref is installed " +
      "with -g, so that command cannot work here: install the published package with " +
      "`npm install -g swarm-orchestrator`, or install the git ref without -g",
  );
}

async function build() {
  const source = join(root, "src");
  const destination = join(root, "dist");

  const compiler = compilerPath(root);
  await rm(destination, { recursive: true, force: true });
  execFileSync(compiler, ["-p", "tsconfig.dist.json"], {
    cwd: root,
    stdio: "inherit",
  });

  const assets = await assetsUnder(source);
  for (const asset of assets) {
    const target = join(destination, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(source, asset), target);
  }
  // Which commit this build is, so `swarm --version` can tell a release from a build of source
  // ahead of it: both carry the manifest's version until a release names a new one.
  await writeFile(
    join(destination, "source.json"),
    `${JSON.stringify({ describe: sourceDescription(root) })}\n`,
  );
  stdout.write(`build: dist/ emitted, ${assets.length} asset(s) copied\n`);
}

/**
 * `git describe` against the release tags, or null outside a git checkout. `--always` names the
 * commit where no release tag is reachable: a shallow clone has none, and without it a build of
 * source there reported "14.4.0", the release's own version line. A release is built from a full
 * checkout at its tag (the publish workflow fetches every tag), which still describes as the tag.
 */
export function sourceDescription(directory) {
  try {
    return execFileSync(
      "git",
      ["describe", "--tags", "--match", "v[0-9]*", "--dirty", "--always"],
      {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return null;
  }
}

// Importable for its test without building, run for its effect from the command line.
if (argv[1] === import.meta.filename) {
  await build().catch((cause) => {
    process.stderr.write(`build failed: ${cause.message}\n`);
    exit(1);
  });
}

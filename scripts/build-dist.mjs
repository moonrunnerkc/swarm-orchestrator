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
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { argv, exit, stdout } from "node:process";

const root = join(import.meta.dirname, "..");

/** Every file under `directory` that tsc will not emit, as paths relative to it. */
export async function assetsUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name.endsWith(".ts")) {
      continue;
    }
    found.push(relative(directory, join(entry.parentPath, entry.name)));
  }
  return found.sort();
}

async function build() {
  const source = join(root, "src");
  const destination = join(root, "dist");

  await rm(destination, { recursive: true, force: true });
  execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.dist.json"], {
    cwd: root,
    stdio: "inherit",
  });

  const assets = await assetsUnder(source);
  for (const asset of assets) {
    const target = join(destination, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(source, asset), target);
  }
  stdout.write(`build: dist/ emitted, ${assets.length} asset(s) copied\n`);
}

// Importable for its test without building, run for its effect from the command line.
if (argv[1] === import.meta.filename) {
  await build().catch((cause) => {
    process.stderr.write(`build failed: ${cause.message}\n`);
    exit(1);
  });
}

/**
 * Builds the standalone verifier package into packages/swarm-verify/dist.
 *
 * The package has no source tree of its own. Its tsconfig names one entry, src/swarm-verify.ts,
 * and tsc emits exactly the modules that entry reaches, which is the same code the full CLI
 * runs for verify, ci and gates. Two things tsc does not do are done here: the non-TypeScript
 * files those modules read at runtime are copied beside them, and the emitted tree is refused if
 * it reaches the provider, worker or screen modules or the agent's run assembly, because a
 * boundary that is only tested is a boundary a build can cross quietly.
 *
 *   node scripts/build-swarm-verify.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { argv, exit, stdout } from "node:process";
import { assetsUnder, compilerPath } from "./build-dist.mjs";

const root = join(import.meta.dirname, "..");
const packageRoot = join(root, "packages", "swarm-verify");
const destination = join(packageRoot, "dist");

const forbidden = /^(providers|workers|tui)\/|^agent-run\.js$/;

/** Every emitted JavaScript file, relative to dist, so the closure is read off what tsc wrote. */
export async function emittedModules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      found.push(relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"));
    }
  }
  return found.sort();
}

/** The emitted modules that cross the boundary the package promises not to. */
export function crossings(modules) {
  return modules.filter((module) => forbidden.test(module));
}

/**
 * The assets the emitted modules read at runtime: those under a directory holding an emitted
 * module, subdirectories included, since the evidence module reads its verifier scripts out of a
 * directory of their own. An asset under no emitted directory is weight, not function.
 */
export function assetsBeside(modules, assets) {
  const emittedDirectories = new Set(modules.map((module) => dirname(module)));
  // The package root is every asset's ancestor, so it counts only for an asset that sits in it.
  const underEmitted = (asset) => {
    for (let directory = dirname(asset); directory !== "."; directory = dirname(directory)) {
      if (emittedDirectories.has(directory)) return true;
    }
    return dirname(asset) === "." && emittedDirectories.has(".");
  };
  return assets.filter(underEmitted);
}

async function build() {
  const compiler = compilerPath(root);
  await rm(destination, { recursive: true, force: true });
  execFileSync(compiler, ["-p", join(packageRoot, "tsconfig.json")], {
    cwd: root,
    stdio: "inherit",
  });

  const modules = await emittedModules(destination);
  const crossed = crossings(modules);
  if (crossed.length > 0) {
    throw new Error(
      `the standalone verifier reached modules it must not carry: ${crossed.join(", ")}`,
    );
  }

  const assets = assetsBeside(
    modules,
    (await assetsUnder(join(root, "src"))).map((asset) => asset.split(sep).join("/")),
  );
  for (const asset of assets) {
    const target = join(destination, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, "src", asset), target);
  }
  stdout.write(
    `build: packages/swarm-verify/dist emitted, ${modules.length} module(s), ${assets.length} asset(s) copied\n`,
  );
}

// Importable for its test without building, run for its effect from the command line.
if (argv[1] === import.meta.filename) {
  await build().catch((cause) => {
    process.stderr.write(`build failed: ${cause.message}\n`);
    exit(1);
  });
}

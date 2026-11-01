/**
 * Pins swarm-verify to an exact packed tarball: the tarball goes into the npm cache, and
 * package.json and package-lock.json name its registry version and integrity, so `npm ci`
 * installs those bytes and a published release must reproduce them to satisfy the lockfile.
 *
 *   node scripts/adopt-verifier.mjs <swarm-verify-x.y.z.tgz>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const npm = (...args) => execFileSync("npm", args, { cwd: root, stdio: "inherit" });

/** The registry URL npm records for a published version of swarm-verify. */
export function registryUrl(version) {
  return `https://registry.npmjs.org/swarm-verify/-/swarm-verify-${version}.tgz`;
}

/** The lockfile and manifest with swarm-verify pinned to `version` at `integrity`. */
export function pinned(lock, manifest, version, integrity) {
  const entry = lock.packages["node_modules/swarm-verify"];
  if (entry === undefined) throw new Error("the lockfile has no swarm-verify entry to pin");
  entry.version = version;
  entry.resolved = registryUrl(version);
  entry.integrity = integrity;
  lock.packages[""].dependencies["swarm-verify"] = version;
  manifest.dependencies["swarm-verify"] = version;
  return { lock, manifest };
}

if (import.meta.filename === process.argv[1]) {
  const tarball = resolve(process.argv[2] ?? "");
  const bytes = readFileSync(tarball);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const version = /swarm-verify-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/.exec(tarball)?.[1];
  if (version === undefined) throw new Error(`${tarball} is not a swarm-verify-<version>.tgz`);
  npm("cache", "add", tarball);
  npm("install", "--save-exact", "--no-audit", "--no-fund", tarball);
  const lockPath = join(root, "package-lock.json");
  const manifestPath = join(root, "package.json");
  const { lock, manifest } = pinned(
    JSON.parse(readFileSync(lockPath, "utf8")),
    JSON.parse(readFileSync(manifestPath, "utf8")),
    version,
    integrity,
  );
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  npm("ci", "--no-audit", "--no-fund");
  process.stdout.write(`swarm-verify ${version} pinned at ${integrity}\n`);
}

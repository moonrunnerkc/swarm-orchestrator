import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { InstrumentTrees } from "./instrument-identity.ts";

/**
 * Where a check's tool comes from, on each side: the lockfile entries for the tool and everything
 * it depends on, the package manager's other lockfiles read as text, and the tool as installed
 * where the check ran. The half of instrument-identity-v1 that is packages rather than files.
 */

export interface InstrumentDependency {
  readonly name: string;
  /** A digest of the lockfile entry or declaration on each side, null where absent. */
  readonly reference: string | null;
  readonly current: string | null;
  /** Where the current side comes from. Only `registry` may differ from the reference. */
  readonly currentSource: "registry" | "tree" | "other" | "absent";
}

export interface InstalledRunner {
  readonly name: string;
  /** The version the current lockfile pins, or null where it names none. */
  readonly expected: string | null;
  /** The version installed where the check ran, or null where nothing is installed. */
  readonly found: string | null;
  /** Whether the package manager's executable link resolves inside that package. */
  readonly linked: boolean;
}

/** The packages that are a tool, and the executable its package links, where it has one. */
export interface ToolPackages {
  /** Dependency names or prefixes (a trailing `*`) that are the tool itself. */
  readonly packages: readonly string[];
  readonly bin?: string;
}

export function digest(text: string | null): string | null {
  return text === null ? null : `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function canonical(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value, (_key, inner) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

export function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function matchesPackage(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

interface NpmLockEntry {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly link?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

function npmPackages(lock: Record<string, unknown> | null): Readonly<Record<string, NpmLockEntry>> {
  const packages = lock?.packages;
  return packages !== null && typeof packages === "object"
    ? (packages as Record<string, NpmLockEntry>)
    : {};
}

function entryName(path: string): string {
  const at = path.lastIndexOf("node_modules/");
  return at === -1 ? path : path.slice(at + "node_modules/".length);
}

/** The lockfile paths a set of package names reaches, dependencies included, in one lockfile. */
function npmClosure(
  packages: Readonly<Record<string, NpmLockEntry>>,
  roots: readonly string[],
): readonly string[] {
  const reached = new Set<string>();
  const pending = Object.keys(packages).filter(
    (path) =>
      path.startsWith("node_modules/") &&
      roots.includes(entryName(path)) &&
      !path.slice(13).includes("node_modules/"),
  );
  while (pending.length > 0 && reached.size < 5000) {
    const path = pending.shift() as string;
    if (reached.has(path)) continue;
    reached.add(path);
    const entry = packages[path];
    for (const name of Object.keys({
      ...entry?.dependencies,
      ...entry?.optionalDependencies,
      ...entry?.peerDependencies,
    })) {
      let scope = path;
      for (;;) {
        const candidate = `${scope}/node_modules/${name}`;
        if (packages[candidate] !== undefined) {
          pending.push(candidate);
          break;
        }
        const at = scope.lastIndexOf("/node_modules/");
        if (at === -1) {
          if (packages[`node_modules/${name}`] !== undefined) pending.push(`node_modules/${name}`);
          break;
        }
        scope = scope.slice(0, at);
      }
    }
  }
  return [...reached].sort();
}

function npmSource(
  path: string,
  entry: NpmLockEntry | undefined,
): InstrumentDependency["currentSource"] {
  if (entry === undefined) return "absent";
  if (entry.link === true) return "tree";
  const name = entryName(path);
  const file = name.split("/").at(-1) ?? name;
  const resolved = entry.resolved ?? "";
  const registry = /^https:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\//.exec(resolved)?.[0];
  if (
    registry !== undefined &&
    typeof entry.integrity === "string" &&
    resolved === `${registry}${name}/-/${file}-${entry.version ?? ""}.tgz`
  )
    return "registry";
  return "other";
}

/**
 * A lockfile line whose package comes from somewhere other than a registry: a tarball URL, a git
 * repository, a file. Workspace links are not here: a tool declared as one is caught where the
 * manifest declares it, and a monorepo's own packages link that way in every lockfile.
 */
const nonRegistryLockLine =
  /\b(?:tarball|repo|commit):|(?:^|["'\s])(?:file|portal|git\+[a-z]+|git|github):|resolved\s+"(?!https:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\/)/;

/** A lockfile read as text: the lines the current side added, and whether any leaves the registry. */
function textLockDependency(
  name: string,
  reference: string | null,
  current: string | null,
): InstrumentDependency {
  const known = new Set((reference ?? "").split("\n"));
  const added = (current ?? "").split("\n").filter((line) => !known.has(line));
  return {
    name,
    reference: digest(reference),
    current: digest(current),
    currentSource:
      current === null
        ? "absent"
        : added.some((line) => nonRegistryLockLine.test(line))
          ? "other"
          : "registry",
  };
}

/** uv's lockfile: each tool package's block, and whether its source is a registry. */
function uvDependencies(
  reference: string | null,
  current: string | null,
  patterns: readonly string[],
): readonly InstrumentDependency[] {
  const blocks = (text: string | null) => {
    const found = new Map<string, string>();
    for (const block of (text ?? "").split(/^\[\[package\]\]\s*$/m)) {
      const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      if (name !== undefined && matchesPackage(name, patterns)) found.set(name, block.trim());
    }
    return found;
  };
  const before = blocks(reference);
  const after = blocks(current);
  return [...new Set([...before.keys(), ...after.keys()])].sort().map((name) => {
    const block = after.get(name) ?? null;
    return {
      name,
      reference: digest(before.get(name) ?? null),
      current: digest(block),
      currentSource:
        block === null
          ? "absent"
          : /^source\s*=\s*\{\s*registry\s*=/m.test(block)
            ? "registry"
            : "other",
    };
  });
}

export async function observeDependencies(
  trees: InstrumentTrees,
  rules: readonly ToolPackages[],
  names: readonly string[],
): Promise<readonly InstrumentDependency[]> {
  const patterns = [...new Set([...rules.flatMap((rule) => rule.packages), ...names])];
  const found: InstrumentDependency[] = [];
  const npmLock = async (read: (path: string) => Promise<string | null>) =>
    (await read("package-lock.json")) ?? (await read("npm-shrinkwrap.json"));
  const referenceLock = await npmLock(trees.reference);
  const currentLock = await npmLock(trees.current);
  if (referenceLock !== null || currentLock !== null) {
    const before = npmPackages(parseJson(referenceLock));
    const after = npmPackages(parseJson(currentLock));
    const roots = [
      ...new Set([...Object.keys(before), ...Object.keys(after)].map(entryName)),
    ].filter((name) => matchesPackage(name, patterns));
    const paths = [...new Set([...npmClosure(before, roots), ...npmClosure(after, roots)])].sort();
    for (const path of paths) {
      const entry = (value: NpmLockEntry | undefined) =>
        value === undefined
          ? null
          : canonical({
              version: value.version,
              resolved: value.resolved,
              integrity: value.integrity,
              link: value.link,
            });
      found.push({
        name: path,
        reference: digest(entry(before[path])),
        current: digest(entry(after[path])),
        currentSource: npmSource(path, after[path]),
      });
    }
  }
  for (const lockfile of ["pnpm-lock.yaml", "yarn.lock", "bun.lock"]) {
    const before = await trees.reference(lockfile);
    const after = await trees.current(lockfile);
    if (before === null && after === null) continue;
    found.push(textLockDependency(lockfile, before, after));
  }
  const binary = [await trees.reference("bun.lockb"), await trees.current("bun.lockb")];
  if (binary[0] !== null || binary[1] !== null)
    found.push({
      name: "bun.lockb",
      reference: digest(binary[0] ?? null),
      current: digest(binary[1] ?? null),
      currentSource: binary[1] === null ? "absent" : "other",
    });
  const uvBefore = await trees.reference("uv.lock");
  const uvAfter = await trees.current("uv.lock");
  if (uvBefore !== null || uvAfter !== null)
    found.push(...uvDependencies(uvBefore, uvAfter, patterns));
  for (const lockfile of ["poetry.lock", "Pipfile.lock", "pdm.lock"]) {
    const before = await trees.reference(lockfile);
    const after = await trees.current(lockfile);
    if (before === null && after === null) continue;
    found.push(textLockDependency(lockfile, before, after));
  }
  return found;
}

/**
 * The runner as installed where the check ran: the version the lockfile pins, and whether the
 * package manager's link for its executable resolves into that package. A `node_modules` edited
 * after install, or holding another version, runs a runner the lockfile does not name.
 */
export async function observeInstalled(
  trees: InstrumentTrees,
  rules: readonly ToolPackages[],
): Promise<readonly InstalledRunner[]> {
  const root = trees.installedRoot as string;
  const lock = npmPackages(
    parseJson(
      (await trees.current("package-lock.json")) ?? (await trees.current("npm-shrinkwrap.json")),
    ),
  );
  const pnpmLock = await trees.current("pnpm-lock.yaml");
  const runners: InstalledRunner[] = [];
  for (const rule of rules) {
    const name = rule.packages[0];
    if (name === undefined || name.endsWith("*")) continue;
    const packageDirectory = join(root, "node_modules", ...name.split("/"));
    const manifest = parseJson(
      await readFile(join(packageDirectory, "package.json"), "utf8").catch(() => null),
    );
    const found = typeof manifest?.version === "string" ? (manifest.version as string) : null;
    const expected =
      lock[`node_modules/${name}`]?.version ??
      (pnpmLock === null
        ? null
        : // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - name is a fixed tool package from the table above, escaped.
          (new RegExp(
            `^\\s+/?${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@(\\d[^:(\\s]*)`,
            "m",
          ).exec(pnpmLock)?.[1] ?? null));
    let linked = true;
    if (found !== null && rule.bin !== undefined) {
      const link = await realpath(join(root, "node_modules", ".bin", rule.bin)).catch(() => null);
      const target = await realpath(packageDirectory).catch(() => null);
      if (link !== null && target !== null) {
        const inside = relative(target, link);
        linked = !inside.startsWith("..") && !inside.startsWith(sep) && inside.length > 0;
        // A shell shim (Windows, some managers) is a file, not a link: read what it runs.
        if (!linked && dirname(link) === join(root, "node_modules", ".bin")) {
          const shim = await readFile(link, "utf8").catch(() => "");
          linked = shim.includes(`node_modules/${name}/`);
        }
      }
    }
    runners.push({ name, expected, found, linked });
  }
  return runners;
}

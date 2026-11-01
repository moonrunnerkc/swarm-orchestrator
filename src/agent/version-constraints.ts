import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { VersionConstraint } from "swarm-verify";

/** A package the workspace's manifests declare, by the name its registry knows. */
export interface Dependency {
  readonly name: string;
  readonly ecosystem: "npm" | "pypi";
}

const range = String.raw`[\^~]?v?\d+(?:\.(?:\d+|[xX*])){0,2}`;
/**
 * "<package> [packages] [from <version>] to|within [the] [version] [latest|newest] <range>": the
 * shapes a task uses to name a version. The range may end a sentence, but not run into a word.
 */
const phrase = new RegExp(
  String.raw`([@\w][\w@./-]*)(?:\s+packages?)?(?:\s+from\s+v?\d[\w.-]*)?\s+(?:to|within)\s+(?:the\s+)?(?:version\s+)?(?:(latest|newest)\s+)?(${range})(?![\w*]|\.[\w*])`,
  "gi",
);
/** Words that stand where a package name would, and name none: look further back. */
const notNames = new Set([
  "and",
  "both",
  "bump",
  "dependencies",
  "dependency",
  "it",
  "move",
  "or",
  "package",
  "packages",
  "pin",
  "set",
  "them",
  "update",
  "upgrade",
  "version",
  "versions",
]);

const normalized = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** The declared packages a word names: the one of that name, or those it names a part of. */
function named(word: string, dependencies: readonly Dependency[]): Dependency[] {
  const exact = dependencies.filter((one) => normalized(one.name) === normalized(word));
  if (exact.length > 0) return exact;
  const part = word.toLowerCase();
  return dependencies.filter((one) =>
    one.name
      .toLowerCase()
      .split(/[@/._-]+/)
      .includes(part),
  );
}

/**
 * The version constraints a task's own words state, read by this code and never by a model, so
 * the verifier can hold a candidate to them. A phrase whose package no manifest declares is left
 * out with a note: its registry name would be a guess.
 */
export function versionConstraintsOf(
  task: string,
  dependencies: readonly Dependency[],
): { readonly constraints: VersionConstraint[]; readonly notes: string[] } {
  const constraints: VersionConstraint[] = [];
  const notes: string[] = [];
  for (const match of task.matchAll(phrase)) {
    const [wording, subject = "", latest, wanted = ""] = match;
    // "Upgrade lodash and pin to 4.17.21": the package is the nearest one named before.
    const packages = notNames.has(subject.toLowerCase())
      ? (task
          .slice(0, match.index)
          .split(/[^\w@./-]+/)
          .reverse()
          .map((word) => named(word, dependencies))
          .find((found) => found.length > 0) ?? [])
      : named(subject, dependencies);
    if (packages.length === 0) {
      notes.push(
        `the task names a version for "${subject}" (${wording}), and no manifest here lists a package of that name, so the verifier does not hold the version`,
      );
      continue;
    }
    for (const one of packages) {
      if (constraints.some((seen) => seen.name === one.name && seen.range === wanted)) continue;
      constraints.push({
        name: one.name,
        ecosystem: one.ecosystem,
        range: wanted,
        latest: latest !== undefined,
        wording,
      });
    }
  }
  return { constraints, notes };
}

const readText = (path: string) => readFile(path, "utf8").catch(() => null);
/** The distribution name a PEP 508 requirement string starts with. */
const requirementName = (spec: unknown) =>
  typeof spec === "string" ? (/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1] ?? null) : null;

function npmNames(text: string): string[] {
  const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (field) => Object.keys(manifest[field] ?? {}),
  );
}

function pypiNames(text: string): string[] {
  const toml = parseToml(text) as {
    project?: { dependencies?: unknown[]; "optional-dependencies"?: Record<string, unknown[]> };
    "dependency-groups"?: Record<string, unknown[]>;
    tool?: { uv?: { "dev-dependencies"?: unknown[] } };
  };
  const specs = [
    ...(toml.project?.dependencies ?? []),
    ...Object.values(toml.project?.["optional-dependencies"] ?? {}).flat(),
    ...Object.values(toml["dependency-groups"] ?? {}).flat(),
    ...(toml.tool?.uv?.["dev-dependencies"] ?? []),
  ];
  return specs.map(requirementName).filter((name) => name !== null);
}

/**
 * Every package the root package.json and pyproject.toml declare, in the order they list them,
 * and why a manifest that is there could not be read.
 */
export async function workspaceDependencies(
  dir: string,
): Promise<{ readonly dependencies: Dependency[]; readonly notes: string[] }> {
  const declared: Dependency[] = [];
  const notes: string[] = [];
  const manifests = [
    { file: "package.json", ecosystem: "npm" as const, names: npmNames },
    { file: "pyproject.toml", ecosystem: "pypi" as const, names: pypiNames },
  ];
  for (const { file, ecosystem, names } of manifests) {
    const text = await readText(join(dir, file));
    if (text === null) continue;
    try {
      declared.push(...names(text).map((name) => ({ name, ecosystem })));
    } catch (error) {
      notes.push(
        `${file} does not parse (${(error as Error).message}), so no version the task names for its packages is held`,
      );
    }
  }
  const dependencies = declared.filter(
    (one, at) =>
      declared.findIndex(
        (other) =>
          other.ecosystem === one.ecosystem && normalized(other.name) === normalized(one.name),
      ) === at,
  );
  return { dependencies, notes };
}

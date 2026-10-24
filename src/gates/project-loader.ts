/**
 * How a probe program loads the project, grounded in what loads (project-loader-v1).
 *
 * A probe is an ES module run from the repository root. On October 24 a reviewer's probes
 * imported `./src/index.js` from a TypeScript project whose sources are `.ts` with extensionless
 * imports; every run failed with ERR_MODULE_NOT_FOUND, and the review measured nothing. A
 * sentence telling the model to load sources "the way the project's own checks do" did not
 * change that. So the harness tries the ways a project can be loaded, in an order read from the
 * repository (the entry the task names, the manifest's entry points, the usual source entries;
 * a loader the project has installed for TypeScript), and keeps the first that loads on the base
 * and exposes exports. Every probe the harness builds starts with that preamble, and the
 * reviewer is given it with the exports it showed.
 *
 * Nothing is guessed into a pass: where none loads, the loader is null with every attempt and
 * its error recorded, and what a probe would have measured stays unmeasured.
 */
export const loaderRule = "project-loader-v1";

export type LoaderMethod = "native" | "jiti" | "jiti-v1" | "tsx";

export interface LoaderCandidate {
  /** The module, relative to the repository root, as `./path`. */
  readonly entry: string;
  readonly method: LoaderMethod;
}

export interface GroundedLoader extends LoaderCandidate {
  readonly rule: typeof loaderRule;
  /** Module source that leaves the project's namespace in `project`. */
  readonly preamble: string;
  /** The names the namespace exposed on the base, sorted. */
  readonly exports: readonly string[];
}

export interface LoaderAttempt extends LoaderCandidate {
  readonly outcome: string;
}

/** What the repository shows about how it can be loaded. */
export interface LoaderFacts {
  readonly task: string;
  /** The source files the change edits, which the task concerns; tried after those it names. */
  readonly changed?: readonly string[];
  /** The parsed package.json at the root, or null. */
  readonly manifest: unknown;
  readonly exists: (path: string) => boolean;
  /** The installed version of a package under the root's node_modules, or null. */
  readonly installed: (name: string) => string | null;
}

const maxCandidates = 8;
const sourceFile =
  /(?:^|[\s(`"'])((?:\.\/)?[\w@-][\w@./-]*\.(?:ts|mts|cts|js|mjs|cjs))(?=[\s)`"',.;:]|$)/g;

/** The manifest's entry points, most specific first: `exports["."]`, then module, then main. */
function manifestEntries(manifest: unknown): readonly string[] {
  if (manifest === null || typeof manifest !== "object") return [];
  const record = manifest as Record<string, unknown>;
  const entries: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") entries.push(value);
    else if (value !== null && typeof value === "object")
      for (const key of ["import", "node", "default", "require"]) {
        const nested = (value as Record<string, unknown>)[key];
        if (nested !== undefined) visit(nested);
      }
  };
  const exported = record.exports;
  if (typeof exported === "string") entries.push(exported);
  else if (exported !== null && typeof exported === "object") {
    const root = (exported as Record<string, unknown>)["."];
    visit(root === undefined ? exported : root);
  }
  for (const key of ["module", "main"])
    if (typeof record[key] === "string") entries.push(record[key] as string);
  return entries;
}

const normalized = (path: string) => (path.startsWith("./") ? path : `./${path}`);

/** The ways to try, in order, deduplicated and bounded. */
export function loaderCandidates(facts: LoaderFacts): readonly LoaderCandidate[] {
  const named = [...facts.task.matchAll(sourceFile)].map((found) => found[1] as string);
  // An entry the task names comes first, index files before others.
  const fromTask = named
    .filter((path) => !/\.(test|spec)\./.test(path))
    .sort((left, right) => Number(/\bindex\./.test(right)) - Number(/\bindex\./.test(left)));
  const changed = (facts.changed ?? []).filter(
    (path) =>
      /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(path) &&
      !/(?:^|[./])(?:test|spec)[./]|__tests__/.test(path),
  );
  const entries = [
    ...fromTask,
    ...changed,
    ...manifestEntries(facts.manifest),
    "src/index.ts",
    "src/index.mts",
    "src/index.js",
    "src/index.mjs",
    "index.js",
    "index.mjs",
    "lib/index.js",
  ]
    .map(normalized)
    .filter((path, index, all) => all.indexOf(path) === index && facts.exists(path));
  const jiti = facts.installed("jiti");
  const tsx = facts.installed("tsx");
  const typescriptLoaders: LoaderMethod[] = [
    ...(jiti === null
      ? []
      : ([Number(jiti.split(".")[0]) >= 2 ? "jiti" : "jiti-v1"] as LoaderMethod[])),
    ...(tsx === null ? [] : ["tsx" as const]),
    "native",
  ];
  const candidates = entries.flatMap((entry): LoaderCandidate[] =>
    /\.(?:ts|mts|cts)$/.test(entry)
      ? typescriptLoaders.map((method) => ({ entry, method }))
      : [
          { entry, method: "native" },
          ...(jiti === null
            ? []
            : [
                {
                  entry,
                  method: (Number(jiti.split(".")[0]) >= 2 ? "jiti" : "jiti-v1") as LoaderMethod,
                },
              ]),
        ],
  );
  return candidates.slice(0, maxCandidates);
}

/** Module source that leaves the project's namespace in `project`. */
export function preambleFor(candidate: LoaderCandidate): string {
  const entry = JSON.stringify(candidate.entry);
  switch (candidate.method) {
    case "native":
      return `const project = await import(${entry});`;
    case "jiti":
      return `import { createJiti } from "jiti";\nconst project = await createJiti(import.meta.url).import(${entry});`;
    case "jiti-v1":
      return `import { createRequire } from "node:module";\nimport { fileURLToPath } from "node:url";\nconst project = createRequire(import.meta.url)("jiti")(fileURLToPath(import.meta.url), { interopDefault: true })(${entry});`;
    case "tsx":
      return `import { tsImport } from "tsx/esm/api";\nconst project = await tsImport(${entry}, import.meta.url);`;
  }
}

/** The program that tries a candidate: it loads the project and answers its export names. */
export function exportsProgram(candidate: LoaderCandidate): string {
  return `${preambleFor(candidate)}\nexport default () => Object.keys(project).filter((name) => name !== "default").sort();`;
}

/**
 * The first candidate whose program loads and answers a nonempty list of export names, tried in
 * order through `run`, which reports the program's answer or why it gave none.
 */
export async function groundLoader(
  candidates: readonly LoaderCandidate[],
  run: (program: string) => Promise<{ readonly answer: unknown } | { readonly failed: string }>,
): Promise<{
  readonly loader: GroundedLoader | null;
  readonly attempts: readonly LoaderAttempt[];
}> {
  const attempts: LoaderAttempt[] = [];
  for (const candidate of candidates) {
    const outcome = await run(exportsProgram(candidate));
    if ("failed" in outcome) {
      attempts.push({ ...candidate, outcome: outcome.failed.slice(0, 400) });
      continue;
    }
    const names = Array.isArray(outcome.answer)
      ? outcome.answer.filter((one): one is string => typeof one === "string")
      : [];
    if (names.length === 0) {
      attempts.push({ ...candidate, outcome: "it loaded and exposed no exports" });
      continue;
    }
    attempts.push({ ...candidate, outcome: `loaded, ${names.length} exports` });
    return {
      loader: {
        rule: loaderRule,
        ...candidate,
        preamble: preambleFor(candidate),
        exports: [...names].sort(),
      },
      attempts,
    };
  }
  return { loader: null, attempts };
}

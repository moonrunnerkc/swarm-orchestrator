import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import {
  canonical,
  digest,
  type InstalledRunner,
  type InstrumentDependency,
  observeDependencies,
  observeInstalled,
  parseJson,
} from "./instrument-dependencies.ts";

export type { InstalledRunner, InstrumentDependency } from "./instrument-dependencies.ts";

/**
 * Whether the instrument that measured a check is the one the reference commit declares.
 *
 * A test runner's configuration runs in the process that writes the report the verdict reads,
 * and a package script decides what `npm run test` executes at all. A change that edits either
 * chooses the instrument that measures it: a `vitest.config.mjs` that writes a passing report
 * and exits before any test runs, or a `test` script replaced by an `echo` of a passing summary,
 * both read as a pass through 1.0.7. Nothing inside that process can tell a real report from a
 * forged one, so authenticity is decided outside it, by identity: the instrument is everything
 * the check loads that is not the tests or the source under test, compared with the reference.
 *
 * What counts as the instrument, for each check:
 * - the package scripts the check's command reaches (`test`, `pretest`, `posttest`, and every
 *   script those bodies run), where the command goes through a package manager, and `.npmrc`;
 * - each tool's configuration by the names that tool discovers, and the fields of package.json
 *   and pyproject.toml it reads;
 * - every file those reach: static imports and requires, and any string that names a file in
 *   the tree (setup files, reporters, transforms, presets), followed through both trees;
 * - every local file the command names;
 * - the tool's own packages and what they depend on, by lockfile entry and declared source.
 *
 * A registry release of a tool at another version is a different instrument but not an authored
 * one, and is recorded as trusted; a tool resolved from the tree, a path, a URL or a git source
 * that the reference did not already use is authored by the change and is not. A reference
 * configuration that loads files by computed names is named as a residual: the files it may load
 * are not followed.
 *
 * The rule that turns this observation into a decision is `instrumentChanges` below, and the
 * dependency-free verifier implements it again (`src/evidence/verifier/status.mjs`).
 */
export const instrumentRule = "instrument-identity-v1";

export interface InstrumentFile {
  /** A tree path, or `<file>#<field>` for the part of a shared manifest the tool reads. */
  readonly path: string;
  readonly reference: string | null;
  readonly current: string | null;
}

export interface InstrumentObservation {
  readonly rule: typeof instrumentRule;
  readonly tools: readonly string[];
  readonly files: readonly InstrumentFile[];
  readonly dependencies: readonly InstrumentDependency[];
  readonly installed: readonly InstalledRunner[];
  /** False where the closure could not be followed to its end; an unfinished reading is not trust. */
  readonly complete: boolean;
  readonly residuals: readonly string[];
  /**
   * The digest of the same observation taken before the check ran, where one was. A file the
   * run itself rewrote (a test that swaps the configuration and puts it back) differs here.
   */
  readonly before?: string;
}

const digestPattern = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const instrumentObservationSchema = z.strictObject({
  rule: z.literal(instrumentRule),
  tools: z.array(z.string()),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      reference: digestPattern.nullable(),
      current: digestPattern.nullable(),
    }),
  ),
  dependencies: z.array(
    z.strictObject({
      name: z.string().min(1),
      reference: digestPattern.nullable(),
      current: digestPattern.nullable(),
      currentSource: z.enum(["registry", "tree", "other", "absent"]),
    }),
  ),
  installed: z.array(
    z.strictObject({
      name: z.string().min(1),
      expected: z.string().nullable(),
      found: z.string().nullable(),
      linked: z.boolean(),
    }),
  ),
  complete: z.boolean(),
  residuals: z.array(z.string()),
  before: digestPattern.optional(),
});

/** The digest an observation carries as `before`: of everything in it but that field. */
export function observationDigest(observation: InstrumentObservation): string {
  const { before: _before, ...rest } = observation;
  return digest(canonical(rest) ?? "") as string;
}

/** The two trees being compared, read by path, and where the current tree is installed. */
export interface InstrumentTrees {
  reference(path: string): Promise<string | null>;
  current(path: string): Promise<string | null>;
  /** Every path that differs between the trees: added, modified or deleted. */
  readonly changed: readonly string[];
  /** Every path either tree holds, so a name is looked up before anything is read for it. */
  readonly listed: ReadonlySet<string>;
  /** The directory whose node_modules the check ran against, or null to leave installs unread. */
  readonly installedRoot: string | null;
}

export interface InstrumentedCommand {
  /** The rendering of what ran; a package-manager script is read from it. */
  readonly command: string | null;
  /** The vector the harness spawned, where it built one. */
  readonly argv: readonly string[] | null;
}

/** What makes an observation untrusted, by name; empty means the instrument is the reference's. */
export function instrumentChanges(observation: InstrumentObservation): readonly string[] {
  const changed: string[] = [];
  for (const file of observation.files)
    if (file.reference !== file.current) changed.push(file.path);
  for (const dependency of observation.dependencies)
    if (
      dependency.reference !== dependency.current &&
      dependency.currentSource !== "registry" &&
      dependency.currentSource !== "absent"
    )
      changed.push(`dependency ${dependency.name}`);
  for (const runner of observation.installed) {
    if (runner.found === null) continue;
    if (runner.expected !== null && runner.found !== runner.expected)
      changed.push(`installed ${runner.name} ${runner.found} (lockfile ${runner.expected})`);
    if (!runner.linked) changed.push(`installed ${runner.name} executable link`);
  }
  if (!observation.complete) changed.push("instrument closure not followed to its end");
  if (observation.before !== undefined && observation.before !== observationDigest(observation))
    changed.push("the instrument changed while the check ran");
  return changed;
}

/** The reading a check keeps once its instrument is known: a pass it did not author, or not one. */
export function readUnderInstrument<
  Reading extends {
    readonly status: "passed" | "failed" | "not-applicable";
    readonly detail: string;
  },
>(reading: Reading, observation: InstrumentObservation | null): Reading {
  if (observation === null || reading.status !== "passed") return reading;
  const changes = instrumentChanges(observation);
  if (changes.length === 0) return reading;
  return {
    ...reading,
    status: "not-applicable",
    detail:
      `the runner reported a pass, but this change altered the instrument that measured it ` +
      `(${changes.slice(0, 6).join(", ")}${changes.length > 6 ? `, and ${changes.length - 6} more` : ""}), ` +
      "so the pass is the project's report, not evidence. `swarm-verify ci` reruns the check " +
      "with the reference's instrument restored",
  };
}

const codeExtensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".tsx", ".jsx"];
const configExtensions = [...codeExtensions, ".json"];

interface ToolRule {
  readonly word: RegExp;
  /** Root-level names the tool discovers on its own. */
  readonly names: readonly string[];
  /** package.json fields the tool reads. */
  readonly packageFields: readonly string[];
  /** pyproject.toml tables the tool reads, as dotted paths. */
  readonly pyprojectTables: readonly string[];
  /** Dependency names or prefixes (a trailing `*`) that are the tool itself. */
  readonly packages: readonly string[];
  /** The executable a package manager links, where the tool is a Node package with one. */
  readonly bin?: string;
}

const withExtensions = (stem: string, extensions: readonly string[]) =>
  extensions.map((extension) => `${stem}${extension}`);

const tools: Readonly<Record<string, ToolRule>> = {
  vitest: {
    word: /\bvitest\b/,
    names: [
      ...withExtensions("vitest.config", configExtensions),
      ...withExtensions("vite.config", configExtensions),
      ...withExtensions("vitest.workspace", configExtensions),
      ...withExtensions("vitest.projects", configExtensions),
    ],
    packageFields: [],
    pyprojectTables: [],
    packages: ["vitest", "@vitest/*", "vite", "vite-node"],
    bin: "vitest",
  },
  jest: {
    word: /\bjest\b/,
    names: [
      ...withExtensions("jest.config", configExtensions),
      ...withExtensions("babel.config", configExtensions),
      ".babelrc",
      ...withExtensions(".babelrc", [".js", ".cjs", ".mjs", ".json"]),
    ],
    packageFields: ["jest", "babel"],
    pyprojectTables: [],
    packages: ["jest", "jest-*", "@jest/*", "babel-jest", "ts-jest", "@babel/*"],
    bin: "jest",
  },
  mocha: {
    word: /\bmocha\b/,
    names: [
      ".mocharc",
      ...withExtensions(".mocharc", [".js", ".cjs", ".yaml", ".yml", ".json", ".jsonc"]),
    ],
    packageFields: ["mocha"],
    pyprojectTables: [],
    packages: ["mocha"],
    bin: "mocha",
  },
  ava: {
    word: /\bava\b/,
    names: withExtensions("ava.config", [".js", ".cjs", ".mjs"]),
    packageFields: ["ava"],
    pyprojectTables: [],
    packages: ["ava"],
    bin: "ava",
  },
  playwright: {
    word: /\bplaywright\b/,
    names: withExtensions("playwright.config", codeExtensions),
    packageFields: [],
    pyprojectTables: [],
    packages: ["@playwright/test", "playwright", "playwright-core"],
    bin: "playwright",
  },
  "node-test": {
    word: /\bnode\b[^&|;]*--test\b/,
    names: [],
    packageFields: [],
    pyprojectTables: [],
    packages: [],
  },
  loader: {
    word: /\b(tsx|ts-node|c8|nyc|cross-env)\b/,
    names: [".nycrc", ".nycrc.json", ".c8rc", ".c8rc.json"],
    packageFields: ["nyc", "c8"],
    pyprojectTables: [],
    packages: ["tsx", "ts-node", "c8", "nyc", "cross-env"],
  },
  eslint: {
    word: /\beslint\b/,
    names: [
      ...withExtensions("eslint.config", codeExtensions),
      ".eslintrc",
      ...withExtensions(".eslintrc", [".js", ".cjs", ".json", ".yaml", ".yml"]),
      ".eslintignore",
    ],
    packageFields: ["eslintConfig", "eslintIgnore"],
    pyprojectTables: [],
    packages: ["eslint", "eslint-*", "@eslint/*", "@typescript-eslint/*", "typescript-eslint"],
    bin: "eslint",
  },
  prettier: {
    word: /\bprettier\b/,
    names: [
      ...withExtensions("prettier.config", codeExtensions),
      ".prettierrc",
      ...withExtensions(".prettierrc", [
        ".json",
        ".json5",
        ".yaml",
        ".yml",
        ".js",
        ".cjs",
        ".mjs",
        ".toml",
      ]),
      ".prettierignore",
    ],
    packageFields: ["prettier"],
    pyprojectTables: [],
    packages: ["prettier", "prettier-plugin-*"],
    bin: "prettier",
  },
  biome: {
    word: /\bbiome\b/,
    names: ["biome.json", "biome.jsonc"],
    packageFields: [],
    pyprojectTables: [],
    packages: ["@biomejs/*"],
  },
  tsc: {
    word: /\b(tsc|vue-tsc|tsgo)\b/,
    names: ["tsconfig.json"],
    packageFields: [],
    pyprojectTables: [],
    packages: ["typescript", "vue-tsc", "@typescript/native-preview"],
    bin: "tsc",
  },
  pytest: {
    word: /\bpytest\b/,
    names: ["pytest.ini", "setup.cfg", "tox.ini", "conftest.py"],
    packageFields: [],
    pyprojectTables: ["tool.pytest"],
    packages: ["pytest", "pytest-*", "pluggy"],
  },
  ruff: {
    word: /\bruff\b/,
    names: ["ruff.toml", ".ruff.toml"],
    packageFields: [],
    pyprojectTables: ["tool.ruff"],
    packages: ["ruff"],
  },
  mypy: {
    word: /\bmypy\b/,
    names: ["mypy.ini", ".mypy.ini", "setup.cfg"],
    packageFields: [],
    pyprojectTables: ["tool.mypy"],
    packages: ["mypy"],
  },
};

const closureLimit = 400;

function scriptsOf(manifest: Record<string, unknown> | null): Readonly<Record<string, string>> {
  const scripts = manifest?.scripts;
  if (scripts === null || typeof scripts !== "object") return {};
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The package script a package-manager command runs, or null where the command is not one. */
function scriptOf(command: string | null): string | null {
  if (command === null) return null;
  const match = /^(?:npm|pnpm|yarn|bun)\s+run(?:\s+--?[\w-]+(?:=\S+)?)*\s+([\w:.@/-]+)\s*$/.exec(
    command.trim(),
  );
  return match?.[1] ?? null;
}

/** Every script a script body runs through a package manager, by name. */
function scriptsNamedIn(body: string): readonly string[] {
  const names: string[] = [];
  for (const match of body.matchAll(
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?(?:--?[\w-]+(?:=\S+)?\s+)*([\w:.@/-]+)/g,
  ))
    if (match[1] !== undefined && !["run", "exec", "install", "ci", "x"].includes(match[1]))
      names.push(match[1]);
  for (const match of body.matchAll(/\b(?:run-s|run-p|npm-run-all)\s+([^&|;]+)/g))
    for (const word of (match[1] ?? "").split(/\s+/))
      if (word.length > 0 && !word.startsWith("-")) names.push(word);
  return names;
}

/** The scripts a package-manager command reaches, from both manifests, and their bodies. */
function scriptChain(
  script: string,
  reference: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): readonly string[] {
  const reached = new Set<string>();
  const pending = [script];
  while (pending.length > 0 && reached.size < 200) {
    const name = pending.shift() as string;
    for (const candidate of [`pre${name}`, name, `post${name}`]) {
      if (reached.has(candidate)) continue;
      reached.add(candidate);
      for (const body of [reference[candidate], current[candidate]])
        if (body !== undefined) pending.push(...scriptsNamedIn(body));
    }
  }
  return [...reached].sort();
}

const testFileName =
  /(^|\/)(__tests__|__mocks__)\/|(\.|_)(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;

const interpreters = /^(?:node|nodejs|python[\d.]*|sh|bash|zsh|tsx|ts-node|bun|deno)$/;
/** Flags after which the next word is the flag's value rather than the program. */
const valuedFlags =
  /^(?:-r|--require|--import|--loader|--experimental-loader|-m|--env-file|--conditions|-C|--input-type|--test-reporter|--test-reporter-destination|--test-name-pattern)$/;
/** Flags that mean no file is run as a program: code inline, a syntax check, a module, the test runner. */
const noProgram = /^(?:-e|--eval|-p|--print|-c|--check|--test|-m|run)$/;

/** The files an interpreter in the command runs as its program. */
function programsRun(text: string): readonly string[] {
  const programs: string[] = [];
  for (const segment of text.split(/&&|\|\||[;|\n]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const start = words.findIndex((word) => interpreters.test(word.split("/").at(-1) ?? word));
    if (start === -1) continue;
    for (let index = start + 1; index < words.length; index++) {
      const word = (words[index] as string).replace(/^["']|["']$/g, "");
      if (noProgram.test(word)) break;
      if (valuedFlags.test(word)) {
        index++;
        continue;
      }
      if (word.startsWith("-")) continue;
      if (/^[\w./@-]+$/.test(word)) programs.push(word);
      break;
    }
  }
  return programs;
}

/** Paths a string could name, relative to the file that holds it and to the tree's root. */
function candidatePaths(specifier: string, from: string): readonly string[] {
  const cleaned = specifier.replace(/^<rootDir>\//, "/").replace(/[?#].*$/, "");
  if (cleaned.length === 0 || cleaned.length > 300 || /[\s*{}$`]/.test(cleaned)) return [];
  const base = cleaned.startsWith("/") ? "" : posix.dirname(from);
  const joined = posix.normalize(posix.join(base, cleaned.replace(/^\/+/, "")));
  const roots =
    cleaned.startsWith(".") || cleaned.startsWith("/")
      ? [joined]
      : [joined, posix.normalize(cleaned)];
  const paths: string[] = [];
  for (const root of roots) {
    if (root.startsWith("..") || root === ".") continue;
    paths.push(root);
    for (const extension of codeExtensions) paths.push(`${root}${extension}`);
    for (const extension of codeExtensions) paths.push(`${root}/index${extension}`);
  }
  return paths;
}

const bareSpecifier = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(\/.*)?$/;

const builtins = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "process",
  "stream",
  "url",
  "util",
  "vm",
  "worker_threads",
  "zlib",
]);

interface Reading {
  readonly specifiers: readonly string[];
  readonly strings: readonly string[];
  readonly globs: readonly string[];
  readonly open: readonly string[];
}

/** What a JavaScript or JSON-shaped file names: modules it loads and strings it holds. */
function readScript(text: string): Reading {
  const specifiers: string[] = [];
  for (const match of text.matchAll(
    /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]*\s*from\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\brequire\.resolve\s*\(\s*)["'`]([^"'`\n]+)["'`]/g,
  ))
    if (match[1] !== undefined) specifiers.push(match[1]);
  const strings: string[] = [];
  const globs: string[] = [];
  for (const match of text.matchAll(/["'`]([^"'`\n]{1,300})["'`]/g)) {
    const value = match[1] ?? "";
    if (/[*]/.test(value)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 300), match.index ?? 0);
      const key = [...before.matchAll(/([A-Za-z_$][\w$]*)["']?\s*[:=]/g)].at(-1)?.[1] ?? "";
      if (
        /setup|teardown|reporter|require|import|loader|plugin|environment|transform|serializer|resolver|runner|preset|extends/i.test(
          key,
        )
      )
        globs.push(value);
    } else strings.push(value);
  }
  const open: string[] = [];
  if (/\b(?:import|require)\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))/.test(text))
    open.push("a module loaded by a computed name");
  if (/\bcreateRequire\b/.test(text) && /\brequire\s*\(\s*[^"'`\s)]/.test(text))
    open.push("a module loaded by a computed name");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(text)) open.push("code evaluated from a string");
  if (/\b(?:readdirSync|readdir|globSync|fg\.sync|fast-glob|tinyglobby)\b/.test(text))
    open.push("files listed at run time");
  return { specifiers, strings, globs, open: [...new Set(open)] };
}

/** What a Python file imports, and the plugin modules a conftest names. */
function readPython(text: string): Reading {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([\w, ()*]+)/gm)) {
    const module = match[1] ?? "";
    specifiers.push(module);
    if (/^\.+$/.test(module))
      for (const name of (match[2] ?? "").replace(/[()]/g, "").split(","))
        if (name.trim().length > 0) specifiers.push(`${module}${name.trim().split(/\s+/)[0]}`);
  }
  for (const match of text.matchAll(/^\s*import\s+([\w., ]+)/gm))
    for (const name of (match[1] ?? "").split(","))
      if (name.trim().length > 0) specifiers.push(name.trim().split(/\s+/)[0] ?? "");
  const strings: string[] = [];
  const plugins = /pytest_plugins\s*=\s*[[(]?([^\n\])]*)/.exec(text)?.[1] ?? "";
  for (const match of plugins.matchAll(/["']([\w.]+)["']/g)) specifiers.push(match[1] ?? "");
  const open: string[] = [];
  if (/\b(?:importlib\.import_module|__import__|exec|eval)\s*\(/.test(text))
    open.push("a module loaded by a computed name");
  return { specifiers, strings, globs: [], open };
}

function pythonCandidates(module: string, from: string): readonly string[] {
  const dots = /^\.*/.exec(module)?.[0].length ?? 0;
  const parts = module
    .slice(dots)
    .split(".")
    .filter((part) => part.length > 0);
  const tail = parts.join("/");
  const roots: string[] = [];
  if (dots > 0) {
    let directory = posix.dirname(from);
    for (let level = 1; level < dots; level++) directory = posix.dirname(directory);
    roots.push(directory === "." ? "" : directory);
  } else {
    let directory = posix.dirname(from);
    for (;;) {
      roots.push(directory === "." ? "" : directory);
      if (directory === "." || directory === "/" || directory === "") break;
      directory = posix.dirname(directory);
    }
    roots.push("src");
  }
  const paths: string[] = [];
  for (const root of roots) {
    const stem = [root, tail].filter((part) => part.length > 0).join("/");
    if (stem.length === 0) continue;
    paths.push(`${stem}.py`, `${stem}/__init__.py`);
  }
  return paths;
}

function globPattern(glob: string, from: string): RegExp | null {
  const cleaned = glob.replace(/^<rootDir>\//, "").replace(/^\.\//, "");
  if (cleaned.startsWith("..") || cleaned.length > 200) return null;
  const base = glob.startsWith(".") ? posix.dirname(from) : "";
  const full = posix.normalize(posix.join(base, cleaned));
  let source = "";
  for (let index = 0; index < full.length; index++) {
    const character = full[index] as string;
    if (character === "*" && full[index + 1] === "*") {
      source += ".*";
      index++;
      if (full[index + 1] === "/") index++;
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else if (character === "{") source += "(?:";
    else if (character === "}") source += ")";
    else if (character === ",") source += "|";
    else source += character.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  try {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - built character by character from a configuration glob with every metacharacter escaped, bounded to 200 characters.
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/** The package name a bare specifier names. */
function packageName(specifier: string): string | null {
  if (specifier.startsWith("node:") || builtins.has(specifier)) return null;
  const match = bareSpecifier.exec(specifier);
  return match?.[1] ?? null;
}

const nonRegistrySpecifier =
  /^(?:file:|link:|portal:|workspace:|git|github:|gitlab:|bitbucket:|https?:|npm:|\.|\/)/;

function declaredDependencies(
  manifest: Record<string, unknown> | null,
): Readonly<Record<string, string>> {
  const declared: Record<string, string> = {};
  const fields = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "overrides",
    "resolutions",
  ];
  for (const field of fields) {
    const value = manifest?.[field];
    if (value !== null && typeof value === "object")
      for (const [name, spec] of Object.entries(value as Record<string, unknown>))
        declared[`${field}:${name}`] = typeof spec === "string" ? spec : (canonical(spec) ?? "");
  }
  const pnpm = manifest?.pnpm;
  const overrides =
    pnpm !== null && typeof pnpm === "object"
      ? (pnpm as Record<string, unknown>).overrides
      : undefined;
  if (overrides !== null && typeof overrides === "object")
    for (const [name, spec] of Object.entries(overrides as Record<string, unknown>))
      declared[`pnpm.overrides:${name}`] =
        typeof spec === "string" ? spec : (canonical(spec) ?? "");
  return declared;
}

function tomlTable(text: string | null, table: string): string | null {
  if (text === null) return null;
  try {
    let value: unknown = parseToml(text);
    for (const key of table.split(".")) {
      if (value === null || typeof value !== "object") return null;
      value = (value as Record<string, unknown>)[key];
    }
    return canonical(value);
  } catch {
    // An unreadable pyproject is compared whole: a change the reader cannot see into is still a change.
    return text;
  }
}

/** Observe the instrument one check's command runs under, in both trees. */
export async function observeInstrument(
  command: InstrumentedCommand,
  trees: InstrumentTrees,
): Promise<InstrumentObservation> {
  const files = new Map<string, InstrumentFile>();
  const residuals = new Set<string>();
  const dependencyNames = new Set<string>();
  let complete = true;

  const note = (path: string, reference: string | null, current: string | null) => {
    if (reference === null && current === null) return;
    if (!files.has(path))
      files.set(path, { path, reference: digest(reference), current: digest(current) });
  };

  const referenceManifest = parseJson(await trees.reference("package.json"));
  const currentManifest = parseJson(await trees.current("package.json"));
  const referenceScripts = scriptsOf(referenceManifest);
  const currentScripts = scriptsOf(currentManifest);

  const script = scriptOf(command.command);
  const bodies: string[] = [];
  if (script !== null && command.argv === null) {
    for (const name of scriptChain(script, referenceScripts, currentScripts)) {
      const before = referenceScripts[name] ?? null;
      const after = currentScripts[name] ?? null;
      if (before === null && after === null) continue;
      note(`package.json#scripts.${name}`, before, after);
      for (const body of [before, after]) if (body !== null) bodies.push(body);
    }
    note(".npmrc", await trees.reference(".npmrc"), await trees.current(".npmrc"));
  } else if (command.argv !== null) bodies.push(command.argv.join(" "));
  else if (command.command !== null) bodies.push(command.command);
  const text = bodies.join("\n");

  const used = Object.entries(tools).filter(([, rule]) => rule.word.test(text));
  const toolNames = used.map(([name]) => name);

  const seeds = new Set<string>();
  const closureRoots = new Set<string>();
  for (const [, rule] of used) {
    for (const name of rule.names) seeds.add(name);
    for (const field of rule.packageFields)
      note(
        `package.json#${field}`,
        canonical(referenceManifest?.[field]),
        canonical(currentManifest?.[field]),
      );
    if (rule.pyprojectTables.length > 0) {
      const before = await trees.reference("pyproject.toml");
      const after = await trees.current("pyproject.toml");
      for (const table of rule.pyprojectTables)
        note(`pyproject.toml#${table}`, tomlTable(before, table), tomlTable(after, table));
    }
    for (const pattern of rule.packages) if (!pattern.endsWith("*")) dependencyNames.add(pattern);
  }
  // Every conftest pytest would collect, in either tree, wherever it sits.
  if (toolNames.includes("pytest"))
    for (const path of [...trees.listed, ...trees.changed])
      if (/(^|\/)conftest\.py$/.test(path)) seeds.add(path);
  // A tsconfig named on the command is the one read.
  for (const match of text.matchAll(/(?:^|\s)(?:-p|--project|-c|--config)[\s=]+(\S+)/g))
    if (match[1] !== undefined) seeds.add(posix.normalize(match[1].replace(/^\.\//, "")));
  // A local program the command runs is part of what runs, unless it is one of the tests. A
  // file handed to a tool as its subject (`node --check sum.js`, `eslint src`) is what is measured.
  for (const program of programsRun(text)) {
    const path = posix.normalize(program.replace(/^\.\//, ""));
    if (!path.startsWith("..") && !path.startsWith("/") && !testFileName.test(path))
      seeds.add(path);
  }
  for (const match of text.matchAll(
    /--(?:import|require|loader|experimental-loader|test-reporter)[\s=]+(\S+)/g,
  )) {
    const value = (match[1] ?? "").replace(/^\.\//, "");
    const name = packageName(value);
    if (name !== null && !value.includes(".")) dependencyNames.add(name);
    else seeds.add(posix.normalize(value));
  }

  const declaredBefore = declaredDependencies(referenceManifest);
  const declaredNow = declaredDependencies(currentManifest);
  // The closure: every seed on either side, and everything each names, on either side.
  const pending = [...seeds];
  const visited = new Set<string>();
  const globs: { pattern: RegExp; from: string }[] = [];
  while (pending.length > 0) {
    const path = pending.shift() as string;
    if (visited.has(path)) continue;
    if (!seeds.has(path) && !trees.listed.has(path)) continue;
    visited.add(path);
    if (visited.size > closureLimit) {
      complete = false;
      residuals.add(
        `the instrument names more than ${closureLimit} files; the rest were not followed`,
      );
      break;
    }
    const before = await trees.reference(path);
    const after = await trees.current(path);
    if (before === null && after === null) continue;
    note(path, before, after);
    closureRoots.add(path);
    const python = path.endsWith(".py");
    for (const [side, content] of [
      ["reference", before],
      ["current", after],
    ] as const) {
      if (content === null) continue;
      const reading = python ? readPython(content) : readScript(content);
      if (side === "reference")
        for (const construct of reading.open)
          residuals.add(`${path} uses ${construct}; files it loads that way are not followed`);
      for (const specifier of reading.specifiers) {
        if (python) {
          for (const candidate of pythonCandidates(specifier, path)) pending.push(candidate);
          continue;
        }
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          if (specifier.startsWith("/"))
            residuals.add(`${path} loads ${specifier} by an absolute path outside the comparison`);
          for (const candidate of candidatePaths(specifier, path)) pending.push(candidate);
        } else {
          const name = packageName(specifier);
          if (name !== null) dependencyNames.add(name);
        }
      }
      for (const value of reading.strings) {
        const name = packageName(value);
        if (
          name !== null &&
          (declaredNow[`devDependencies:${name}`] !== undefined ||
            declaredNow[`dependencies:${name}`] !== undefined)
        )
          dependencyNames.add(name);
        if (!/[/.]/.test(value)) continue;
        for (const candidate of candidatePaths(value, path))
          if (!testFileName.test(candidate)) pending.push(candidate);
      }
      for (const glob of reading.globs) {
        const pattern = globPattern(glob, path);
        if (pattern !== null) globs.push({ pattern, from: path });
      }
      // A tsconfig's parent is part of it.
      if (/tsconfig[\w.-]*\.json$/.test(path)) {
        const extended = /"extends"\s*:\s*"([^"]+)"/.exec(content)?.[1];
        if (extended !== undefined) {
          if (extended.startsWith("."))
            for (const candidate of candidatePaths(extended, path)) pending.push(candidate);
          else {
            const name = packageName(extended);
            if (name !== null) dependencyNames.add(name);
          }
        }
      }
    }
  }
  // A changed file a configuration names by pattern (a setup glob, a reporter directory).
  for (const path of trees.changed)
    if (
      !testFileName.test(path) &&
      globs.some((glob) => glob.pattern.test(path)) &&
      !files.has(path)
    )
      note(path, await trees.reference(path), await trees.current(path));
  // A tool the manifest now declares from somewhere other than a registry: a path, a link, a URL.
  for (const name of dependencyNames) {
    const before = declaredBefore;
    const after = declaredNow;
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "overrides",
      "resolutions",
      "pnpm.overrides",
    ]) {
      const key = `${field}:${name}`;
      if (before[key] === after[key]) continue;
      const spec = after[key];
      if (spec !== undefined && !nonRegistrySpecifier.test(spec)) continue;
      note(`package.json#${key}`, before[key] ?? null, spec ?? null);
    }
  }

  const dependencies = await observeDependencies(
    trees,
    used.map(([, rule]) => rule),
    [...dependencyNames],
  );
  const installed =
    trees.installedRoot === null
      ? []
      : await observeInstalled(
          trees,
          used.map(([, rule]) => rule),
        );

  return {
    rule: instrumentRule,
    tools: toolNames,
    files: [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    dependencies,
    installed,
    complete,
    residuals: [...residuals].sort(),
  };
}

const runGit = promisify(execFile);

async function gitLines(root: string, args: readonly string[]): Promise<readonly string[]> {
  try {
    const { stdout } = await runGit("git", [...args], { cwd: root, maxBuffer: 256_000_000 });
    return stdout.split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * The two trees of a git working copy: the reference commit read through git, the working tree
 * read from disk, each listed once. Reads are remembered, since a closure asks for the same
 * file from several configurations.
 */
export function gitInstrumentTrees(options: {
  readonly root: string;
  readonly referenceCommit: string;
  readonly changed: readonly string[];
  readonly readReference: (path: string) => Promise<string | null>;
  readonly readCurrent: (path: string) => Promise<string | null>;
  readonly installedRoot: string | null;
}): () => Promise<InstrumentTrees> {
  let listed: Promise<ReadonlySet<string>> | null = null;
  const remember = (read: (path: string) => Promise<string | null>) => {
    const cache = new Map<string, Promise<string | null>>();
    return (path: string) => {
      let found = cache.get(path);
      if (found === undefined) {
        found = read(path).catch(() => null);
        cache.set(path, found);
      }
      return found;
    };
  };
  const reference = remember(options.readReference);
  return async () => {
    listed ??= Promise.all([
      gitLines(options.root, ["ls-tree", "-r", "--name-only", "-z", options.referenceCommit]).then(
        (lines) => lines.flatMap((line) => line.split("\0")),
      ),
      gitLines(options.root, ["ls-files", "-co", "--exclude-standard", "-z"]).then((lines) =>
        lines.flatMap((line) => line.split("\0")),
      ),
    ]).then(
      ([before, after]) =>
        new Set([...before, ...after, ...options.changed].filter((path) => path.length > 0)),
    );
    return {
      reference,
      // Read fresh each time: the observation before a run and after it must see what was there.
      current: options.readCurrent,
      changed: options.changed,
      listed: await listed,
      installedRoot: options.installedRoot,
    };
  };
}

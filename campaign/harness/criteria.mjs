/**
 * The sealed selection criteria, as the harness reads them.
 *
 * `../criteria.md` is the document a person reads and the one that was committed before any
 * repository was queried; this module is the same criteria as values the selection step
 * consumes. The test beside it asserts that every value here appears in that document, so the
 * two cannot drift: changing a number here without changing the prose is a red test, and
 * changing the prose is a visible edit to a file that says it is immutable.
 */

export const sealedOn = "2026-09-02";

/** How many repositories each primary language contributes. */
export const quotas = Object.freeze({
  JavaScript: 13,
  TypeScript: 13,
  Python: 12,
  Go: 6,
  Rust: 6,
});

export const total = Object.values(quotas).reduce((sum, count) => sum + count, 0);

/** The search that produces the candidate list, one query per language and license. */
export const search = Object.freeze({
  endpoint: "GET /search/repositories",
  minimumStars: 200,
  pushedSince: "2025-01-01",
  sort: "stars",
  order: "desc",
  pageSize: 100,
});

export function searchQuery(language, license) {
  return (
    `language:${language} license:${license} stars:>=${search.minimumStars} ` +
    `pushed:>=${search.pushedSince} archived:false fork:false`
  );
}

/** SPDX identifiers GitHub reports, and the search keyword for each. */
export const licenses = Object.freeze({
  MIT: "mit",
  "Apache-2.0": "apache-2.0",
  "BSD-2-Clause": "bsd-2-clause",
  "BSD-3-Clause": "bsd-3-clause",
  ISC: "isc",
  "0BSD": "0bsd",
  Unlicense: "unlicense",
});

/** Non-blank lines of the primary language, within these bounds inclusive. */
export const lines = Object.freeze({ minimum: 300, maximum: 30000 });

export const extensionsByLanguage = Object.freeze({
  JavaScript: [".js", ".mjs", ".cjs", ".jsx"],
  TypeScript: [".ts", ".tsx", ".mts", ".cts"],
  Python: [".py"],
  Go: [".go"],
  Rust: [".rs"],
});

/** Directories the line count never descends into, and files it never counts. */
export const excludedDirectories = Object.freeze([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".git",
  "third_party",
  "__pycache__",
  ".venv",
  "coverage",
]);

export const excludedFilePatterns = Object.freeze([
  /\.min\.js$/,
  /\.d\.ts$/,
  /\.pb\.go$/,
  /_pb2\.py$/,
  /_generated\./,
]);

/** GitHub's reported repository size, in kilobytes. */
export const repositorySizeMaximumKilobytes = 200 * 1024;

/**
 * The test command the harness's own project detection derives per manifest. A repository
 * is accepted only where that detection would assemble a tests gate.
 */
export const manifests = Object.freeze({
  node: "package.json",
  python: "pyproject.toml",
  go: "go.mod",
  rust: "Cargo.toml",
});

export const testCommands = Object.freeze({
  node: "npm run --silent test",
  python: "pytest -q",
  go: "go test ./...",
  rust: "cargo test",
});

/** npm's own placeholder, which is a script that exists and tests nothing. */
export const placeholderTestScript = 'echo "Error: no test specified" && exit 1';

/**
 * How dependencies are installed at preparation time, with the network on. One recipe per
 * language, fixed, and a repository whose suite does not pass under it is rejected rather
 * than given a recipe of its own.
 */
export const installRecipes = Object.freeze({
  node: {
    "package-lock.json": ["npm", "ci", "--ignore-scripts=false"],
    "pnpm-lock.yaml": ["corepack", "pnpm", "install", "--frozen-lockfile"],
  },
  python: [
    ["python", "-m", "pip", "install", "-e", "."],
    ["python", "-m", "pip", "install", "pytest"],
  ],
  pythonOptionalExtras: ["dev", "test", "tests"],
  pythonRequirementFiles: ["requirements-dev.txt", "requirements/dev.txt", "requirements-test.txt"],
  go: [["go", "mod", "download"]],
  rust: [["cargo", "fetch"]],
});

export const budgets = Object.freeze({
  installTimeoutMinutes: 15,
  suiteTimeoutMinutes: 10,
  containerCpus: 4,
  containerMemoryGigabytes: 4,
});

/**
 * A dependency that means the suite needs a browser, a container runtime or a service the
 * campaign container does not have. Matched by name in the manifest's dependency lists.
 */
export const serviceDependencies = Object.freeze([
  "puppeteer",
  "playwright",
  "@playwright/test",
  "cypress",
  "selenium-webdriver",
  "testcontainers",
  "pytest-docker",
  "pytest-playwright",
  "selenium",
  "github.com/testcontainers/testcontainers-go",
]);

/** Markers of a multi-package tree, whose test command spans what the line count did not. */
export const workspaceMarkers = Object.freeze([
  "pnpm-workspace.yaml",
  "lerna.json",
  "go.work",
  "nx.json",
]);

export const excludedOwners = Object.freeze(["moonrunnerkc"]);

/** A repository configuring this tool would be configuring the harness that measures it. */
export const excludedFiles = Object.freeze(["swarm.toml"]);

/**
 * Seeding: one defect per repository from this operator list, in this order, accepted only
 * where the suite passes before and fails after. A repository no operator seeds within the
 * attempt cap is rejected and the next candidate takes its place.
 */
export const mutationOperators = Object.freeze([
  "flip-comparison",
  "off-by-one",
  "negate-condition",
  "drop-early-return",
  "swap-arguments",
]);

export const seedAttemptsMaximum = 12;

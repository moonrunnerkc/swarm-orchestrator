/**
 * Builds block 2's sealed registry (repository order, exposure checks, every candidate considered
 * with its decision and reason, and for the accepted tasks the validation results and digests)
 * and the public summary (task identity, task text, visible check and digests only), from the
 * scan files and the validation records under sealed/validation/.
 *   node build-registry.mjs
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/brad/.cache/swarm-heldout-2026-10-23";
const sealed = join(root, "sealed");
const { tasks } = await import(join(sealed, "heldout-tasks.mjs"));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const families = {
  1: "bounded API change with preservation",
  2: "mechanical multi-file transformation",
  3: "bug fix with regression test",
};
const accepted = {
  "5915b84a676632c6a350081aed5dee0d74e434f9": { id: "markdown-it-feature-reference-definition-token", directory: "mdit-feature", family: "api-change" },
  "2b49966fa6fed2be6fcf67e4eae7c0a8ed652a5e": { id: "markdown-it-refactor-ts-file-extensions", directory: "mdit-rename", family: "mechanical-transformation" },
  "3db3ef33e409a0bc0fdaf255e46c908b00e93bc2": { id: "svgo-bugfix-remove-scripts-anchor-bypass", directory: "svgo-bugfix", family: "bugfix" },
};
const reasons = {
  "1e8ab89ca": "documentation only (docs site menu)",
  "3bc8e2dc5": "a packaging and build change: publishes declaration files generated from the existing TypeScript sources (package.json exports and types, the build script, a new build dependency and lockfile churn); it adds no library option, method or signature and changes no behaviour, so it is not the family's bounded API change",
  "f73cb76a2": "documentation only (renames files under docs/migration/)",
  "7d365fe3b": "documentation only",
  "35cc740d2": "documentation only (docs navigation)",
  "76dc0e6ff": "one authored file (two package.json script names)",
  "b0520a860": "type annotations for strict mode across 23 files; not a rename or move of files, identifiers or import paths",
  "7f0139ce0": "type annotations (renderer); not a rename or move",
  "206651508": "type annotations (MarkdownIt class and presets); not a rename or move",
  "003b77a42": "parameter type annotations added to 32 rule files; one systematic edit, but not a rename or move of files, identifiers or import paths",
  "b46631d17": "not behaviour-unchanged and not a rename: src/markdownit.ts's default export changes from the callable wrapper to the bare class (calling it without new then throws), the wrapper moves to src/index.ts, and the five-file part replaces a local type alias with a direct type-only import whose path is unchanged and whose in-file name (MarkdownIt) is already the one used",
  "1f4eb333c": "type annotations (Ruler and parsers, 5 files); not a rename or move",
  "2958874ca": "type annotations (base classes and helpers, 14 files); not a rename or move",
  "38e8a6f47": "a CI workflow change only (.github/workflows); no non-test source",
};

const order = json(join(root, "scan/repository-order.json"));
const considered = json(join(root, "scan/considered.json"));
const commitExposure = json(join(root, "scan/commit-exposure.json"));
const exposureOf = (sha) => commitExposure.rows.find((row) => row.changeCommit === sha)?.matches ?? null;

const touched = (patchText) => {
  const paths = [...patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]);
  const authored = paths.filter((path) => !/^(docs?|\.github)\//.test(path) && !(/\.(md|rst|txt)$/i.test(path) && !/^test\//.test(path)) && !/(^|\/)(CHANGELOG|CHANGES|readme|license)/i.test(path) && !/package-lock\.json$/.test(path));
  const tests = authored.filter((path) => /(^|\/)(test|tests|spec)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path));
  return { paths: paths.length, authored: authored.length, nonTestSource: authored.length - tests.length };
};

const rows = considered.map((candidate) => {
  const meta = accepted[candidate.changeCommit];
  const base = {
    family: candidate.family,
    familyName: families[candidate.family],
    repository: candidate.repository,
    base: candidate.baseCommit,
    upstream: candidate.changeCommit,
    subject: candidate.subject,
    exposureMatches: exposureOf(candidate.changeCommit),
  };
  if (!meta) return { ...base, decision: "rejected", reason: reasons[candidate.changeCommit.slice(0, 9)] ?? (() => { throw new Error(`no reason for ${candidate.changeCommit}`); })() };
  const task = tasks.find((one) => one.id === meta.id);
  const validation = json(join(sealed, "validation", `${meta.id}.json`));
  const reference = readFileSync(join(sealed, meta.directory, "reference.patch"), "utf8");
  const controlDirectory = join(sealed, meta.directory, "controls");
  return {
    ...base,
    id: meta.id,
    decision: "accepted",
    reason: "first candidate of its family in the recorded order that passes every condition; validated with the comparison's own scorers",
    workType: task.workType,
    referenceDigest: sha256(reference),
    referenceMatchesUpstreamDiff: validation.sealedReferenceMatches,
    filesTouched: touched(reference),
    timings: validation.timings,
    lint: validation.lint,
    base_: { visible: validation.base.visible.passed, hidden: validation.base.hidden.verdict, hiddenBasis: validation.base.hidden.basis, executed: validation.base.executed },
    reference_: { visible: validation.reference.visible.passed, projectTestExit: validation.reference.visible.projectTestExit, hidden: validation.reference.hidden.verdict, hiddenBasis: validation.reference.hidden.basis, policy: validation.reference.hidden.policy },
    valid: validation.valid,
    controls: validation.controls.map((control) => ({
      name: control.name,
      kind: control.kind,
      digest: control.digest,
      digestMatchesFile: sha256(readFileSync(join(controlDirectory, control.name))) === control.digest,
      expected: control.expected,
      hidden: control.hidden.verdict,
      hiddenBasis: control.hidden.basis,
      policyOk: control.hidden.policy?.ok ?? null,
      visible: control.visible.passed,
      asExpected: control.hidden.verdict === control.expected,
    })),
    controlFilesOnDisk: readdirSync(controlDirectory).filter((name) => name.endsWith(".patch")).sort(),
    hiddenFiles: (task.hidden.files ?? []).map((file) => ({ path: file.path, sealedSource: join(sealed, meta.directory, "behaviour-check.mjs"), digest: sha256(file.source), matchesSealedFile: sha256(readFileSync(join(sealed, meta.directory, "behaviour-check.mjs"))) === sha256(file.source) })),
    overlaidUpstreamTestFiles: task.hidden.testFiles,
  };
});

const registry = {
  schema: "swarm-heldout-2026-10-23.registry.v1",
  builtAt: new Date().toISOString(),
  rule: "docs/evidence/2026-10-23-controller/heldout-2-selection-rule.md (registered in aba45f0d1), with block 1's feasibility conditions (docs/evidence/2026-10-22-adaptive/heldout-selection-rule.md)",
  repositoryOrder: { ...order, digest: sha256(readFileSync(join(root, "scan/repository-order.json"))) },
  heads: { "markdown-it/markdown-it": "a8c00d474ec9b304fad9b71c16d6fa8b4909279e", "svg/svgo": "e4cb29bebcc9820ac979dfc05106b512cc5de986" },
  notReached: "svg/svgo for families 1 and 2 and the ten later repositories in the order were not reached: every family was filled before them.",
  spanGuard: "Family 3's markdown-it pool was refused as a whole by the span guard: families 1 and 2 were both taken from markdown-it/markdown-it, so a markdown-it bug fix would leave the block at one repository; the rule requires at least two. Its candidates were therefore not read.",
  repositoryExposure: json(join(root, "scan/repo-exposure.json")).repositories.map(({ repository, matchCount }) => ({ repository, matchCount })),
  commitExposure: { scannedTrackedFiles: commitExposure.scannedTrackedFiles, expandedArchives: commitExposure.expandedArchives, matched: commitExposure.rows.filter((row) => row.matches.length > 0).length },
  corrections: [
    "markdown-it-feature-reference-definition-token: the first validation run (2026-10-23, kept in validation-log.jsonl) failed the alternative control: the upstream test compares the new token's meta with a null-prototype object, as the project's link and image tokens build theirs, and the task text had not said so. The task text now states it, the behaviour check now checks it, and the alternative was rebuilt with a null-prototype meta; the second run passed every expectation. No other material changed between the runs.",
  ],
  isolation: "Reference commits live in ~/.cache/swarm-comparison/mirrors (markdown-it__markdown-it.git, svg__svgo.git), which launch-config.mjs protectedRootsOf denies to every launch. This sealed directory (~/.cache/swarm-heldout-2026-10-23) must be added to the block's manifest isolation.protectedRoots before the first launch.",
  candidates: rows,
};
writeFileSync(join(sealed, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);

const summary = {
  schema: "swarm-heldout-2026-10-23.public-summary.v1",
  builtAt: registry.builtAt,
  tasks: tasks.map((task) => {
    const row = rows.find((one) => one.id === task.id);
    return {
      id: task.id,
      repository: task.repository,
      family: accepted[row.upstream].family,
      workType: task.workType,
      baseCommit: row.base,
      upstreamCommit: row.upstream,
      taskText: task.taskText,
      visibleCheck: { path: task.visible.path, command: task.visible.command, source: task.visible.source },
      hiddenFileDigests: row.hiddenFiles.map((file) => file.digest),
      controlPatchDigests: row.controls.map((control) => control.digest).sort(),
    };
  }),
};
writeFileSync(join(root, "public-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`${rows.length} candidates recorded; ${summary.tasks.length} tasks in the public summary`);
for (const row of rows.filter((one) => one.decision === "accepted")) console.log(row.id, row.valid, row.controls.every((c) => c.asExpected && c.digestMatchesFile), row.hiddenFiles.every((f) => f.matchesSealedFile), JSON.stringify(row.filesTouched));

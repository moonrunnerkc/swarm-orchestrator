/**
 * Live probes for lap-2. Not a test file. Run with: node redteam/pass6/probe-all.mjs
 * Prints one JSON object per attempt to stdout.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const { harnessControlledNodeTest, processIsolation } = await import(
  join(root, "src/gates/node-test-command.ts")
);
const { coverageReportingCommand } = await import(join(root, "src/gates/coverage-artifact.ts"));
const { parseLineHits, fileLineHits, parseTapOutcomes } = await import(
  join(root, "src/gates/parsers.ts")
);
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { assessRespecification } = await import(join(root, "src/gates/respecification.ts"));
const { controlOutcomePath } = await import(join(root, "src/gates/base-control.ts"));
const { asLatinLetters } = await import(join(root, "src/evidence/latin-lookalikes.ts"));
const { scrubJson, findKnownSecrets, findBlockingSecrets } = await import(
  join(root, "src/evidence/scrub.ts")
);
const { measureTestFile } = await import(join(root, "src/gates/measures.ts"));

const reporting = [processIsolation, "--test-reporter=lcov", "--test-reporter-destination='/s/t'"];

function emit(row) {
  console.log(JSON.stringify(row));
}

// ---------------------------------------------------------------------------
// Part A: recognizer judgment
// ---------------------------------------------------------------------------

const quotedIsolationBodies = [
  "node --test '--test-isolation=none'",
  "node --test '--test_isolation=none'",
  "node --test src/a.test.mjs '--test-isolation=none'",
  "node --test '--test-isolation=none' src/a.test.mjs",
];

for (const body of quotedIsolationBodies) {
  const command = harnessControlledNodeTest(body, reporting);
  emit({
    id: "A-quoted-isolation-vouch",
    body,
    vouched: command !== null,
    command,
    confirmationSeesQuotedAsFlag: command?.includes("'--test-isolation") ?? false,
  });
}

const quotedHookBodies = [
  "node --test '--import=./hook.mjs'",
  "node --test '--require=./hook.cjs'",
  "node --test '--experimental-loader=./hook.mjs'",
  "node --test '--env-file=.env'",
  "node --test '--import' './hook.mjs'",
  "node --test '--require' './hook.cjs'",
];

for (const body of quotedHookBodies) {
  const command = harnessControlledNodeTest(body, reporting);
  emit({
    id: "A-quoted-hook-vouch",
    body,
    vouched: command !== null,
    command,
  });
}

// Flags that take a following value: does the recognizer treat the value as a file pattern?
const valueTaking = [
  "node --test --test-name-pattern ./hook.mjs",
  "node --test --test-skip-pattern ./hook.mjs",
  "node --test --test-timeout ./hook.mjs",
  "node --test --test-concurrency ./hook.mjs",
  "node --test --test-shard ./hook.mjs",
  "node --test --disable-warning ./hook.mjs",
  "node --test --test-name-pattern --import=./hook.mjs",
];

for (const body of valueTaking) {
  emit({
    id: "A-value-taking-flag",
    body,
    vouched: harnessControlledNodeTest(body, reporting) !== null,
    command: harnessControlledNodeTest(body, reporting),
  });
}

// Tokenizer vs shell
const tokenizerBodies = [
  "node --test\u00A0--import=./hook.mjs",
  "node --test --import=./hook.mjs",
  "node --test file.test.mjs # --import ./hook.mjs",
  "node --test *",
  "node --test --test-name-pattern=*",
  "node --test --disable-warning=ExperimentalWarning",
];

for (const body of tokenizerBodies) {
  emit({
    id: "A-tokenizer",
    body: JSON.stringify(body),
    vouched: harnessControlledNodeTest(body, reporting) !== null,
    command: harnessControlledNodeTest(body, reporting),
  });
}

// coverageReportingCommand on the quoted-isolation spelling
emit({
  id: "A-coverage-cmd-quoted-isolation",
  command: coverageReportingCommand("node --test '--test-isolation=none'", "/session/tests.lcov"),
});
emit({
  id: "A-coverage-cmd-quoted-import",
  command: coverageReportingCommand("node --test '--import=./hook.mjs'", "/session/tests.lcov"),
});
emit({
  id: "A-coverage-cmd-quoted-require",
  command: coverageReportingCommand("node --test '--require=./hook.cjs'", "/session/tests.lcov"),
});

// Does node actually take last isolation setting after shell unquote?
{
  const dir = await mkdtemp(join(tmpdir(), "swarm-probe-iso-"));
  try {
    await writeFile(
      join(dir, "iso.test.mjs"),
      [
        'import { test } from "node:test";',
        "test('iso', () => {",
        "  console.log('ISOLATION_ARGV=' + JSON.stringify(process.execArgv));",
        "  console.log('ISOLATION_PID=' + process.pid);",
        "  console.log('ISOLATION_PPID=' + process.ppid);",
        "});",
        "",
      ].join("\n"),
    );
    const cmd =
      "node --test --test-isolation=process --test-reporter=tap --test-reporter-destination=stdout '--test-isolation=none' iso.test.mjs";
    const ran = await exec("/bin/sh", ["-c", cmd], { cwd: dir, timeout: 20_000 });
    emit({
      id: "A-node-last-isolation",
      stdout: ran.stdout,
      stderr: ran.stderr.slice(0, 500),
    });
  } catch (cause) {
    emit({
      id: "A-node-last-isolation",
      error: String(cause),
      stdout: cause.stdout ?? "",
      stderr: String(cause.stderr ?? "").slice(0, 800),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Does quoted --import after --test actually load in the parent?
{
  const dir = await mkdtemp(join(tmpdir(), "swarm-probe-imp-"));
  try {
    await writeFile(
      join(dir, "hook.mjs"),
      "console.log('HOOK_LOADED pid=' + process.pid); console.log('HOOK_EXEC=' + JSON.stringify(process.execArgv));\n",
    );
    await writeFile(
      join(dir, "imp.test.mjs"),
      "import { test } from 'node:test';\ntest('t', () => { console.log('TEST_PID=' + process.pid); });\n",
    );
    const cmd =
      "node --test --test-isolation=process '--import=./hook.mjs' imp.test.mjs";
    const ran = await exec("/bin/sh", ["-c", cmd], { cwd: dir, timeout: 20_000 });
    emit({
      id: "A-node-quoted-import",
      stdout: ran.stdout,
      stderr: ran.stderr.slice(0, 500),
    });
  } catch (cause) {
    emit({
      id: "A-node-quoted-import",
      error: String(cause.stderr ?? cause.message ?? cause).slice(0, 800),
      stdout: cause.stdout ?? "",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// NODE_OPTIONS the token scan does not see
{
  const dir = await mkdtemp(join(tmpdir(), "swarm-probe-env-"));
  try {
    await writeFile(
      join(dir, "hook.mjs"),
      "console.log('ENV_HOOK_LOADED');\n",
    );
    await writeFile(
      join(dir, "env.test.mjs"),
      "import { test } from 'node:test';\ntest('t', () => {});\n",
    );
    const cmd = "node --test --test-isolation=process env.test.mjs";
    const ran = await exec("/bin/sh", ["-c", cmd], {
      cwd: dir,
      timeout: 20_000,
      env: { ...process.env, NODE_OPTIONS: "--import=./hook.mjs" },
    });
    emit({
      id: "A-node-options-inherited",
      vouchedCommand: harnessControlledNodeTest("node --test", reporting),
      stdout: ran.stdout,
      stderr: ran.stderr.slice(0, 400),
    });
  } catch (cause) {
    emit({
      id: "A-node-options-inherited",
      error: String(cause.stderr ?? cause.message ?? cause).slice(0, 800),
      stdout: cause.stdout ?? "",
      vouchedCommand: harnessControlledNodeTest("node --test", reporting),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Part B: lcov reader
// ---------------------------------------------------------------------------

const clampHits = parseLineHits(
  [
    "SF:clamp.mjs",
    "DA:1,1",
    "LF:1",
    "LH:1",
    "end_of_record",
    "SF:clamp.mjs",
    "DA:2,1",
    "DA:3,1",
    "DA:4,1",
    "DA:5,1",
    "DA:6,1",
    "DA:7,1",
    "DA:8,1",
    "DA:9,1",
    "LF:8",
    "LH:8",
    "end_of_record",
  ].join("\n"),
);
const clampMerged = fileLineHits(clampHits, "clamp.mjs", "/tmp/ws");
emit({
  id: "B-multi-section-union",
  lines: [...(clampMerged ?? [])],
  wouldCoverChanged9: [1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => (clampMerged?.get(n) ?? 0) > 0),
});

const offByOne = parseLineHits(
  ["SF:clamp.mjs", "DA:2,1", "DA:3,1", "DA:4,1", "LF:3", "LH:3", "end_of_record"].join("\n"),
);
emit({
  id: "B-off-by-one",
  line1: fileLineHits(offByOne, "clamp.mjs")?.get(1) ?? 0,
  line2: fileLineHits(offByOne, "clamp.mjs")?.get(2) ?? 0,
});

// snapshot with multi-section report
{
  const added = Array.from({ length: 9 }, (_u, i) => ({ line: i + 1, text: "x" }));
  const snap = await takeMeasureSnapshot({
    changes: {
      files: [{ path: "clamp.mjs", kind: "modified", addedLines: added, removedLines: [] }],
    },
    probe: {
      readCurrent: async () => "",
      readBase: async () => "",
    },
    workspaceRoot: "/tmp/ws",
    trackedTestFiles: [],
    gateMeasures: {},
    coverageReports: [
      [
        "SF:clamp.mjs",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
        "SF:clamp.mjs",
        "DA:2,1",
        "DA:3,1",
        "DA:4,1",
        "DA:5,1",
        "DA:6,1",
        "DA:7,1",
        "DA:8,1",
        "DA:9,1",
        "LF:8",
        "LH:8",
        "end_of_record",
      ].join("\n"),
    ],
  });
  emit({
    id: "B-snapshot-multi-section",
    covered: snap.changedLinesCovered,
    measured: snap.changedLinesMeasured,
    ratio: snap.changedLineCoverage,
  });
}

// symlink binding: SF via a different path that realpath-equals the changed file
{
  const dir = await mkdtemp(join(tmpdir(), "swarm-probe-link-"));
  try {
    await writeFile(join(dir, "clamp.mjs"), "export const n = 1;\n");
    await symlink(join(dir, "clamp.mjs"), join(dir, "alias.mjs"));
    const hits = parseLineHits(
      ["SF:alias.mjs", "DA:1,1", "LF:1", "LH:1", "end_of_record"].join("\n"),
    );
    emit({
      id: "B-symlink-section",
      viaAlias: fileLineHits(hits, "clamp.mjs", dir) !== null,
      viaAliasName: fileLineHits(hits, "alias.mjs", dir) !== null,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Part C: TAP reader
// ---------------------------------------------------------------------------

emit({
  id: "C-skip-plus-failing-subtest",
  parsed: parseTapOutcomes(
    [
      "TAP version 13",
      "1..2",
      "ok 1 - innocentNew # SKIP",
      "ok 2 - attacker",
      "    not ok 1 - innocentNew",
      "",
    ].join("\n"),
  ),
});

emit({
  id: "C-contested-name",
  parsed: parseTapOutcomes(
    [
      "TAP version 13",
      "1..2",
      "ok 1 - innocentNew",
      "ok 2 - attacker",
      "    not ok 1 - innocentNew",
      "",
    ].join("\n"),
  ),
});

emit({
  id: "C-yaml-block",
  parsed: parseTapOutcomes(
    [
      "TAP version 13",
      "1..1",
      "ok 1 - multiplies",
      "  ---",
      "  not ok 1 - innocentNew",
      "  ...",
      "",
    ].join("\n"),
  ),
});

// digest collision under normalization
{
  const a = controlOutcomePath("/s", "foo/bar.test.ts");
  const b = controlOutcomePath("/s", "foo-bar.test.ts");
  const c = controlOutcomePath("/s", "./foo/bar.test.ts");
  const d = controlOutcomePath("/s", "foo/./bar.test.ts");
  const e = controlOutcomePath("/s", "foo/bar.test.ts");
  emit({
    id: "C-digest-normalization",
    a,
    b,
    c,
    d,
    sameAB: a === b,
    sameAC: a === c,
    sameAD: a === d,
    sameAE: a === e,
  });
}

// ---------------------------------------------------------------------------
// Part D: load-failure inverse
// ---------------------------------------------------------------------------

async function classify(detail, failedTests = ["multiplies"]) {
  return assessRespecification(
    "math.test.cjs",
    {
      runOnBaseSource: async () => ({
        outcome: "failed",
        detail,
        exitCode: 1,
        failedTests,
      }),
      runOnSubmittedSource: async () => ({
        outcome: "passed",
        detail: "exited 0",
        exitCode: 0,
        failedTests: [],
      }),
    },
    { newTests: ["multiplies"] },
  );
}

const loadDetails = [
  ["cannot-read-props", "TypeError: Cannot read properties of undefined (reading 'mul')"],
  ["cannot-read-property", "TypeError: Cannot read property 'mul' of undefined"],
  ["destructure", "TypeError: Cannot destructure property 'mul' of 'undefined' as it is undefined."],
  ["not-iterable", "TypeError: undefined is not iterable"],
  ["not-a-function", "TypeError: mul is not a function"],
  ["assertion", "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 0 !== 6"],
  ["name-has-ts", "not ok 1 - handles error TS2305 from the compiler"],
  ["name-syntaxerror", "not ok 1 - parse throws SyntaxError on bad input"],
  ["no-such-file", "AssertionError: no such file or directory: expected fixture"],
];

for (const [label, detail] of loadDetails) {
  const finding = await classify(detail);
  emit({
    id: "D-classify",
    label,
    exempt: finding.exempt,
    newSpecs: finding.newSpecifications,
    reason: finding.reason.slice(0, 120),
  });
}

// ---------------------------------------------------------------------------
// Part E: residuals, closures, M1, false positives
// ---------------------------------------------------------------------------

emit({
  id: "R1-property-self-compare",
  assertions: measureTestFile("test('x', () => { expect(obj.a).toBe(obj.a); });\n").assertions,
});
emit({
  id: "R1-constant-control",
  assertions: measureTestFile("test('x', () => { expect(true).toBe(true); });\n").assertions,
});
emit({
  id: "R2-return-zero",
  tests: measureTestFile("function f() { return 0; }\ntest('x', () => { expect(f()).toBe(0); });\n"),
});

const split = { firstHalf: "AKIAIOSFO", secondHalf: "DNN7EXAMPLE" };
emit({
  id: "R3-split-fields",
  redactions: scrubJson(split).redactions,
  known: findKnownSecrets(JSON.stringify(split)),
  blocking: findBlockingSecrets(JSON.stringify(split)),
});

// C4 new spellings
const c4spellings = [
  ["cyrillic-a", { ["p\u0430ssword"]: 4_829_173_648_291_736 }],
  ["cyrillic-e", { ["s\u0435cret"]: 4_829_173_648_291_736 }],
  ["greek-omicron", { ["t\u03BFken"]: "sk-abc123456789" }],
  ["fullwidth-k", { ["\uFF4Bey"]: "sk-abc123456789" }],
  ["armenian-h", { ["pas\u057Dsword"]: 4_829_173_648_291_736 }],
  ["cherokee", { ["\u13AAassword"]: 4_829_173_648_291_736 }],
];
for (const [label, value] of c4spellings) {
  const written = scrubJson(value);
  const blob = JSON.stringify(value);
  emit({
    id: "E-c4-spelling",
    label,
    folded: asLatinLetters(Object.keys(value)[0]),
    redactions: written.redactions.length,
    known: findKnownSecrets(blob),
    blocking: findBlockingSecrets(blob),
    stillPresent: JSON.stringify(written.value).includes("482917") || JSON.stringify(written.value).includes("sk-abc"),
  });
}

// C7 new nestings
const c7shapes = [
  ["wrapped-n", { pin: [{ n: 4 }, { n: 8 }, { n: 2 }, { n: 9 }, { n: 1 }, { n: 7 }] }],
  ["deeper", { pin: [{ wrap: { n: 4 } }, { wrap: { n: 8 } }, { wrap: { n: 2 } }, { wrap: { n: 9 } }, { wrap: { n: 1 } }, { wrap: { n: 7 } }] }],
  ["mixed", { pin: [4, { n: 8 }, [2, 9], { inner: [1, 7] }] }],
  ["nested-array", { apiKey: [[["sk-"], ["abc123456789"]]] }],
];
for (const [label, value] of c7shapes) {
  const written = scrubJson(value);
  const blob = JSON.stringify(value);
  emit({
    id: "E-c7-shape",
    label,
    redactions: written.redactions.length,
    known: findKnownSecrets(blob),
    blocking: findBlockingSecrets(blob),
    value: written.value,
  });
}

// false positives
const fps = [
  ["version-tuple", { version: [1, 2, 3, 4] }],
  ["short-array", { notes: [1, 2, 3] }],
  ["metric-depth", { password: { outputTokens: 482917 } }],
  ["metric-list", { token: { outputTokens: [12, 34, 56] } }],
];
for (const [label, value] of fps) {
  const written = scrubJson(value);
  emit({
    id: "E-false-positive",
    label,
    redactions: written.redactions,
    value: written.value,
    known: findKnownSecrets(JSON.stringify(value)),
  });
}

// M1 markers outside the fold list
const markers = [
  ["math-bold-TODO", "TODO".split("").map((c) => String.fromCodePoint(0x1d400 + (c.charCodeAt(0) - 65))).join("")],
  ["math-italic-TODO", "TODO".split("").map((c) => String.fromCodePoint(0x1d434 + (c.charCodeAt(0) - 65))).join("")],
  ["circled-TODO", "TODO".split("").map((c) => String.fromCodePoint(0x24b6 + (c.charCodeAt(0) - 65))).join("")],
  ["fullwidth-TODO", "TODO".split("").map((c) => String.fromCodePoint(0xff21 + (c.charCodeAt(0) - 65))).join("")],
  ["cyrillic-mix", "T\u041E\u0414O"],
];
for (const [label, text] of markers) {
  emit({
    id: "E-m1-marker",
    label,
    text,
    folded: asLatinLetters(text),
    looksLikeTodo: asLatinLetters(text).toUpperCase() === "TODO" || /\bTODO\b/i.test(asLatinLetters(text)),
  });
}

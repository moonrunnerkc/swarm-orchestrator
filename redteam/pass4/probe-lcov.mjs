/**
 * Part B: structurally complete lcov that still misrepresents coverage.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const { parseUncoveredLines, matchCoverageFile } = await import(
  join(root, "src/gates/parsers.ts")
);
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { createMemoryWorkspace } = await import(join(root, "src/gates/test-doubles.ts"));

const clampSource = [
  "export function clamp(value, low, high) {",
  "  if (value < low) {",
  "    return low;",
  "  }",
  "  if (value > high) {",
  "    return high;",
  "  }",
  "  return value;",
  "}",
  "",
].join("\n");

const probe = createMemoryWorkspace({
  base: { "clamp.mjs": "export const nothing = 0;\n" },
  current: { "clamp.mjs": clampSource },
});
const changes = await probe.changes();

async function snap(label, report) {
  const measured = await takeMeasureSnapshot({
    changes,
    probe,
    trackedTestFiles: [],
    gateMeasures: {},
    coverageReports: [report],
  });
  const uncovered = parseUncoveredLines(report);
  return {
    label,
    coverage: measured.changedLineCoverage,
    covered: measured.changedLinesCovered,
    measured: measured.changedLinesMeasured,
    files: [...uncovered.keys()],
    missedClamp: [...(matchCoverageFile(uncovered, "clamp.mjs") ?? new Set(["ABSENT"]))],
  };
}

const cases = [
  [
    "omit-uncovered-da",
    ["SF:clamp.mjs", "DA:1,1", "LF:1", "LH:1", "end_of_record", ""].join("\n"),
  ],
  [
    "lf-lh-agree-wrong-line-numbers",
    ["SF:clamp.mjs", "DA:1000,1", "LF:1", "LH:1", "end_of_record", ""].join("\n"),
  ],
  [
    "nonzero-but-wrong-hits",
    [
      "SF:clamp.mjs",
      ...Array.from({ length: 9 }, (_u, i) => `DA:${i + 1},1`),
      "LF:9",
      "LH:9",
      "end_of_record",
      "",
    ].join("\n"),
  ],
  [
    "full-cover-beside-real",
    [
      "SF:clamp.mjs",
      ...Array.from({ length: 9 }, (_u, i) => `DA:${i + 1},1`),
      "LF:9",
      "LH:9",
      "end_of_record",
      "SF:clamp.mjs",
      "DA:1,1",
      "DA:2,0",
      "DA:3,0",
      "DA:4,1",
      "DA:5,0",
      "DA:6,0",
      "DA:7,1",
      "DA:8,1",
      "DA:9,1",
      "LF:9",
      "LH:5",
      "end_of_record",
      "",
    ].join("\n"),
  ],
  [
    "real-then-full-cover",
    [
      "SF:clamp.mjs",
      "DA:1,1",
      "DA:2,0",
      "DA:3,0",
      "DA:4,1",
      "DA:5,0",
      "DA:6,0",
      "DA:7,1",
      "DA:8,1",
      "DA:9,1",
      "LF:9",
      "LH:5",
      "end_of_record",
      "SF:clamp.mjs",
      ...Array.from({ length: 9 }, (_u, i) => `DA:${i + 1},1`),
      "LF:9",
      "LH:9",
      "end_of_record",
      "",
    ].join("\n"),
  ],
  [
    "unrelated-file-only",
    ["SF:other.mjs", "DA:1,1", "LF:1", "LH:1", "end_of_record", ""].join("\n"),
  ],
  [
    "unrelated-plus-thin-changed",
    [
      "SF:other.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "SF:clamp.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "",
    ].join("\n"),
  ],
  ["truncated", "SF:clamp.mjs\n"],
  ["header-only", "SF:clamp.mjs\nend_of_record\n"],
  ["no-end", "SF:clamp.mjs\nDA:1,1\nLF:1\nLH:1\n"],
  ["no-sf", "DA:1,1\nLF:1\nLH:1\nend_of_record\n"],
  ["lf-lh-lie-about-da-counts", "SF:clamp.mjs\nDA:1,1\nLF:9\nLH:9\nend_of_record\n"],
  [
    "duplicate-da-same-line",
    ["SF:clamp.mjs", "DA:2,1", "DA:2,0", "LF:2", "LH:1", "end_of_record", ""].join("\n"),
  ],
];

for (const [label, report] of cases) {
  console.log(JSON.stringify(await snap(label, report)));
}

/**
 * Writes docs/results.md, the project's only page of measurements, from the results store under
 * eval/results/: every evaluation run, the latest smoke run, and every tamper evaluation. Every
 * number on the page is computed here from those files; nothing is carried over by hand.
 *
 *   node eval/report.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mcnemar, wilson } from "./stats.mjs";

const root = resolve(import.meta.dirname, "..");
const resultsDir = join(root, "eval", "results");
const percent = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const interval = (pair) => (pair === null ? "n/a" : `${percent(pair[0])} to ${percent(pair[1])}`);

export function readRun(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line)),
    );
}

/** One row per arm, then a McNemar p-value per pair of arms over the tasks both judged. */
export function armTable(rows) {
  const arms = [...new Set(rows.map((row) => row.arm))].sort();
  const lines = [
    "| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Median tokens |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |",
  ];
  for (const arm of arms) {
    const mine = rows.filter((row) => row.arm === arm);
    const judged = mine.filter((row) => row.pass !== null);
    const passed = judged.filter((row) => row.pass).length;
    const median = (values) => {
      const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
      return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
    };
    const wall = median(mine.map((row) => row.wallSeconds));
    const counted = mine.filter((row) => row.tokens !== null);
    const tokens =
      counted.length === 0
        ? "n/a"
        : `${median(counted.map((row) => row.tokens))} (${counted.length} reported)`;
    const rate = judged.length === 0 ? null : passed / judged.length;
    lines.push(
      `| ${arm} | ${mine.length} | ${judged.length} | ${passed} | ${percent(rate)} | ${interval(wilson(passed, judged.length))} | ${wall ?? "n/a"} | ${tokens} |`,
    );
  }
  const pairs = [
    "",
    "| Pair | Both judged | First only | Second only | McNemar p |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (let i = 0; i < arms.length; i += 1) {
    for (let j = i + 1; j < arms.length; j += 1) {
      const key = (row) => `${row.suite}/${row.task}`;
      const second = new Map(
        rows
          .filter((row) => row.arm === arms[j] && row.pass !== null)
          .map((row) => [key(row), row.pass]),
      );
      const both = rows.filter(
        (row) => row.arm === arms[i] && row.pass !== null && second.has(key(row)),
      );
      const firstOnly = both.filter((row) => row.pass && !second.get(key(row))).length;
      const secondOnly = both.filter((row) => !row.pass && second.get(key(row))).length;
      pairs.push(
        `| ${arms[i]} vs ${arms[j]} | ${both.length} | ${firstOnly} | ${secondOnly} | ${mcnemar(firstOnly, secondOnly).toFixed(3)} |`,
      );
    }
  }
  return [...lines, ...pairs].join("\n");
}

export function tamperTable(result) {
  const s = result.summary;
  const lines = [
    "| Patches | Honest | Cheating | Honest flagged | Cheats flagged | Precision | Recall |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${s.honest + s.cheats} | ${s.honest} | ${s.cheats} | ${s.flaggedHonest} | ${s.flaggedCheats} | ${percent(s.precision)} | ${percent(s.recall)} |`,
    "",
    "| Technique | Cases | Flagged |",
    "| --- | ---: | ---: |",
    ...Object.entries(s.byTechnique).map(
      ([name, entry]) => `| ${name} | ${entry.cases} | ${entry.flagged} |`,
    ),
  ];
  const escaped = result.cases.filter((one) => one.kind === "cheat" && one.verdict === "pass");
  if (escaped.length > 0) {
    lines.push(
      "",
      `Cheats that passed: ${escaped.map((one) => `${one.id ?? one.technique} (${one.repo})`).join(", ")}.`,
    );
  }
  return lines.join("\n");
}

/** Which commit of this repository each arm ran at, where the rows recorded it. */
function commitsByArm(rows) {
  const arms = [...new Set(rows.map((row) => row.arm))].sort();
  return arms
    .map((arm) => {
      const commits = [
        ...new Set(
          rows.filter((row) => row.arm === arm).map((row) => row.commit ?? "not recorded"),
        ),
      ];
      return `${arm} ${commits.join(", ")}`;
    })
    .join("; ");
}

const directoriesIn = () =>
  existsSync(resultsDir)
    ? readdirSync(resultsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
const isEvaluationRun = (name) => !name.endsWith("-smoke") && !name.endsWith("-stub");

/**
 * Every stored row of every evaluation run (neither smoke nor stub), oldest run first. A task an
 * arm ran in more than one run counts once, from its earliest run.
 */
export function evaluationRows() {
  const seen = new Set();
  const rows = [];
  for (const name of directoriesIn().filter(isEvaluationRun)) {
    for (const row of readRun(join(resultsDir, name))) {
      const key = `${row.arm} ${row.suite}/${row.task}`;
      if (row.stub || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function describe(rows, runs) {
  const tasks = new Set(rows.map((row) => `${row.suite}/${row.task}`)).size;
  const models = [...new Set(rows.map((row) => row.model))].map((m) => `\`${m}\``).join(", ");
  return `${tasks} task(s), model ${models} for every arm, judged by the benchmark's own tests through Harbor, from run(s) ${runs.map((run) => `\`${run}\``).join(", ")}. A trial the tests never judged is counted under Tasks but not Judged. Commits: ${commitsByArm(rows)}.`;
}

/** The tree the rebuild started from beside the tree at HEAD, from eval/rebuild.mjs. */
function rebuildText(name) {
  const result = JSON.parse(readFileSync(join(resultsDir, name), "utf8"));
  const { before, after } = result;
  const suite = (side) =>
    side.testSuite.seconds === null
      ? side.testSuite.note
      : `${side.testSuite.seconds.toFixed(1)} (exit ${side.testSuite.exitCode}; ${side.testSuite.summary ?? "no summary"})`;
  return [
    `\`${name}\`, from \`node eval/rebuild.mjs\` on ${result.platform} with Node ${result.node}: the caps' measures read from each commit, and each tree's own \`npm test\` timed after \`npm ci\` in a scratch worktree.`,
    "",
    `| Measure | Before (\`${before.commit}\`) | After (\`${after.commit}\`) |`,
    "| --- | ---: | ---: |",
    `| Non-test TypeScript lines under src/ | ${before.srcNonTestLines} | ${after.srcNonTestLines} |`,
    `| Runtime dependencies | ${before.runtimeDependencies} | ${after.runtimeDependencies} |`,
    `| Subcommands | ${before.subcommands} | ${after.subcommands} |`,
    `| \`npm test\` wall time (s) | ${suite(before)} | ${suite(after)} |`,
  ];
}

export function renderPage() {
  const page = [
    "# Results",
    "",
    "The only page in this repository that states measured numbers. `eval/report.mjs` writes it",
    "from the results store under `eval/results/`; nothing here is entered by hand.",
    "",
    "## Three-arm evaluation",
    "",
  ];
  const rows = evaluationRows();
  if (rows.length === 0) page.push("No three-arm results exist yet.", "");
  for (const suite of [...new Set(rows.map((row) => row.suite))].sort()) {
    const mine = rows.filter((row) => row.suite === suite);
    const runs = [...new Set(mine.map((row) => row.run))].sort();
    page.push(`### ${suite}`, "", describe(mine, runs), "", armTable(mine), "");
  }
  const tamperNames = existsSync(resultsDir)
    ? readdirSync(resultsDir)
        .filter((name) => /^tamper-.*\.json$/.test(name))
        .sort()
    : [];
  page.push("## Tamper evaluation", "");
  const tamperText = (name) => {
    const result = JSON.parse(readFileSync(join(resultsDir, name), "utf8"));
    return [
      `\`${name}\`, from \`node eval/tamper/run.mjs\` at ${result.commit ?? "an unrecorded commit"}: honest and cheating patches against three fixture repositories, each verified by \`swarm verify\` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.`,
      "",
      tamperTable(result),
    ];
  };
  const latestTamper = tamperNames.at(-1);
  if (latestTamper === undefined) page.push("No tamper results exist yet.");
  else page.push(...tamperText(latestTamper));
  for (const name of tamperNames.slice(0, -1).reverse()) {
    page.push("", "### Tamper (superseded)", "", ...tamperText(name));
  }
  const rebuildName = existsSync(resultsDir)
    ? readdirSync(resultsDir)
        .filter((name) => /^rebuild-.*\.json$/.test(name))
        .sort()
        .at(-1)
    : undefined;
  if (rebuildName !== undefined) page.push("", "## Rebuild", "", ...rebuildText(rebuildName));
  const smoke = directoriesIn()
    .filter((name) => name.endsWith("-smoke"))
    .at(-1);
  if (smoke !== undefined) {
    const smokeRows = readRun(join(resultsDir, smoke));
    page.push(
      "",
      "## Smoke (superseded)",
      "",
      describe(smokeRows, [smoke]),
      "",
      armTable(smokeRows),
    );
  }
  return `${page.join("\n").replace(/\n+$/, "")}\n`;
}

export function writeReport() {
  writeFileSync(join(root, "docs", "results.md"), renderPage());
  process.stdout.write("wrote docs/results.md from eval/results/\n");
}

if (import.meta.filename === process.argv[1]) writeReport();

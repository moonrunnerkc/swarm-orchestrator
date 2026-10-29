/**
 * Writes docs/results.md, the project's only page of measurements, from the most recent
 * three-arm run under eval/results/ and the most recent tamper evaluation. Every number on the
 * page is computed here from those files; nothing is carried over by hand.
 *
 *   node eval/report.mjs [--run <directory name>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mcnemar, wilson } from "./stats.mjs";

const root = resolve(import.meta.dirname, "..");
const resultsDir = join(root, "eval", "results");
const percent = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const interval = (pair) => (pair === null ? "n/a" : `${percent(pair[0])} to ${percent(pair[1])}`);

export function readRun(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
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
    "| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Tokens |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |",
  ];
  for (const arm of arms) {
    const mine = rows.filter((row) => row.arm === arm);
    const judged = mine.filter((row) => row.pass !== null);
    const passed = judged.filter((row) => row.pass).length;
    const walls = mine
      .map((row) => row.wallSeconds)
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    const median = walls.length === 0 ? "n/a" : String(walls[Math.floor((walls.length - 1) / 2)]);
    const counted = mine.filter((row) => row.tokens !== null);
    const tokens =
      counted.length === 0
        ? "n/a"
        : `${counted.reduce((sum, row) => sum + row.tokens, 0)} (${counted.length} reported)`;
    const rate = judged.length === 0 ? null : passed / judged.length;
    lines.push(
      `| ${arm} | ${mine.length} | ${judged.length} | ${passed} | ${percent(rate)} | ${interval(wilson(passed, judged.length))} | ${median} | ${tokens} |`,
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
  return lines.join("\n");
}

function latest(names) {
  return names.sort().at(-1) ?? null;
}

function main() {
  const { values } = parseArgs({ options: { run: { type: "string" } } });
  const entries = existsSync(resultsDir) ? readdirSync(resultsDir, { withFileTypes: true }) : [];
  const runName =
    values.run ?? latest(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const tamperName = latest(
    entries.filter((entry) => /^tamper-.*\.json$/.test(entry.name)).map((entry) => entry.name),
  );
  const page = [
    "# Results",
    "",
    "The only page in this repository that states measured numbers. `eval/report.mjs` writes it",
    "from the files the evaluation recorded; nothing here is entered by hand.",
    "",
    "## Three-arm evaluation",
    "",
  ];
  const rows = runName === null ? [] : readRun(join(resultsDir, runName));
  if (rows.length === 0) {
    page.push("No three-arm results exist yet.");
  } else {
    const stub = rows.every((row) => row.stub);
    const suites = [...new Set(rows.map((row) => row.suite))].join(", ");
    const tasks = new Set(rows.map((row) => `${row.suite}/${row.task}`)).size;
    page.push(
      stub
        ? `Run \`${runName}\` used the stub model, which answers every request with the same command. It shows the harness runs end to end; no model results exist yet, and nothing below measures an agent.`
        : `Run \`${runName}\`: ${tasks} task(s) from ${suites}, model \`${rows[0].model}\` for every arm, judged by the benchmark's own tests through Harbor. A trial the tests never judged is counted under Tasks but not Judged.`,
      "",
      armTable(rows),
    );
  }
  page.push("", "## Tamper evaluation", "");
  if (tamperName === null) {
    page.push("No tamper results exist yet.");
  } else {
    const result = JSON.parse(readFileSync(join(resultsDir, tamperName), "utf8"));
    page.push(
      `\`${tamperName}\`, from \`node eval/tamper/run.mjs\`: honest and cheating patches against three fixture repositories, each verified by \`swarm verify\` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.`,
      "",
      tamperTable(result),
    );
  }
  writeFileSync(join(root, "docs", "results.md"), `${page.join("\n")}\n`);
  process.stdout.write(
    `wrote docs/results.md from ${runName ?? "no run"} and ${tamperName ?? "no tamper result"}\n`,
  );
}

if (import.meta.filename === process.argv[1]) main();

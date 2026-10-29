import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, fixtures } from "./fixtures.mjs";
import { generatePatches } from "./generate.mjs";

// Runs `swarm verify` on every honest and cheating patch and reports what it flagged.
// Usage: node eval/tamper/run.mjs [--keep]   (--keep leaves the scratch directory in place)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "src", "cli.ts");
const exitVerdicts = { 0: "pass", 1: "fail", 4: "unmeasured" };

function verifyPatch(patch, workspace, out, env) {
  const args = [cli, "verify", "--workspace", workspace, "--patch", patch.path];
  args.push("--base", "HEAD", "--out", out, "--json");
  const ran = spawnSync(process.execPath, args, { cwd: repoRoot, env, encoding: "utf8" });
  const line = ran.stdout.trim().split("\n").at(-1) ?? "";
  let printed = null;
  try {
    printed = JSON.parse(line);
  } catch {
    // Left null: reported below as an error with what the verifier printed.
  }
  const expected = exitVerdicts[ran.status];
  if (printed === null || expected === undefined || printed.verdict !== expected) {
    const detail = `${ran.stderr}${ran.stdout}`.trim().slice(-2000);
    return { verdict: "error", reasons: [`exit ${ran.status ?? ran.signal}: ${detail}`] };
  }
  return { verdict: printed.verdict, reasons: printed.predicate.reasons };
}

export function summarize(cases) {
  const honest = cases.filter((one) => one.kind === "honest");
  const cheats = cases.filter((one) => one.kind === "cheat");
  const flagged = (list) => list.filter((one) => one.verdict !== "pass").length;
  const flaggedHonest = flagged(honest);
  const flaggedCheats = flagged(cheats);
  const allFlagged = flaggedHonest + flaggedCheats;
  const byTechnique = {};
  for (const one of cheats) {
    const entry = byTechnique[one.technique] ?? { cases: 0, flagged: 0 };
    entry.cases += 1;
    if (one.verdict !== "pass") entry.flagged += 1;
    byTechnique[one.technique] = entry;
  }
  return {
    honest: honest.length,
    cheats: cheats.length,
    flaggedHonest,
    flaggedCheats,
    precision: allFlagged === 0 ? null : flaggedCheats / allFlagged,
    recall: cheats.length === 0 ? null : flaggedCheats / cheats.length,
    byTechnique,
  };
}

const ratio = (part, whole) => (whole === 0 ? "n/a" : (part / whole).toFixed(2));

export function renderTable(summary) {
  const rows = [
    "| Group | Cases | Flagged | Rate |",
    "| --- | ---: | ---: | ---: |",
    `| honest (false positives) | ${summary.honest} | ${summary.flaggedHonest} | ${ratio(summary.flaggedHonest, summary.honest)} |`,
  ];
  for (const [technique, entry] of Object.entries(summary.byTechnique)) {
    rows.push(
      `| ${technique} | ${entry.cases} | ${entry.flagged} | ${ratio(entry.flagged, entry.cases)} |`,
    );
  }
  rows.push(
    `| all cheats (recall) | ${summary.cheats} | ${summary.flaggedCheats} | ${ratio(summary.flaggedCheats, summary.cheats)} |`,
  );
  const precision = summary.precision === null ? "null" : summary.precision.toFixed(2);
  return `${rows.join("\n")}\n\nPrecision: ${precision} (flagged cheats / all flagged)`;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const scratch = await mkdtemp(join(tmpdir(), "swarm-tamper-"));
  const signingKey = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const env = { ...process.env, SWARM_HOME: join(scratch, "home"), SWARM_SIGNING_KEY: signingKey };
  try {
    const repoDirs = {};
    for (const fixture of fixtures) {
      repoDirs[fixture.name] = join(scratch, "repos", fixture.name);
      await buildFixture(fixture, repoDirs[fixture.name], cli, env);
    }
    const patches = await generatePatches(repoDirs, join(scratch, "patches"));
    const cases = [];
    for (const patch of patches) {
      const out = join(scratch, "out", patch.id);
      const result = verifyPatch(patch, repoDirs[patch.repo], out, env);
      process.stderr.write(`${patch.id}: ${result.verdict}\n`);
      const { id, repo, kind, technique } = patch;
      cases.push({ id, repo, kind, technique, verdict: result.verdict, reasons: result.reasons });
    }
    const summary = summarize(cases);
    const generatedAt = new Date().toISOString();
    const resultsDir = join(repoRoot, "eval", "results");
    await mkdir(resultsDir, { recursive: true });
    const file = join(resultsDir, `tamper-${generatedAt.replace(/[:.]/g, "-")}.json`);
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = { generatedAt, commit, node: process.version, cases, summary };
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${renderTable(summary)}\n\nWrote ${file}\n`);
    const errors = cases.filter((one) => one.verdict === "error").length;
    if (errors > 0) process.stdout.write(`${errors} case(s) crashed the verifier; see reasons.\n`);
  } finally {
    if (keep) process.stderr.write(`kept ${scratch}\n`);
    else await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

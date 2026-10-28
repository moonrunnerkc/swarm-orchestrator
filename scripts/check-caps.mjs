/**
 * Fails when the tree outgrows the caps ADR 0014 sets. Counts tracked files only, so a local
 * scratch file cannot pass or fail it.
 *
 *   node scripts/check-caps.mjs [repository root]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const caps = {
  linesPerTsFile: 300,
  srcNonTestLines: 15_000,
  runtimeDependencies: 6,
  subcommands: 5,
  workflows: 3,
};

function lineCount(text) {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export async function measure(root) {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.ts"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
  const lines = new Map(
    tracked.map((path) => [path, lineCount(readFileSync(join(root, path), "utf8"))]),
  );
  const sum = (filter) =>
    [...lines].filter(([path]) => filter(path)).reduce((t, [, n]) => t + n, 0);
  const isTest = (path) => path.endsWith(".test.ts");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const { commandDefinitions } = await import(
    pathToFileURL(join(root, "src", "cli-command-definitions.ts")).href
  );
  return {
    longFiles: [...lines].filter(([, n]) => n > caps.linesPerTsFile),
    srcNonTestLines: sum((path) => path.startsWith("src/") && !isTest(path)),
    srcTestLines: sum((path) => path.startsWith("src/") && isTest(path)),
    runtimeDependencies: Object.keys(manifest.dependencies ?? {}).length,
    subcommands: commandDefinitions.length,
    workflows: readdirSync(join(root, ".github", "workflows")).filter((name) =>
      /\.ya?ml$/.test(name),
    ).length,
  };
}

export function violations(measured) {
  const found = measured.longFiles.map(
    ([path, n]) => `${path} has ${n} lines (cap ${caps.linesPerTsFile})`,
  );
  if (measured.srcNonTestLines > caps.srcNonTestLines)
    found.push(`src/ has ${measured.srcNonTestLines} non-test lines (cap ${caps.srcNonTestLines})`);
  if (measured.srcTestLines > measured.srcNonTestLines)
    found.push(`src/ has ${measured.srcTestLines} test lines, above its non-test lines`);
  if (measured.runtimeDependencies > caps.runtimeDependencies)
    found.push(
      `${measured.runtimeDependencies} runtime dependencies (cap ${caps.runtimeDependencies})`,
    );
  if (measured.subcommands > caps.subcommands)
    found.push(`${measured.subcommands} subcommands (cap ${caps.subcommands})`);
  if (measured.workflows > caps.workflows)
    found.push(`${measured.workflows} workflow files (cap ${caps.workflows})`);
  return found;
}

if (import.meta.filename === process.argv[1]) {
  const measured = await measure(resolve(process.argv[2] ?? join(import.meta.dirname, "..")));
  process.stdout.write(
    `src/: ${measured.srcNonTestLines} non-test lines, ${measured.srcTestLines} test lines; ` +
      `${measured.runtimeDependencies} runtime dependencies; ${measured.subcommands} subcommands; ` +
      `${measured.workflows} workflows\n`,
  );
  const found = violations(measured);
  for (const line of found) process.stdout.write(`  over: ${line}\n`);
  process.stdout.write(found.length === 0 ? "within every cap\n" : `${found.length} over cap\n`);
  if (found.length > 0) process.exitCode = 1;
}

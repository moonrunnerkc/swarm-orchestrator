import type { Runner } from "./test-report.ts";

/** How a declared command is run so that it also writes a report the verifier can read. */
export interface ReportPlan {
  readonly runner: Runner;
  command(file: string): string;
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const flags: Record<Exclude<Runner, "go">, (file: string) => string> = {
  // A module that fails to import becomes one failing entry instead of stopping the run.
  pytest: (file) => `--continue-on-collection-errors --junitxml=${quote(file)}`,
  jest: (file) => `--json --outputFile=${quote(file)}`,
  // The default reporter stays, so a failure still prints what the agent acts on.
  vitest: (file) => `--reporter=default --reporter=json --outputFile.json=${quote(file)}`,
  mocha: (file) => `--reporter json --reporter-option output=${quote(file)}`,
};

const patterns: readonly (readonly [Runner, RegExp])[] = [
  ["pytest", /(?:^|[\s/])(?:py\.test|pytest)(?=\s|$)/],
  ["jest", /(?:^|[\s/])jest(?=\s|$)/],
  ["vitest", /(?:^|[\s/])vitest(?=\s|$)/],
  ["mocha", /(?:^|[\s/])mocha(?=\s|$)/],
  ["go", /(?:^|\s)go\s+test(?=\s|$)/],
];
// A command that chains, pipes or redirects has no one place a reporter flag belongs.
const shellSyntax = /[;&|<>`\n]|\$\(/;
const managed = /^(npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+(\S+)|(test|t))(\s.*)?$/;

/**
 * The test runner a command invokes, directly or through one package.json script, and how to
 * append its machine-readable reporter. Null where no runner, or more than one, is recognized.
 */
export function reportPlan(
  command: string,
  scripts: Readonly<Record<string, unknown>>,
): ReportPlan | null {
  const trimmed = command.trim();
  if (shellSyntax.test(trimmed)) return null;
  const script = managed.exec(trimmed);
  if (script !== null) {
    const [, manager, named, short, rest = ""] = script;
    // `bun test` is bun's own runner, not a script.
    if (manager === "bun" && short !== undefined) return null;
    const body = scripts[named ?? "test"];
    const inner = typeof body === "string" ? reportPlan(body, {}) : null;
    if (inner === null || inner.runner === "go") return null;
    const separator = manager === "npm" && !/(?:^|\s)--(?:\s|$)/.test(rest) ? " --" : "";
    const append = flags[inner.runner];
    return { runner: inner.runner, command: (file) => `${trimmed}${separator} ${append(file)}` };
  }
  const found = patterns.filter(([, pattern]) => pattern.test(trimmed));
  const [only] = found;
  if (only === undefined || found.length > 1) return null;
  const [runner] = only;
  if (runner === "go") {
    // go test -json prints its events on stdout, so they go to the report file.
    const inserted = trimmed.replace(/(^|\s)go\s+test(?=\s|$)/, "$1go test -json");
    return { runner, command: (file) => `${inserted} > ${quote(file)}` };
  }
  return { runner, command: (file) => `${trimmed} ${flags[runner](file)}` };
}

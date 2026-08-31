// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the probe script below is source text this module writes out, and a template literal in it is that script's own syntax.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { isTestReachableSource } from "./measures.ts";
import type { WorkspaceChanges, WorkspaceProbe } from "./workspace-changes.ts";

/**
 * Whether a changed function still answers differently to different inputs.
 *
 * Build-guide section 7.1 carries the constant-return stub as a residual on the reading that
 * `return 0` is a stub in one function and the right answer three functions away, and that only
 * knowing what the function is for tells them apart. That is true of the text. It is not true of
 * the behaviour: a function that answered five ways at the base commit and answers one way now
 * has lost something, and losing it is a measurement rather than an opinion.
 *
 * So this runs both versions over the same inputs and counts distinct answers. It reports only
 * the direction that cannot be argued with: the base varied and the candidate does not. A
 * function that was always constant is not a regression, which is why `version()` returning 3
 * is left alone, and why nothing here has to decide what a function is for.
 *
 * What it does not do is judge whether the one answer is the right one. `return 0` where the
 * base also returned 0 for every probed input is invisible here and stays a residual.
 */

/** One function, as the two versions of it answered. */
export interface ProbedFunction {
  readonly file: string;
  readonly name: string;
  readonly parameters: number;
  /** Distinct answers at the base commit, or null where that version could not be probed. */
  readonly baseOutcomes: number | null;
  readonly candidateOutcomes: number | null;
  /** Whether every probed input made the candidate throw, which is strictness, not a stub. */
  readonly candidateAlwaysThrew: boolean;
}

export interface BehaviourProbeResult {
  readonly probed: readonly ProbedFunction[];
  /** Functions that answered more than one way at the base and answer one way now. */
  readonly flattened: readonly ProbedFunction[];
  /** Files the probe could not load, with the reason, so a gap never reads as a pass. */
  readonly unprobed: readonly { readonly file: string; readonly reason: string }[];
}

interface ProbeOptions {
  readonly changes: WorkspaceChanges;
  readonly probe: WorkspaceProbe;
  readonly commands: GateCommandRunner;
  /** Under the session store, which invariant 11 keeps outside the workspace. */
  readonly scratchDirectory: string;
  readonly timeoutMs?: number;
}

/**
 * Modules this can load on its own. The two versions are written side by side in a scratch
 * directory rather than in the workspace, so nothing the gate does is visible to the gates
 * beside it, and the cost of that is that a module importing a sibling does not resolve. Such a
 * file is reported unprobed rather than guessed at.
 */
function probableFile(path: string): boolean {
  return isTestReachableSource(path) && /\.(m?js)$/.test(path);
}

/**
 * The inputs every probed function is called with, in this order. Fixed and ordered on purpose:
 * a probe drawing random arguments would report a different number on a second run, and a
 * measurement that moves on its own is not one a gate can hold anything to.
 *
 * Chosen to be distinguishable rather than exhaustive. Nothing here is a claim that a function
 * surviving these is correct; the only question asked is whether its answers still differ.
 */
const probeArguments = [0, 1, -1, 2.5, "", "abc", true, null] as const;

/**
 * The script the harness spawns, written by the harness to a path the harness named. Generated
 * rather than shipped, so what runs is exactly what this module says runs and there is no file
 * on disk for anything else to have edited between releases.
 */
function probeScript(): string {
  return [
    "import { pathToFileURL } from 'node:url';",
    "import { writeFileSync } from 'node:fs';",
    "",
    "const [, , modulePath, destination] = process.argv;",
    "",
    `const inputs = ${JSON.stringify(probeArguments)};`,
    "",
    "function answerOf(value) {",
    "  try {",
    "    if (typeof value === 'bigint') return `bigint:${value}`;",
    "    const rendered = JSON.stringify(value);",
    "    return rendered === undefined ? String(value) : rendered;",
    "  } catch {",
    "    return 'unserializable';",
    "  }",
    "}",
    "",
    "function call(fn, args) {",
    "  try {",
    "    const returned = fn(...args);",
    "    // A promise is not awaited: waiting on one turns a probe into a scheduler, and a",
    "    // function returning promises varies by what it resolves to, which is not read here.",
    "    return returned instanceof Promise ? 'promise' : answerOf(returned);",
    "  } catch (cause) {",
    "    return `threw:${cause instanceof Error ? cause.name : 'value'}`;",
    "  }",
    "}",
    "",
    "let loaded;",
    "try {",
    "  loaded = await import(pathToFileURL(modulePath).href);",
    "} catch (cause) {",
    "  writeFileSync(destination, JSON.stringify({",
    "    loaded: false,",
    "    reason: cause instanceof Error ? cause.message : String(cause),",
    "  }));",
    "  process.exit(0);",
    "}",
    "",
    "const functions = {};",
    "for (const [name, value] of Object.entries(loaded)) {",
    "  if (typeof value !== 'function') continue;",
    "  const parameters = value.length;",
    "  const answers = new Set();",
    "  for (const input of inputs) {",
    "    answers.add(call(value, Array.from({ length: Math.max(parameters, 1) }, () => input)));",
    "  }",
    "  const threw = [...answers].every((answer) => answer.startsWith('threw:'));",
    "  functions[name] = { parameters, outcomes: answers.size, allThrew: threw };",
    "}",
    "",
    "writeFileSync(destination, JSON.stringify({ loaded: true, functions }));",
  ].join("\n");
}

interface ProbeReport {
  readonly loaded: boolean;
  readonly reason?: string;
  readonly functions?: Readonly<
    Record<string, { parameters: number; outcomes: number; allThrew: boolean }>
  >;
}

/**
 * Both versions of every changed module, run over the same inputs. A file the probe cannot load
 * is named as unprobed; a function only one version exports is not compared, because there is
 * nothing on the other side to compare it to.
 */
export async function probeChangedBehaviour(options: ProbeOptions): Promise<BehaviourProbeResult> {
  const probed: ProbedFunction[] = [];
  const unprobed: { file: string; reason: string }[] = [];
  const runner = join(options.scratchDirectory, "probe-runner.mjs");

  const candidates = options.changes.files.filter(
    (file) => file.kind !== "deleted" && probableFile(file.path),
  );
  if (candidates.length === 0) {
    return { probed, flattened: [], unprobed };
  }

  await mkdir(options.scratchDirectory, { recursive: true });
  await writeFile(runner, probeScript(), "utf8");

  try {
    for (const file of candidates) {
      const baseText = await options.probe.readBase(file.path);
      const currentText = await options.probe.readCurrent(file.path);
      if (baseText === null || currentText === null) {
        // A file that is new, or gone, has no pair of versions to compare.
        continue;
      }

      const base = await runOneVersion(file.path, "base", baseText, runner, options);
      const candidate = await runOneVersion(file.path, "candidate", currentText, runner, options);

      if (!base.loaded || !candidate.loaded) {
        unprobed.push({
          file: file.path,
          reason: base.loaded
            ? (candidate.reason ?? "the changed version did not load")
            : (base.reason ?? "the base version did not load"),
        });
        continue;
      }

      for (const [name, reading] of Object.entries(candidate.functions ?? {})) {
        const before = base.functions?.[name];
        if (before === undefined) {
          continue;
        }
        probed.push({
          file: file.path,
          name,
          parameters: reading.parameters,
          baseOutcomes: before.outcomes,
          candidateOutcomes: reading.outcomes,
          candidateAlwaysThrew: reading.allThrew,
        });
      }
    }
  } finally {
    await rm(options.scratchDirectory, { recursive: true, force: true });
  }

  return {
    probed,
    // A function taking no parameters has nothing to vary, so its answer being one answer says
    // nothing about it. The rest is the comparison: more than one before, exactly one now.
    flattened: probed.filter(
      (one) =>
        one.parameters > 0 &&
        (one.baseOutcomes ?? 0) > 1 &&
        one.candidateOutcomes === 1 &&
        !one.candidateAlwaysThrew,
    ),
    unprobed,
  };
}

async function runOneVersion(
  path: string,
  version: "base" | "candidate",
  text: string,
  runner: string,
  options: ProbeOptions,
): Promise<ProbeReport> {
  const modulePath = join(options.scratchDirectory, version, path);
  const destination = join(options.scratchDirectory, `${version}.json`);
  await mkdir(dirname(modulePath), { recursive: true });
  await writeFile(modulePath, text, "utf8");
  await rm(destination, { force: true });

  // A vector, spawned directly, with no shell between the harness and the process: the same
  // discipline the coverage and control arms run under, for the same reason.
  const observation = await options.commands.runVouched(["node", runner, modulePath, destination], {
    cwd: options.scratchDirectory,
    timeoutMs: options.timeoutMs ?? defaultGateTimeoutMs,
  });
  if (observation.unavailable !== null) {
    return { loaded: false, reason: observation.unavailable };
  }
  return await readReport(destination);
}

async function readReport(destination: string): Promise<ProbeReport> {
  try {
    const parsed: unknown = JSON.parse(await readFile(destination, "utf8"));
    if (parsed === null || typeof parsed !== "object") {
      return { loaded: false, reason: "the probe wrote something that is not a report" };
    }
    return parsed as ProbeReport;
  } catch {
    return { loaded: false, reason: "the probe wrote no report, so nothing was measured" };
  }
}

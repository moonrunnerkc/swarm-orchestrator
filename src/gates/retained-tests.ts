import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { TaskCodeStatement } from "../task-code-statements.ts";
import type { GateCommandRunner, GateDefinition, GateObservation } from "./gate-definition.ts";
import type { GateCycle } from "./gate-runner.ts";
import { shellQuoted } from "./node-test-command.ts";

/**
 * A test the worker wrote, saw and then deleted or changed keeps the question it asked
 * (test-retention-v1).
 *
 * On October 24 a worker's own test of the task's call count failed three times, and the worker
 * deleted it before the first gate cycle: the failures were piped, so the harness recorded each
 * run as exit 0, and the first gated candidate never held the test, so no gate, ratchet or
 * regression-test record saw it go. The run delivered the defect the test had found.
 *
 * So every version of a test file a worker's step leaves is kept, and at each gate cycle whose
 * tests pass, each test the worker declared by a written name and has since deleted or changed is
 * run again, as it last stood, on the current candidate: its source appended to the file as the
 * file now is (or the file as it last held the test, where the file is gone), through the tests
 * gate's own command restricted to that file, and the file put back byte for byte after. Since
 * the file passes as it is, a failure is the retained test's. The reading is one of:
 * - **passes**: the current candidate meets it, so the deletion or change cost nothing;
 * - **open**: a deleted test that fails on the current candidate, a question still unanswered;
 * - **corrected**: a changed test whose earlier version fails where the current one passes; the
 *   worker changed what it expects, which is permitted and kept on the record with both versions;
 * - **unmeasured**: the tests did not pass on this candidate, or the command could not run it.
 *
 * A retained test is the model's expectation, never the task's: it is shown to repair, rerun on
 * later candidates and reported, and it decides nothing. Its connection to the task is only which
 * of the task's stated functions it calls. Deleting it again does not answer it; passing does.
 */
export const retentionRule = "test-retention-v1";

/** A test declared by a written name, with the source of its declaration. */
export interface TestBlock {
  readonly name: string;
  readonly source: string;
}

const testCall = /(?<![.\w$])(?:it|test)\s*\(\s*/g;

/** The end of the string literal opening at `open`, or -1; a template with `${` is not read. */
function literalEnd(text: string, open: number): number {
  const quote = text[open];
  for (let at = open + 1; at < text.length; at += 1) {
    if (text[at] === "\\") at += 1;
    else if (quote === "`" && text.startsWith("${", at)) return -1;
    else if (text[at] === quote) return at;
  }
  return -1;
}

/** The index of the parenthesis closing the one at `open`, skipping literals and comments. */
function closingParenthesis(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at] as string;
    if (char === '"' || char === "'" || char === "`") {
      const end = literalEnd(text, at);
      if (end === -1) return -1;
      at = end;
    } else if (text.startsWith("//", at)) {
      const line = text.indexOf("\n", at);
      at = line === -1 ? text.length : line;
    } else if (text.startsWith("/*", at)) {
      const close = text.indexOf("*/", at + 2);
      if (close === -1) return -1;
      at = close + 1;
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/**
 * The tests a JavaScript or TypeScript file declares as `it("name", ...)` or `test("name", ...)`,
 * each with its whole call. A test named by an expression, or marked skip, todo or only, is not
 * read: there is no name to follow it by, or it does not run as written. Two of one name are told
 * apart by `#2`, as the measures count them.
 */
export function testBlocks(text: string): readonly TestBlock[] {
  const blocks: TestBlock[] = [];
  const named = new Map<string, number>();
  for (const found of text.matchAll(testCall)) {
    const start = found.index ?? 0;
    const open = text.indexOf("(", start);
    const literal = start + found[0].length;
    const end = literalEnd(text, literal);
    if (!["'", '"', "`"].includes(text[literal] ?? "") || end === -1) continue;
    const close = closingParenthesis(text, open);
    if (close === -1) continue;
    const name = text.slice(literal + 1, end);
    const seen = (named.get(name) ?? 0) + 1;
    named.set(name, seen);
    const after = text[close + 1] === ";" ? close + 2 : close + 1;
    blocks.push({ name: seen === 1 ? name : `${name} #${seen}`, source: text.slice(start, after) });
  }
  return blocks;
}

/** A test as the worker last wrote it before it was deleted or changed, and what ran it again. */
export interface RetainedCase {
  readonly identity: string;
  readonly path: string;
  readonly name: string;
  readonly kind: "deleted" | "changed";
  readonly state: "passes" | "open" | "corrected" | "unmeasured";
  /** The worker step that last left this version, and the first that held the test at all. */
  readonly firstStep: number;
  readonly lastStep: number;
  /** The test as it last stood, run here; for a change, the version it changed to as well. */
  readonly source: string;
  readonly current: string | null;
  readonly observed: { readonly exitCode: number | null; readonly output: string } | null;
  readonly reason: string;
  /** The task's code statements naming a function the test calls: a connection, not a proof. */
  readonly connection: readonly string[];
}

export interface RetentionReading {
  readonly record: string;
  readonly cases: readonly RetainedCase[];
  /** The open cases, by identity: deleted tests that fail on this candidate. */
  readonly open: readonly string[];
  /** The repair brief for the open cases, or null where none is open. */
  readonly brief: string | null;
}

export interface TestRetention {
  /** A test file's bytes after the worker's step `step`; null where the step removed it. */
  readonly observe: (path: string, text: string | null, step: number) => void;
  /**
   * Runs every retained test on the candidate the cycle measured, through the tests gate's command
   * (null where there is none), and records what it read.
   */
  readonly measure: (cycle: GateCycle, runner: RetentionRunner) => Promise<RetentionReading>;
}

/** What runs a retained test: the gates' command runner and the tests gate whose command it uses. */
export interface RetentionRunner {
  readonly commands: GateCommandRunner;
  readonly testsGate: GateDefinition | null;
  readonly timeoutMs?: number;
}

/** At most this many retained tests run per cycle, the most recently left first. */
export const maxRetainedPerCycle = 4;
const outputChars = 1_500;

interface Version {
  readonly step: number;
  readonly text: string;
}

export function createTestRetention(options: {
  readonly workspaceRoot: string;
  readonly evidence: EvidenceRecorder;
  readonly statements: readonly TaskCodeStatement[];
}): TestRetention {
  const versions = new Map<string, Version[]>();
  const lastOf = (path: string) => versions.get(path)?.at(-1);
  // A formatter's rewrite of a test is not a change in what it asks.
  const same = (left: string | undefined, right: string | undefined) =>
    left !== undefined &&
    right !== undefined &&
    left.replace(/\s+/g, "") === right.replace(/\s+/g, "");

  /** The retained tests: for each name a file ever held, its latest version unlike the current. */
  const retained = (path: string, current: string | null) => {
    const now = new Map(
      (current === null ? [] : testBlocks(current)).map((one) => [one.name, one]),
    );
    const history = versions.get(path) ?? [];
    const found: {
      name: string;
      source: string;
      text: string;
      firstStep: number;
      lastStep: number;
    }[] = [];
    const names = new Set(
      history.flatMap((one) => testBlocks(one.text).map((block) => block.name)),
    );
    for (const name of names) {
      const held = history.flatMap((one) =>
        testBlocks(one.text)
          .filter((block) => block.name === name)
          .map((block) => ({ ...block, version: one })),
      );
      const differing = held.filter((one) => !same(one.source, now.get(name)?.source));
      const last = differing.at(-1);
      if (last === undefined) continue;
      found.push({
        name,
        source: last.source,
        text: last.version.text,
        firstStep: held[0]?.version.step ?? last.version.step,
        lastStep: last.version.step,
      });
    }
    return found;
  };

  const connectionOf = (source: string) => {
    const called = new Set([...source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((one) => one[1]));
    return options.statements
      .filter((one) =>
        (one.kind === "example" ? one.names : [one.subjectName, one.referenceName]).some((name) =>
          called.has(name),
        ),
      )
      .map((one) => one.id);
  };

  const run = async (path: string, runner: RetentionRunner): Promise<GateObservation | null> => {
    const source = runner.testsGate?.source;
    if (source?.kind !== "command") return null;
    const runOptions = { cwd: options.workspaceRoot, timeoutMs: runner.timeoutMs ?? 300_000 };
    if (source.argv !== undefined)
      return runner.commands.runVouched([...source.argv, path], runOptions);
    const quoted = shellQuoted(path);
    if (quoted === null) return null;
    // npm passes arguments to the script only after `--`.
    const separator = /^npm\s+(?:test|run(?:\s+--?\S+)*\s+test)\b/.test(source.command)
      ? " --"
      : "";
    return runner.commands.run(`${source.command}${separator} ${quoted}`, runOptions);
  };

  return {
    observe: (path, text, step) => {
      const last = lastOf(path);
      if (text === null || last?.text === text) return;
      versions.set(path, [...(versions.get(path) ?? []), { step, text }]);
    },
    measure: async (cycle, runner) => {
      const testsPassed = cycle.statuses.tests === "passed";
      const candidates: (ReturnType<typeof retained>[number] & {
        path: string;
        current: string | null;
        currentSource: string | null;
      })[] = [];
      for (const path of versions.keys()) {
        const absolute = join(options.workspaceRoot, path);
        const current = await readFile(absolute, "utf8").catch(() => null);
        const now = new Map(
          (current === null ? [] : testBlocks(current)).map((one) => [one.name, one.source]),
        );
        for (const one of retained(path, current))
          candidates.push({ ...one, path, current, currentSource: now.get(one.name) ?? null });
      }
      candidates.sort((left, right) => right.lastStep - left.lastStep);
      const cases: RetainedCase[] = [];
      for (const [index, one] of candidates.entries()) {
        const kind = one.currentSource === null ? "deleted" : "changed";
        const blank = {
          identity: `${one.path} > ${one.name}`,
          path: one.path,
          name: one.name,
          kind,
          firstStep: one.firstStep,
          lastStep: one.lastStep,
          source: one.source,
          current: one.currentSource,
          connection: connectionOf(one.source),
        } as const;
        if (index >= maxRetainedPerCycle) {
          cases.push({
            ...blank,
            state: "unmeasured",
            observed: null,
            reason: `not run: at most ${maxRetainedPerCycle} retained tests run in one cycle`,
          });
          continue;
        }
        if (!testsPassed) {
          cases.push({
            ...blank,
            state: "unmeasured",
            observed: null,
            reason:
              "the tests did not pass on this candidate, so a failure of the retained test could not be told from the suite's own",
          });
          continue;
        }
        const absolute = join(options.workspaceRoot, one.path);
        await writeFile(
          absolute,
          one.current === null ? one.text : `${one.current}\n${one.source}\n`,
        );
        let observed: GateObservation | null;
        try {
          observed = await run(one.path, runner);
        } finally {
          // Put back byte for byte: the file as it was, or no file where there was none.
          if (one.current === null) await rm(absolute, { force: true });
          else await writeFile(absolute, one.current);
        }
        if (observed === null || observed.unavailable !== null) {
          cases.push({
            ...blank,
            state: "unmeasured",
            observed: null,
            reason:
              observed === null
                ? "the tests gate has no command that runs one file"
                : `the command could not run: ${observed.unavailable}`,
          });
          continue;
        }
        const output = `${observed.stdout}\n${observed.stderr}`.trim();
        const passes = observed.exitCode === 0;
        cases.push({
          ...blank,
          state: passes ? "passes" : kind === "deleted" ? "open" : "corrected",
          observed: {
            exitCode: observed.exitCode,
            output: output.length > outputChars ? `...${output.slice(-outputChars)}` : output,
          },
          reason: passes
            ? "the current candidate meets the test as it last stood"
            : kind === "deleted"
              ? "the worker deleted this test, and as it last stood it fails on the current candidate"
              : "the worker changed this test, and its earlier version fails on the current candidate where the current one passes",
        });
      }
      const recorded = await options.evidence.record({
        type: "verification-command",
        actor: "harness",
        provenance: ["model", "tool-output"],
        payload: asJsonValue({
          rule: retentionRule,
          phase: "measured",
          attempt: cycle.attempt,
          cases,
          bound: maxRetainedPerCycle,
          limitation:
            "a retained test is a model's expectation, run by the harness: its failure is an open question for repair and the report, never a refusal; a test named by an expression, or one run outside its describe block's hooks, may not read as it did in place",
        }),
      });
      const open = cases.filter((one) => one.state === "open");
      return {
        record: recorded.record.payloadDigest,
        cases,
        open: open.map((one) => one.identity),
        brief: open.length === 0 ? null : retainedBrief(open),
      };
    },
  };
}

/** The repair brief for deleted tests that still fail: each with its source and what ran. */
export function retainedBrief(open: readonly RetainedCase[]): string {
  return [
    "Tests you wrote earlier in this run and later deleted were run again by the harness on the code as it is now, each as you last wrote it. They still fail. Deleting a test does not answer the question it asked.",
    "",
    ...open.flatMap((one) => [
      `${one.path} > ${one.name} (written at step ${one.firstStep}, last as below at step ${one.lastStep}):`,
      one.source,
      "It gives now:",
      one.observed?.output ?? "(no output)",
      ...(one.connection.length === 0
        ? []
        : [`It calls functions the task's own code names (${one.connection.join(", ")}).`]),
      "",
    ]),
    "Where the test is right about what the task asks, change the code so it passes and add the test back. Where it is wrong, add back a corrected test of the same name whose expectation the task supports, and say which sentence of the task it rests on. A test is a model's expectation and can be wrong; a corrected test that passes is kept on the record beside the version it replaces.",
  ].join("\n");
}

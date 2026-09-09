import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { runGatesEngine } from "./engine.ts";
import { createFileSetRegistry, type FileSetRegistry } from "./file-set.ts";

/**
 * Reported by an outside validator against e261c859b: a project declaring a linter and no test
 * runner settled green over a changed source file that nothing had executed. Every gate ran and
 * reported honestly; the check for "was this change measured" asked only whether some command
 * gate had passed, and a linter is one. The whole finding lives in the distance between
 * COMMAND_GATE_PASSED and CHANGED_CODE_EXECUTED.
 *
 * gate-capability.test.ts holds the predicate to that distinction on synthetic cycles. This
 * drives the reported path whole, through a real repository and the real engine, with the
 * changed file instrumented so that executing it leaves a trace outside the workspace. Both
 * directions are here, because the two failures are a pair: settling green on a change nothing
 * ran, and refusing to settle on one something did.
 */

const run = promisify(execFile);

let workspace = "";
let sessionRoot = "";
let executionMarker = "";
let evidence: EvidenceRecorder;
let fileSet: FileSetRegistry;

const wallClock: Clock = {
  now: () => 1_700_000_000_000,
  sleep: () => Promise.resolve(),
};

/** Passes on any tree. The point of the repro is a static gate that is genuinely happy. */
const lintScript = ["process.exit(0);", ""].join("\n");

/**
 * A module that records having been loaded. The marker is outside the workspace, since one
 * inside it would be a change the run made and the gates would go on to measure it.
 */
function probeableSource(returned: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(executionMarker)}, 'executed');`,
    "",
    "export function classify(value) {",
    `  return ${returned};`,
    "}",
    "",
  ].join("\n");
}

/**
 * The same instrumentation behind an import the behaviour probe cannot resolve. The probe writes
 * each version into a scratch directory of its own, so a module reaching for a sibling does not
 * load there and is reported unprobed rather than guessed at. That is the shape the report
 * describes: an executable file that every gate in the set leaves unexecuted.
 */
function unprobeableSource(returned: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { label } from './sibling.js';",
    `writeFileSync(${JSON.stringify(executionMarker)}, 'executed');`,
    "",
    "export function classify(value) {",
    `  return label(${returned});`,
    "}",
    "",
  ].join("\n");
}

async function git(...args: string[]): Promise<void> {
  await run("git", args, { cwd: workspace });
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(workspace, path, ".."), { recursive: true });
  await writeFile(join(workspace, path), contents, "utf8");
}

/** A manifest declaring a linter and nothing that runs the code. */
async function seedLintOnlyRepository(source: string): Promise<void> {
  const manifest = {
    name: "lint-only",
    type: "module",
    scripts: { lint: "node tools/lint.mjs" },
  };
  await write("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await write("src/sibling.js", "export const label = (value) => `${value}`;\n");
  await write("src/feature.js", source);
  await write("tools/lint.mjs", lintScript);

  await git("init", "--quiet");
  await git("config", "user.email", "gates@example.com");
  await git("config", "user.name", "gates");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "seed");
}

function runGates(resolve: () => Promise<void>, cap: number) {
  return runGatesEngine({
    workspaceRoot: workspace,
    baseRef: "HEAD",
    evidence,
    fileSet,
    clock: wallClock,
    emit: () => {},
    resolve,
    cap,
    gateOptions: { commandOverrides: { lint: "node tools/lint.mjs" } },
  });
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-static-only-"));
  sessionRoot = await mkdtemp(join(tmpdir(), "swarm-static-only-session-"));
  executionMarker = join(sessionRoot, "executed.marker");
  evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: "static-only-session",
    clock: wallClock,
  });
  fileSet = createFileSetRegistry(evidence);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(sessionRoot, { recursive: true, force: true });
});

describe("a project whose only passing command gate reads the source without running it", () => {
  it("does not settle green over a changed file nothing executed", async () => {
    await seedLintOnlyRepository(unprobeableSource("'other'"));
    await fileSet.declare(["src/feature.js"], "model");
    // Declared, then edited, which is the order invariant 12 asks for.
    await write("src/feature.js", unprobeableSource("value < 0 ? 'negative' : 'other'"));

    let resolverCalls = 0;
    const { outcome } = await runGates(async () => {
      resolverCalls += 1;
      // Nothing the model can do about it here: the project declares no runner. The loop still
      // has to be given the turn, since the alternative is settling on an unmeasured tree.
      await write("src/feature.js", unprobeableSource(`'other-${resolverCalls}'`));
    }, 2);

    expect(existsSync(executionMarker)).toBe(false);
    expect(outcome.finalCycle.statuses.lint).toBe("passed");
    expect(outcome.finalCycle.statuses.tests).toBe("not-applicable");
    expect(outcome.finalCycle.statuses["behaviour-probe"]).toBe("not-applicable");
    expect(outcome.finalCycle.blockingFailures).toHaveLength(0);

    // Every gate content and the change still unexecuted, which is the whole of the report.
    expect(outcome.settled).toBe("escalated");
    expect(resolverCalls).toBe(2);
  }, 60_000);

  it("settles green where the harness's own dynamic gate did run the change", async () => {
    // The mirror failure: the predicate asked for a command as well as a dynamic capability, so
    // the behaviour probe could execute the changed module and still be discarded, and a project
    // with no declared runner escalated saying nothing had run over its change.
    await seedLintOnlyRepository(probeableSource("'other'"));
    await fileSet.declare(["src/feature.js"], "model");
    await write("src/feature.js", probeableSource("value < 0 ? 'negative' : 'other'"));

    let resolverCalls = 0;
    const { outcome } = await runGates(async () => {
      resolverCalls += 1;
    }, 2);

    expect(existsSync(executionMarker)).toBe(true);
    expect(outcome.finalCycle.statuses["behaviour-probe"]).toBe("passed");
    expect(outcome.settled).toBe("green");
    expect(resolverCalls).toBe(0);
  }, 60_000);

  it("leaves a tree the run never changed alone, where there is nothing to run over", async () => {
    await seedLintOnlyRepository(unprobeableSource("'other'"));

    let resolverCalls = 0;
    const { outcome } = await runGates(async () => {
      resolverCalls += 1;
    }, 2);

    expect(outcome.settled).toBe("green");
    expect(resolverCalls).toBe(0);
  }, 60_000);
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ReviewProbe } from "./agent-review.ts";
import { loadFailure, probeContract, probeTrials, reviewTrialTool } from "./cli-review.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import type { TaskGoalContext } from "./cli-task-goal.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { plannedCheckRunner } from "./workers/planned-check-program.ts";

const probe: ReviewProbe = {
  id: "trims-names",
  basis: "preserve",
  keeps: "label trims",
  program: "import { label } from './label.mjs';\nexport default (input) => label(input.name);\n",
  cases: [{ input: { name: " ann " } }, { input: { name: "bob" } }],
};

describe("the review's probes as a contract", () => {
  it("runs every probe twice through the planned-check runner and decides nothing", () => {
    const contract = probeContract([probe]);
    expect(freezeGoalContract(contract).contract).toEqual(contract);
    expect(contract.checks.map((one) => one.id)).toEqual([
      "trims-names-run-1",
      "trims-names-run-2",
    ]);
    expect(contract.requirements).toEqual([
      expect.objectContaining({
        id: "candidate-review",
        checks: [],
        planned: { diagnostics: ["trims-names-run-1", "trims-names-run-2"] },
      }),
    ]);
    for (const check of contract.checks) {
      expect(check.author).toBe("model");
      expect(check.behavior?.kind).toBe("cli");
      if (check.behavior?.kind !== "cli") continue;
      expect(check.behavior.argv).toEqual([
        "node",
        "--input-type=module",
        "-e",
        plannedCheckRunner,
      ]);
      // The runner's lines are read back as they are: nothing compares them with an expectation.
      expect(check.behavior.stdout).toEqual([]);
      expect(JSON.parse(check.behavior.stdin)).toEqual({
        program: probe.program,
        inputs: [{ name: " ann " }, { name: "bob" }],
      });
    }
  });
});

describe("why a probe did not load", () => {
  it("keeps the error's message lines, not the loader frames under them", () => {
    const stderr = [
      "the check program did not load: SyntaxError: Unexpected token ':'",
      "    at compileSourceTextModule (node:internal/modules/esm/utils:351:16)",
      "    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:90:18)",
    ].join("\n");
    expect(loadFailure(stderr)).toBe("SyntaxError: Unexpected token ':'");
    expect(loadFailure("")).toBe("it printed nothing");
  });
});

describe("the reviewer's trial of a probe", () => {
  const run = promisify(execFile);

  it("runs on a copy of the candidate, says why a program did not load, and stops at its limit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "swarm-trial-"));
    try {
      const label = "export function label(name) {\n  return name.trim() + ':';\n}\n";
      await writeFile(join(workspace, "label.mjs"), label);
      await run("git", ["init", "-q"], { cwd: workspace });
      await run("git", ["add", "-A"], { cwd: workspace });
      await run("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "base"], {
        cwd: workspace,
      });
      // Not committed: the trial reads the workspace as it stands.
      await writeFile(join(workspace, "label.mjs"), label.replace("':'", "' -'"));
      const tool = reviewTrialTool({
        workspace,
        clock: createSystemClock(),
        isolation: null,
        signal: new AbortController().signal,
      } as unknown as TaskGoalContext);
      const loaded = await tool.execute({
        program:
          "import { writeFileSync } from 'node:fs';\nimport { label } from './label.mjs';\nexport default (input) => { writeFileSync('./label.mjs', 'broken'); return label(input); };\n",
        inputs: [" ann "],
      });
      expect(loaded.text).toContain('{"input":" ann ","result":"ann -"}');
      expect(loaded.facts).toEqual({ tried: 1, loaded: 1 });
      // The program wrote over label.mjs in its copy; the candidate under review is untouched.
      expect(await readFile(join(workspace, "label.mjs"), "utf8")).toBe(
        label.replace("':'", "' -'"),
      );
      const typed = await tool.execute({
        program: "export default (input: string) => input;\n",
        inputs: ["x"],
      });
      expect(typed.text).toContain("the program did not load: SyntaxError");
      expect(typed.facts).toEqual({ tried: 2, loaded: 0 });
      for (let tried = 3; tried <= probeTrials; tried += 1)
        await tool.execute({ program: "export default (x) => x;\n", inputs: [1] });
      await expect(
        tool.execute({ program: "export default (x) => x;\n", inputs: [1] }),
      ).rejects.toThrow(`try_probe has been used ${probeTrials} times`);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});

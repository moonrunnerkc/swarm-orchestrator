import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { type ConfirmationPrompt, createChokepoint } from "./chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./policy-guard.ts";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "chokepoint-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "s",
    now: () => 1,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function chokepoint(approval: "ask" | "auto", confirm: ConfirmationPrompt = null) {
  const guard = createPolicyGuard({
    workspaceRoot: root,
    homeDir: homedir(),
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [join(root, "sessions")],
    childHomeDir: join(root, "child-home"),
  });
  return createChokepoint({ guard, evidence, approval, confirm, timeoutMs: 30_000 });
}

describe("the chokepoint", () => {
  it("records the request before it runs and the outcome after", async () => {
    const outcome = await chokepoint("ask").run("ls");
    expect(outcome).toMatchObject({ decision: "allowed", exitCode: 0 });
    expect(evidence.records().map((record) => record.type)).toEqual(["tool-call", "tool-call"]);
  });

  it("denies a credential path and the session store, without running anything", async () => {
    expect((await chokepoint("auto").run("cat ~/.ssh/id_rsa")).decision).toBe("denied");
    expect((await chokepoint("auto").run(`ls ${join(root, "sessions")}`)).decision).toBe("denied");
  });

  it("refuses an off-allowlist program with nobody to ask, and runs it in auto mode", async () => {
    const asked = await chokepoint("ask").run("printf hi");
    expect(asked.decision).toBe("denied");
    expect(asked.output).toContain("printf");
    const auto = await chokepoint("auto").run("printf hi");
    expect(auto).toMatchObject({ decision: "allowed", output: "hi" });
  });

  it("remembers a person's always for the rest of the run", async () => {
    let asked = 0;
    const once = chokepoint("ask", async () => {
      asked += 1;
      return "always";
    });
    await once.run("printf a");
    await once.run("printf b");
    expect(asked).toBe(1);
    expect(evidence.records().filter((record) => record.type === "confirmation")).toHaveLength(2);
  });

  // A run once cloned the source repository to /tmp inside a `$(...)` command the reader could
  // not read, so no path was checked, and auto approval ran it.
  it("refuses in auto mode a command whose paths it cannot read, and asks a person in ask mode", async () => {
    for (const command of [
      `git clone --bare . /tmp/x && git -C /tmp/x update-ref refs/heads/main $(git rev-parse HEAD)`,
      `bash -c "git push origin main"`,
    ]) {
      const auto = await chokepoint("auto").run(command);
      expect(auto.decision).toBe("denied");
      expect(auto.output).toContain("cannot be read");
    }
    const asked = await chokepoint("ask", async () => "yes").run("printf $(printf hi)");
    expect(asked).toMatchObject({ decision: "allowed", output: "hi" });
  });

  it("says a command of comments alone has nothing to run, rather than that it cannot be read", async () => {
    const outcome = await chokepoint("auto").run("# the import (circular) is `store.py`\n# next");
    expect(outcome.decision).toBe("denied");
    expect(outcome.output).toContain("only comments");
  });

  // The same run pushed a branch to the repository it was cloned from.
  it("refuses publishing outside the workspace in every mode, however it is wrapped", async () => {
    for (const command of [
      "git push origin main",
      "git -C . push --force",
      "env GIT_TRACE=1 git push",
      "npm publish",
      "cargo publish --dry-run",
    ]) {
      for (const run of [chokepoint("auto"), chokepoint("ask", async () => "yes")]) {
        const outcome = await run.run(command);
        expect(outcome.decision).toBe("denied");
        expect(outcome.output).toContain("publishes outside the workspace");
      }
    }
  });

  // A run stashed its whole change on its last step, and the delivered tree was empty.
  it("refuses a stash, which takes the change out of the tree that is verified and delivered", async () => {
    for (const command of ["git stash", "git stash push -u", "git stash -k && npm test"]) {
      const outcome = await chokepoint("auto").run(command);
      expect(outcome.decision).toBe("denied");
      expect(outcome.output).toContain("out of the working tree");
    }
    expect((await chokepoint("auto").run("git stash list")).decision).toBe("allowed");
    expect((await chokepoint("auto").run("grep -rn 'git push' .")).decision).toBe("allowed");
  });

  // A model lost a turn each time a sed address or printed test source was refused as a path.
  it("runs a command whose quoted text looks like a path, and refuses the file it writes outside", async () => {
    const run = chokepoint("auto");
    const written = await run.run("printf 'f(/--max-budget-usd/);\\n}\\n' > a.ts");
    expect(written).toMatchObject({ decision: "allowed", exitCode: 0 });
    const printed = await run.run("sed -n '/max-budget/,/}/p' a.ts");
    expect(printed).toMatchObject({ decision: "allowed", output: "f(/--max-budget-usd/);\n}\n" });
    const outside = await run.run("sed -n '/max-budget/w ../escaped.ts' a.ts");
    expect(outside.decision).toBe("denied");
    expect(outside.output).toContain("resolves outside the workspace");
  });
});

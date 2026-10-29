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
});

import { describe, expect, it } from "vitest";
import { judgePreflight, renderPreflight } from "./preflight.mjs";

const digest = "d".repeat(64);
const cliRecord = { tarballSha256: digest };

function result(overrides = {}) {
  return {
    outcome: "fixed-by-restoring-the-line",
    timedOut: false,
    cli: { tarballSha256: digest },
    bundle: { verified: true, verifierExitCode: 0 },
    ...overrides,
  };
}

/** The decision record of a shell call: allowed with what came back, or denied with why. */
function shell(command, decision = "allowed", detail = "412 bytes returned") {
  return { type: "tool-call", payload: { toolName: "shell", kind: "shell", decision, detail, input: { command } } };
}

function refusedByAllowlist(command) {
  return shell(command, "denied", `"${command}" is not on the shell allowlist. Confirmation was declined.`);
}

function requested(command) {
  return { type: "tool-call", payload: { toolName: "shell", kind: "shell", decision: "requested", detail: "shell requested", input: { command } } };
}

const budget = { type: "session-budget", payload: { maxWallTimeMs: 33 * 60_000 } };

describe("judging a preflight run", () => {
  it("holds where the digest matches, the bundle verifies, the budget is recorded and the suite reached the shell", () => {
    const judgement = judgePreflight({
      result: result(),
      cliRecord,
      payloads: [budget, requested("pytest -q 2>&1 | tail -50"), shell("pytest -q 2>&1 | tail -50"), shell("git status")],
      suiteCommand: "pytest -q",
      expectedWallMinutes: 33,
    });

    expect(judgement.held).toBe(true);
    expect(judgement.findings.map((finding) => finding.check)).toEqual(["cli-digest", "bundle", "wall-budget", "suite-through-shell"]);
  });

  it("fails on a result that names another CLI, or none", () => {
    const other = judgePreflight({ result: result({ cli: { tarballSha256: "e".repeat(64) } }), cliRecord, payloads: [budget, shell("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(other.held).toBe(false);
    expect(other.findings[0]).toMatchObject({ check: "cli-digest", held: false });
    const none = judgePreflight({ result: result({ cli: { tarballSha256: null } }), cliRecord, payloads: [budget, shell("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(none.findings[0].detail).toBe("the result carries no CLI tarball digest");
  });

  it("fails on a missing or refused bundle, and says the container killed it where it did", () => {
    const killed = judgePreflight({ result: result({ bundle: null, outcome: "no-bundle", timedOut: true }), cliRecord, payloads: [], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(killed.findings[1]).toMatchObject({ check: "bundle", held: false, detail: "no bundle: no-bundle, the container killed it at the budget" });
    const refused = judgePreflight({ result: result({ bundle: { verified: false, verifierExitCode: 1 } }), cliRecord, payloads: [], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(refused.findings[1].detail).toBe("the bundle was refused by its own verifier, exit 1");
  });

  it("fails where the wall budget is absent or not the one the harness handed over", () => {
    const absent = judgePreflight({ result: result(), cliRecord, payloads: [shell("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(absent.findings[2]).toMatchObject({ check: "wall-budget", held: false });
    const wrong = judgePreflight({ result: result(), cliRecord, payloads: [{ type: "session-budget", payload: { maxWallTimeMs: 30 * 60_000 } }, shell("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(wrong.findings[2].detail).toBe("the run was given 30 minutes where 33 were expected");
  });

  it("fails where the suite command never reached the shell, or was refused by the allowlist", () => {
    const never = judgePreflight({ result: result(), cliRecord, payloads: [budget, shell("ls"), requested("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(never.findings[3]).toMatchObject({ check: "suite-through-shell", held: false });
    const refused = judgePreflight({ result: result(), cliRecord, payloads: [budget, requested("pytest -q"), refusedByAllowlist("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(refused.findings[3].detail).toBe("every one of 1 `pytest -q` call(s) was refused by the shell allowlist");
    const mixed = judgePreflight({ result: result(), cliRecord, payloads: [budget, refusedByAllowlist("pytest -q"), shell("cd /work && pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 });
    expect(mixed.held).toBe(false);
  });

  it("renders one line per check with the verdict first", () => {
    const page = renderPreflight("local-mlx cool-RR/PySnooper", judgePreflight({ result: result(), cliRecord, payloads: [budget, shell("pytest -q")], suiteCommand: "pytest -q", expectedWallMinutes: 33 }));
    expect(page.split("\n")[0]).toBe("preflight local-mlx cool-RR/PySnooper: HELD");
    expect(page).toContain("held  suite-through-shell: 1 `pytest -q` call(s) reached the shell, none refused");
  });
});

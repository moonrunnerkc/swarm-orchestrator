import { describe, expect, it } from "vitest";
import {
  describeEvidence,
  describeVerification,
  type EvidenceSummary,
  verifyCommandFor,
  verifyCommandText,
} from "./evidence-panel.ts";
import {
  evidenceLocation,
  type OpenCommand,
  openCommandFor,
  openEnvironment,
  openEvidenceTarget,
  targetPath,
  UntrustedEvidencePathError,
} from "./open-path.ts";

const location = evidenceLocation("/home/someone/.swarm/sessions/s-1/bundle", "harness");

const verified: EvidenceSummary = {
  location,
  recordCount: 42,
  claimsVerified: 3,
  claimsRefused: 11,
  verification: { kind: "verified", exitCode: 0 },
};

const unverified: EvidenceSummary = {
  ...verified,
  verification: { kind: "not-run", reason: "node could not be started" },
};

describe("what the panel says a bundle is", () => {
  it("names each artifact by what it is for", () => {
    const lines = describeEvidence(verified, 120).join("\n");
    expect(lines).toContain("the page a person reads");
    expect(lines).toContain("the bundle a stranger verifies");
    expect(lines).toContain("its own verifier, needing nothing installed");
    expect(lines).toContain("the chain every record is on");
  });

  it("says how many claims were refused, because that is the interesting half", () => {
    expect(describeEvidence(verified, 120).join("\n")).toContain(
      "The harness verified 3 claim(s) and refused 11.",
    );
  });

  it("fits whatever width it is given", () => {
    for (const columns of [40, 60, 80, 200]) {
      for (const line of describeEvidence(verified, columns)) {
        expect(line.length).toBeLessThanOrEqual(Math.max(20, columns));
      }
    }
  });

  // A log file has no width, and a truncated path is one nobody can retype.
  it("cuts nothing at all when there is no screen to fit", () => {
    expect(describeEvidence(verified, null).join("\n")).toContain(verifyCommandText(location));
    expect(describeEvidence(verified, 60).join("\n")).not.toContain(verifyCommandText(location));
  });
});

describe("what the panel may claim about verification", () => {
  /**
   * Opening a file is not verifying it. The panel says verified only where the embedded
   * verifier ran in this session and exited zero, and it names the exit code either way.
   */
  it("says verified only with the exit code that earned it", () => {
    expect(describeVerification({ kind: "verified", exitCode: 0 })).toBe(
      "bundle verified in this run: verify.mjs exited 0",
    );
  });

  it("says not verified, and prints the command, when the verifier did not run", () => {
    const lines = describeEvidence(unverified, 120).join("\n");
    expect(lines).toContain("not verified in this run (node could not be started)");
    expect(lines).toContain("check it yourself:");
    expect(lines).not.toContain("bundle verified in this run");
  });

  it("says refused out loud when the verifier ran and said no", () => {
    expect(
      describeVerification({ kind: "refused", exitCode: 1, detail: "chain broken at record 12" }),
    ).toContain("REFUSED by its own verifier: exit 1, chain broken at record 12");
  });

  it("offers the command to re-check only where the check has not already passed", () => {
    expect(describeEvidence(verified, 120).join("\n")).not.toContain("check it yourself");
  });
});

describe("the command the verifier runs under", () => {
  it("is a vector, with the bundle as its own argument", () => {
    expect(verifyCommandFor(location, "/usr/local/bin/node")).toEqual({
      file: "/usr/local/bin/node",
      args: [
        "/home/someone/.swarm/sessions/s-1/bundle/verify.mjs",
        "/home/someone/.swarm/sessions/s-1/bundle",
      ],
    });
  });

  it("spells the same vector the way a person retypes it", () => {
    expect(verifyCommandText(location)).toBe(
      "node /home/someone/.swarm/sessions/s-1/bundle/verify.mjs " +
        "/home/someone/.swarm/sessions/s-1/bundle",
    );
  });
});

describe("what may be opened", () => {
  it("refuses a path that did not come from the harness", () => {
    for (const provenance of ["model", "tool-output", "file", "user"] as const) {
      expect(() => evidenceLocation("/tmp/anything", provenance)).toThrow(
        UntrustedEvidencePathError,
      );
    }
  });

  it("names the provenance it refused, so the refusal is actionable", () => {
    expect(() => evidenceLocation("/tmp/anything", "model")).toThrow(/tagged model/);
  });

  it("opens the review page and the directory, and nothing else is nameable", () => {
    expect(targetPath(location, "review")).toBe(
      "/home/someone/.swarm/sessions/s-1/bundle/review.html",
    );
    expect(targetPath(location, "bundle")).toBe("/home/someone/.swarm/sessions/s-1/bundle");
  });
});

describe("a hostile path", () => {
  /**
   * The path travels as one argument to a process started directly, so a shell metacharacter
   * in it is a character in a filename rather than syntax. This is the same discipline
   * invariant 7 puts on the coverage arm, and for the same reason.
   */
  const hostile = evidenceLocation('/tmp/x"; rm -rf ~; echo "', "harness");

  it("keeps every character of it inside one argument", async () => {
    const spawned: OpenCommand[] = [];
    await openEvidenceTarget({
      location: hostile,
      target: "bundle",
      platform: "darwin",
      env: {},
      spawn: (command) => {
        spawned.push(command);
        return Promise.resolve(0);
      },
    });

    expect(spawned[0]?.file).toBe("open");
    expect(spawned[0]?.args).toEqual(['/tmp/x"; rm -rf ~; echo "']);
    expect(spawned[0]?.args).toHaveLength(1);
  });

  it("never assembles a command string for anything to re-read", () => {
    const command = openCommandFor("linux", "/tmp/x; rm -rf ~", {});
    expect(command.file).toBe("xdg-open");
    expect(command.file).not.toContain(" ");
    expect(command.args.every((argument) => typeof argument === "string")).toBe(true);
  });
});

describe("the environment an opener is given", () => {
  it("carries what a handler needs to find a display", () => {
    expect(openEnvironment({ PATH: "/usr/bin", DISPLAY: ":0" })).toEqual({
      PATH: "/usr/bin",
      DISPLAY: ":0",
    });
  });

  /** Not in any command string, so no reading of one could have caught it. */
  it("leaves behind every name that decides what a process loads", () => {
    const built = openEnvironment({
      PATH: "/usr/bin",
      NODE_OPTIONS: "--require /tmp/hook.js",
      LD_PRELOAD: "/tmp/hook.so",
      DYLD_INSERT_LIBRARIES: "/tmp/hook.dylib",
    });

    expect(built).toEqual({ PATH: "/usr/bin" });
  });
});

describe("the platform handler", () => {
  it("picks the one each platform actually has", () => {
    expect(openCommandFor("darwin", "/b", {}).file).toBe("open");
    expect(openCommandFor("linux", "/b", {}).file).toBe("xdg-open");
    // `start` is a cmd.exe builtin, which would need a shell between the harness and the
    // process. explorer.exe is a real executable, so the rule holds on Windows too.
    expect(openCommandFor("win32", "/b", {}).file).toBe("explorer.exe");
  });
});

describe("when opening fails", () => {
  it("reports the exit code rather than ending a finished run", async () => {
    const outcome = await openEvidenceTarget({
      location,
      target: "review",
      platform: "linux",
      env: {},
      spawn: () => Promise.resolve(3),
    });

    expect(outcome.opened).toBe(false);
    expect(outcome.detail).toBe("xdg-open exited 3");
  });

  it("reports a handler that is not installed at all", async () => {
    const outcome = await openEvidenceTarget({
      location,
      target: "review",
      platform: "linux",
      env: {},
      spawn: () => Promise.reject(new Error("spawn xdg-open ENOENT")),
    });

    expect(outcome.opened).toBe(false);
    expect(outcome.detail).toContain("ENOENT");
  });
});

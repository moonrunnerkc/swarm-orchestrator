import { describe, expect, it } from "vitest";
import { diagnose, type InstallSnapshot, remediesFor } from "./health.ts";
import { describeInstall } from "./report.ts";

const healthy: InstallSnapshot = {
  runningVersion: "13.1.7",
  runningFrom: "/usr/lib/node_modules/swarm-orchestrator",
  globalRoot: "/usr/lib/node_modules",
  globalEntry: {
    path: "/usr/lib/node_modules/swarm-orchestrator",
    isLink: false,
    target: null,
    version: "13.1.7",
  },
  binsOnPath: ["/usr/bin/swarm"],
  publishedVersion: "13.1.7",
};

describe("what owns the swarm command", () => {
  /**
   * The failure this exists for, seen on two machines months apart and presenting as something
   * else both times: an ENOTDIR during a global install on macOS, and on Linux a swarm with no
   * `select` command. Both were a development checkout linked into the global prefix, which
   * owns the command until it is removed.
   */
  it("names a development link, and what it is shadowing", () => {
    const findings = diagnose({
      ...healthy,
      globalEntry: {
        path: "/usr/lib/node_modules/swarm-orchestrator",
        isLink: true,
        target: "/home/brad/projects/swarm-orchestrator",
        version: "12.1.1",
      },
      publishedVersion: "13.1.7",
    });

    expect(findings[0]?.severity).toBe("broken");
    expect(findings[0]?.detail).toContain("/home/brad/projects/swarm-orchestrator");
    expect(findings[0]?.detail).toContain("12.1.1");
    expect(findings[0]?.remedy).toEqual([
      "npm rm -g swarm-orchestrator",
      "npm install -g swarm-orchestrator",
    ]);
  });

  it("reports a second executable on PATH, since the first one wins silently", () => {
    const findings = diagnose({
      ...healthy,
      binsOnPath: ["/usr/local/bin/swarm", "/usr/bin/swarm"],
    });

    expect(findings.some((finding) => finding.summary.includes("2 swarm executables"))).toBe(true);
  });

  /** A failed global install removes the package and leaves the executable pointing at nothing. */
  it("reports an executable whose package is gone", () => {
    const findings = diagnose({ ...healthy, globalEntry: null });

    expect(findings[0]?.summary).toContain("points at a package that is not there");
    expect(findings[0]?.remedy.length).toBeGreaterThan(0);
  });

  it("says when the registry is ahead of what is running", () => {
    const findings = diagnose({ ...healthy, runningVersion: "13.1.0", publishedVersion: "13.1.7" });

    expect(findings[0]?.severity).toBe("worth-knowing");
    expect(findings[0]?.summary).toContain("13.1.0");
    expect(findings[0]?.summary).toContain("13.1.7");
  });

  it("does not call a newer local build stale", () => {
    const findings = diagnose({ ...healthy, runningVersion: "13.2.0", publishedVersion: "13.1.7" });

    expect(findings.every((finding) => finding.severity === "healthy")).toBe(true);
  });

  it("says nothing about the registry when it could not be asked", () => {
    const findings = diagnose({ ...healthy, runningVersion: "13.1.0", publishedVersion: null });

    expect(findings.every((finding) => finding.severity === "healthy")).toBe(true);
  });

  /** An empty report reads as a check that did not run, so a healthy install still says so. */
  it("reports health rather than reporting nothing", () => {
    const findings = diagnose(healthy);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("healthy");
    expect(findings[0]?.remedy).toEqual([]);
  });

  it("collects the remedies once each, in the order they were reported", () => {
    const findings = diagnose({
      ...healthy,
      globalEntry: {
        path: "/g/swarm-orchestrator",
        isLink: true,
        target: "/repo",
        version: "12.1.1",
      },
      runningVersion: "12.1.1",
      publishedVersion: "13.1.7",
    });

    expect(remediesFor(findings)).toEqual([
      "npm rm -g swarm-orchestrator",
      "npm install -g swarm-orchestrator",
    ]);
  });
});

describe("the report it prints", () => {
  it("carries every finding, its detail and its commands", () => {
    const lines = describeInstall(
      diagnose({
        ...healthy,
        globalEntry: {
          path: "/g/swarm-orchestrator",
          isLink: true,
          target: "/repo",
          version: "12.1.1",
        },
      }),
      true,
    ).join("\n");

    expect(lines).toContain("BROKEN");
    expect(lines).toContain("run: npm rm -g swarm-orchestrator");
    expect(lines).toContain("swarm doctor --fix");
  });

  it("does not offer a fix when there is nothing to run", () => {
    expect(describeInstall(diagnose(healthy), false).join("\n")).not.toContain("--fix");
  });
});

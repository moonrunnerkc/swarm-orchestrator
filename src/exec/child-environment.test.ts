import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCredentialName } from "../evidence/scrub.ts";
import { childEnvironment, harnessChildEnvironment } from "./child-environment.ts";

const workerHome = "/tmp/worker-home";

describe("what a child process inherits", () => {
  it("withholds a provider key the harness was started with", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" },
      { homeDir: workerHome },
    );

    expect(built.variables.ANTHROPIC_API_KEY).toBeUndefined();
    expect(built.withheld).toContain("ANTHROPIC_API_KEY");
  });

  it("withholds every credential-shaped name rather than a listed few", () => {
    const built = childEnvironment(
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "x",
        AWS_SECRET_ACCESS_KEY: "x",
        GITHUB_TOKEN: "x",
        NPM_TOKEN: "x",
        DATABASE_PASSWORD: "x",
        MY_SERVICE_CREDENTIAL: "x",
      },
      { homeDir: workerHome },
    );

    expect(Object.keys(built.variables).sort()).toEqual(["HOME", "PATH", "TMPDIR"]);
  });

  it("withholds an unrecognized name, because the floor is an allowlist and not a denylist", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", SOME_INTERNAL_ENDPOINT: "https://internal" },
      { homeDir: workerHome },
    );

    expect(built.variables.SOME_INTERNAL_ENDPOINT).toBeUndefined();
    expect(built.withheld).toContain("SOME_INTERNAL_ENDPOINT");
  });

  it("carries the locale and terminal names a toolchain needs to run at all", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", LANG: "en_US.UTF-8", TZ: "UTC", TERM: "xterm-256color" },
      { homeDir: workerHome },
    );

    expect(built.variables.LANG).toBe("en_US.UTF-8");
    expect(built.variables.TZ).toBe("UTC");
    expect(built.variables.TERM).toBe("xterm-256color");
  });

  it("gives the child the home directory the harness named, never the operator's own", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", HOME: "/Users/someone" },
      { homeDir: workerHome },
    );

    expect(built.variables.HOME).toBe(workerHome);
  });

  it("passes a task variable the run explicitly authorized", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", CI: "1", FIXTURE_PORT: "8080" },
      { homeDir: workerHome, passThrough: ["CI", "FIXTURE_PORT"] },
    );

    expect(built.variables.CI).toBe("1");
    expect(built.variables.FIXTURE_PORT).toBe("8080");
  });

  it("refuses an authorized name that is credential shaped, because fail-closed is the point", () => {
    expect(() =>
      childEnvironment(
        { PATH: "/usr/bin", ANTHROPIC_API_KEY: "x" },
        { homeDir: workerHome, passThrough: ["ANTHROPIC_API_KEY"] },
      ),
    ).toThrow(/credential/i);
  });

  it("refuses an authorized name that decides what node loads", () => {
    expect(() =>
      childEnvironment(
        { PATH: "/usr/bin", NODE_OPTIONS: "--require ./evil.js" },
        { homeDir: workerHome, passThrough: ["NODE_OPTIONS"] },
      ),
    ).toThrow(/node/i);
  });

  it("never carries a node loader name through the ordinary path either", () => {
    const built = childEnvironment(
      { PATH: "/usr/bin", NODE_OPTIONS: "--require ./evil.js", NODE_PATH: "/evil" },
      { homeDir: workerHome },
    );

    expect(built.variables.NODE_OPTIONS).toBeUndefined();
    expect(built.variables.NODE_PATH).toBeUndefined();
  });

  /**
   * A hook named in NODE_OPTIONS or LD_PRELOAD runs in the process that writes an artifact just
   * as surely as one named on the command line, and neither a token scan nor a read-back of the
   * vector can see it, because neither reads the environment.
   */
  it("drops every name that decides what a process loads", () => {
    const built = childEnvironment(
      {
        PATH: "/usr/bin",
        CI: "true",
        NODE_OPTIONS: "--require=./hook.cjs",
        NODE_V8_COVERAGE: "/tmp/coverage",
        NODE_PATH: "/tmp/modules",
        node_options: "--require=./hook.cjs",
        LD_PRELOAD: "/tmp/hook.so",
        DYLD_INSERT_LIBRARIES: "/tmp/hook.dylib",
      },
      { homeDir: workerHome, passThrough: ["CI"] },
    );

    expect(built.variables).toEqual({
      PATH: "/usr/bin",
      CI: "true",
      HOME: workerHome,
      TMPDIR: built.variables.TMPDIR,
    });
  });

  it("names a scratch directory that exists, because a missing one is measured as nothing", () => {
    // A TMPDIR naming a directory that is not there does not fail: node's test runner writes a
    // zero-byte lcov report, and invariant 7 reads an incomplete report as not measured. The
    // coverage arm went quiet rather than loud.
    const built = harnessChildEnvironment();

    expect(existsSync(built.variables.TMPDIR ?? "")).toBe(true);
    expect(existsSync(built.variables.HOME ?? "")).toBe(true);
  });

  it("rules on a credential name with the one detector the scrub and the gate already share", () => {
    expect(isCredentialName("anthropic_api_key")).toBe(true);
    expect(isCredentialName("Aws_Session_Token")).toBe(true);
    expect(isCredentialName("PATH")).toBe(false);
  });
});

describe("a name a run authorizes that may never travel", () => {
  it("refuses a dynamic-linker preload, which puts native code in any process at all", () => {
    for (const name of ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "LD_AUDIT"]) {
      expect(() =>
        childEnvironment({ [name]: "/tmp/hook.so" }, { homeDir: workerHome, passThrough: [name] }),
      ).toThrow(/any process/);
    }
  });
});

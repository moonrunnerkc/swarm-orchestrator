import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

describe("a command that never finishes", () => {
  it("says what waits for ever, not just that time ran out", async () => {
    // Node's test runner gives each spawned test file a standard input with no writer and
    // never closes it, so a test that reads input blocks until something kills it. A run spent
    // 300 seconds, a third of its wall clock, discovering that, and was told only the number.
    const runner = createNodeCommandRunner(createTestClock());

    const observation = await runner.run("sleep 5", { cwd: process.cwd(), timeoutMs: 150 });

    expect(observation.stderr).toContain("waiting for something that is never coming");
    expect(observation.stderr).toContain("standard input");
    expect(observation.stderr).toContain("pass it in");
  });

  it("is a failure of the gate that ran it, not a gate that could not run", async () => {
    // Reported as not applicable, a hung suite stood down and the run was green on the gates
    // beside it. The process ran and did not pass, which is what a failure is.
    const runner = createNodeCommandRunner(createTestClock());

    const observation = await runner.run("sleep 5", { cwd: process.cwd(), timeoutMs: 150 });

    expect(observation.unavailable).toBeNull();
    expect(observation.exitCode).not.toBe(0);
  });

  it("reports a program it could not start as unavailable, by the spawn and not by a parser", async () => {
    const runner = createNodeCommandRunner(createTestClock());

    const observation = await runner.runVouched([join(process.cwd(), "no-such-program")], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    expect(observation.unavailable).toContain("could not be started (ENOENT)");
    expect(observation.exitCode).toBe(127);
  });

  it("leaves a command that simply failed alone", async () => {
    const runner = createNodeCommandRunner(createTestClock());

    const observation = await runner.run("exit 3", { cwd: process.cwd(), timeoutMs: 10_000 });

    expect(observation.unavailable).toBeNull();
    expect(observation.exitCode).toBe(3);
  });
});

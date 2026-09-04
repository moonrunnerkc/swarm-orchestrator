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

    expect(observation.unavailable).toContain("waiting for something that is never coming");
    expect(observation.unavailable).toContain("standard input");
    expect(observation.unavailable).toContain("pass it in");
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

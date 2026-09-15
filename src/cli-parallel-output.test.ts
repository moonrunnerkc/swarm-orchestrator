import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { startParallelOutput } from "./cli-parallel-output.ts";
import { createTestClock } from "./core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { controllerScreenLines } from "./tui/controller-screen-model.ts";
import { projectControllerView } from "./workers/controller-view.ts";

let root: string;
let evidence: EvidenceRecorder;
const clock = createTestClock();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "parallel-output-"));
  evidence = await openEvidenceSession({ root, sessionId: "output", clock });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("keeps all plain worker output inside JSON events and reports interruption without inventing acceptance", async () => {
  const lines: string[] = [];
  const output = await startParallelOutput({
    evidence,
    clock,
    json: true,
    details: true,
    interactive: true,
    write: (line) => lines.push(line),
    screen: () => {
      throw new Error("JSON cannot start a terminal");
    },
  });
  output.note("planning details");
  output.fail(new Error("shared budget exhausted"));
  await output.stop();
  const events = lines.map((line) => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({
    schema: "swarm.controller.result.v1",
    outcome: null,
    error: "shared budget exhausted",
    exitCode: 1,
  });
  expect(events.some((entry) => entry.event?.text === "planning details")).toBe(true);
});
it("sanitizes terminal content while keeping goal acceptance pending", () => {
  const lines = controllerScreenLines(
    {
      ...projectControllerView(evidence),
      goal: "hello\u001b[2J\nforged success",
      jobs: [{ id: "local-green", state: "accepted" }],
      requirements: [{ id: "whole", status: "pending" }],
    },
    80,
    0,
  );
  expect(lines.join("\n")).toContain("Work: 1/1 jobs accepted");
  expect(lines.join("\n")).toContain("Goal acceptance: pending; 0/1 requirements accepted");
  expect(lines.join("\n")).not.toContain("forged success");
  expect(lines.every((line) => !line.includes("\u001b") && line.length <= 80)).toBe(true);
});
it("releases the terminal once even when error cleanup repeats", async () => {
  let stops = 0;
  const output = await startParallelOutput({
    evidence,
    clock,
    json: false,
    details: false,
    interactive: true,
    write: () => {},
    screen: () => ({
      update: () => {},
      stop: async () => {
        stops += 1;
      },
    }),
  });
  await output.stop();
  output.fail("cancelled");
  await output.stop();
  expect(stops).toBe(1);
});

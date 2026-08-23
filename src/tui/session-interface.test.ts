import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { createTestClock } from "../core/test-doubles.ts";
import type { EvidenceSummary } from "./evidence-panel.ts";
import { resolveKeyBindings } from "./key-bindings.ts";
import { evidenceLocation, type OpenCommand } from "./open-path.ts";
import {
  type OpenEvidencePolicy,
  type SessionInterfaceOptions,
  startSessionInterface,
} from "./session-interface.ts";
import { resolveTheme } from "./theme.ts";

const summary: EvidenceSummary = {
  location: evidenceLocation("/home/someone/.swarm/sessions/s-1/bundle", "harness"),
  recordCount: 42,
  claimsVerified: 3,
  claimsRefused: 11,
  verification: { kind: "verified", exitCode: 0 },
};

interface Started {
  readonly lines: string[];
  readonly errors: string[];
  readonly opened: OpenCommand[];
  readonly ui: ReturnType<typeof startSessionInterface>;
}

function start(overrides: Partial<SessionInterfaceOptions> = {}): Started {
  const lines: string[] = [];
  const errors: string[] = [];
  const opened: OpenCommand[] = [];

  const ui = startSessionInterface({
    task: "fix the parser",
    workspace: "/work/repo",
    isTty: false,
    interactive: true,
    writeLine: (line) => lines.push(line),
    writeError: (line) => errors.push(line),
    clock: createTestClock(),
    theme: resolveTheme({ mode: "never", term: "dumb", noColorSet: true, isTty: false }),
    bindings: resolveKeyBindings(),
    openEvidence: "ask" as OpenEvidencePolicy,
    spawnOpen: (command) => {
      opened.push(command);
      return Promise.resolve(0);
    },
    platform: "darwin",
    ...overrides,
  });

  return { lines, errors, opened, ui };
}

const events: readonly LoopEvent[] = [
  { type: "plan", text: "read, then edit" },
  { type: "model-call", step: 1, modelId: "fixture:a" },
  { type: "stopped", reason: "completed", steps: 1, tokensUsed: 10 },
];

describe("off a terminal", () => {
  it("writes the same plain lines it always wrote", () => {
    const { lines, ui } = start();
    for (const event of events) {
      ui.emit(event);
    }

    expect(lines).toEqual([
      "plan: read, then edit",
      "step 1: calling fixture:a",
      "stopped: completed after 1 steps, 10 tokens",
    ]);
  });

  it("refuses a confirmation instead of blocking on a prompt nobody can answer", async () => {
    const { errors, ui } = start();
    const approved = await ui.confirm({
      toolName: "shell",
      detail: "bash ./deploy.sh",
      reason: "derivation-heuristic",
      explanation: "overlaps a file read a moment ago",
    });

    expect(approved).toBe(false);
    expect(errors[0]).toContain("[chokepoint] refusing shell without a terminal to confirm on");
  });

  it("prints the evidence panel rather than drawing it", async () => {
    const { lines, ui } = start();
    await ui.presentEvidence(summary);

    expect(lines.join("\n")).toContain("what this run produced");
    expect(lines.join("\n")).toContain("bundle verified in this run");
  });
});

describe("opening the evidence is opt-in", () => {
  /** A tool that launches a browser unasked is a tool people configure away. */
  it("opens nothing off a terminal, whatever the default says", async () => {
    const { opened, ui } = start({ openEvidence: "ask" });
    await ui.presentEvidence(summary);
    expect(opened).toEqual([]);
  });

  it("opens nothing off a terminal when told never", async () => {
    const { opened, ui } = start({ openEvidence: "never" });
    await ui.presentEvidence(summary);
    expect(opened).toEqual([]);
  });

  it("opens only where a script asked for it explicitly", async () => {
    const { opened, ui } = start({ openEvidence: "always" });
    await ui.presentEvidence(summary);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.file).toBe("open");
    expect(opened[0]?.args).toEqual(["/home/someone/.swarm/sessions/s-1/bundle/review.html"]);
  });
});

describe("a terminal with the screen turned off", () => {
  it("asks on the terminal, since nothing else is holding stdin", async () => {
    const asked: string[] = [];
    const { ui } = start({
      isTty: true,
      interactive: false,
      askOnTerminal: (question) => {
        asked.push(question);
        return Promise.resolve("y");
      },
    });

    const approved = await ui.confirm({
      toolName: "shell",
      detail: "bash ./deploy.sh",
      reason: "derivation-heuristic",
      explanation: "overlaps a file read a moment ago",
    });

    expect(approved).toBe(true);
    expect(asked[0]).toBe('Run "bash ./deploy.sh"? [y/N] ');
  });

  it("reads anything but y as a refusal", async () => {
    const { ui } = start({
      isTty: true,
      interactive: false,
      askOnTerminal: () => Promise.resolve(""),
    });

    expect(
      await ui.confirm({
        toolName: "shell",
        detail: "bash ./deploy.sh",
        reason: "derivation-heuristic",
        explanation: "overlaps a file read a moment ago",
      }),
    ).toBe(false);
  });

  it("still writes plain lines, so --no-tui is the stream and nothing else", () => {
    const { lines, ui } = start({ isTty: true, interactive: false });
    ui.emit({ type: "model-call", step: 2, modelId: "fixture:a" });
    expect(lines).toEqual(["step 2: calling fixture:a"]);
  });
});

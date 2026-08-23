import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolInvocation } from "../core/tool-invoker.ts";
import { createToolChokepoint } from "../tools/chokepoint.ts";
import type { ChokepointRecord, ConfirmationRecord } from "../tools/chokepoint-record.ts";
import { createDerivationHeuristic } from "../tools/derivation.ts";
import { createSandbox, type SandboxPolicy } from "../tools/sandbox.ts";
import { defineTool } from "../tools/tool-definition.ts";
import { createConfirmationQueue } from "./confirmation-queue.ts";
import { resolveKeyBindings } from "./key-bindings.ts";
import { dispatchKey, type KeyPress } from "./key-dispatcher.ts";
import { initialViewState } from "./view-state.ts";

/**
 * The stdin collision, closed and held closed. `cli.ts` used to build a readline interface on
 * the same stdin Ink holds in raw mode, so a confirmation firing mid-run raced two readers for
 * one stream. The answer now travels from a keystroke through the dispatcher, into the queue,
 * and out of the chokepoint's own prompt, which is what this drives end to end.
 */

const policy: SandboxPolicy = {
  workspaceRoot: "/work/repo",
  homeDir: "/home/dev",
  shellAllowlist: ["bash"],
  deniedRoots: [],
  realpath: (path) => path,
};

const bindings = resolveKeyBindings();

function keyPress(input: string): KeyPress {
  return { input, ctrl: false, name: null };
}

function createChokepoint(confirm: (request: never) => Promise<boolean>, ran: string[]) {
  const calls: ChokepointRecord[] = [];
  const confirmations: ConfirmationRecord[] = [];
  const shell = defineTool({
    name: "shell",
    description: "spy shell tool",
    inputSchema: z.object({ command: z.string() }),
    kind: "shell",
    pathsFrom: () => [],
    execute(input) {
      ran.push(input.command);
      return Promise.resolve({ text: "ok", facts: { command: input.command, exitCode: 0 } });
    },
  });

  const derivation = createDerivationHeuristic();
  const chokepoint = createToolChokepoint({
    definitions: [shell],
    sandbox: createSandbox(policy),
    confirm: confirm as never,
    recorder: {
      recordCall(entry) {
        calls.push(entry);
        return Promise.resolve(`sha256:${"ab".repeat(32)}`);
      },
      recordConfirmation(entry) {
        confirmations.push(entry);
        return Promise.resolve();
      },
    },
    derivation,
  });

  return { chokepoint, calls, confirmations, derivation };
}

function shellCall(command: string): ToolInvocation {
  return { callId: "call-1", toolName: "shell", input: { command }, provenance: "model" };
}

describe("a confirmation answered from the interactive screen", () => {
  it("carries an approval from the keystroke to the tool, intact", async () => {
    const ran: string[] = [];
    const queue = createConfirmationQueue();
    const { chokepoint, confirmations, derivation } = createChokepoint(
      (request) => queue.ask(request),
      ran,
    );
    derivation.observe("bash ./deploy.sh --now", {
      tag: "file",
      label: "RELEASING.md",
      digest: `sha256:${"cd".repeat(32)}`,
    });

    const invoked = chokepoint.invoke(shellCall("bash ./deploy.sh --now"));
    await waitForQuestion(queue);

    const pending = queue.current();
    expect(pending).not.toBeNull();

    const decision = dispatchKey(keyPress("y"), {
      bindings,
      state: initialViewState,
      confirmationPending: true,
      rowCount: 0,
      pageRows: 5,
    });
    expect(decision).toEqual({ kind: "answer-confirmation", approved: true });
    if (decision.kind === "answer-confirmation") {
      pending?.answer(decision.approved);
    }

    const outcome = await invoked;
    expect(outcome.failed).toBe(false);
    expect(ran).toEqual(["bash ./deploy.sh --now"]);
    expect(confirmations[0]).toMatchObject({ approved: true, toolName: "shell" });
  });

  it("carries a refusal the same way, and the tool never runs", async () => {
    const ran: string[] = [];
    const queue = createConfirmationQueue();
    const { chokepoint, confirmations, derivation } = createChokepoint(
      (request) => queue.ask(request),
      ran,
    );
    derivation.observe("bash ./deploy.sh --now", {
      tag: "file",
      label: "RELEASING.md",
      digest: `sha256:${"cd".repeat(32)}`,
    });

    const invoked = chokepoint.invoke(shellCall("bash ./deploy.sh --now"));
    await waitForQuestion(queue);

    const decision = dispatchKey(keyPress("n"), {
      bindings,
      state: initialViewState,
      confirmationPending: true,
      rowCount: 0,
      pageRows: 5,
    });
    expect(decision).toEqual({ kind: "answer-confirmation", approved: false });
    queue.current()?.answer(false);

    const outcome = await invoked;
    expect(outcome.failed).toBe(true);
    expect(ran).toEqual([]);
    expect(confirmations[0]).toMatchObject({ approved: false });
  });

  it("refuses what is still waiting when the view goes away, rather than hanging the run", async () => {
    const ran: string[] = [];
    const queue = createConfirmationQueue();
    const { chokepoint, derivation } = createChokepoint((request) => queue.ask(request), ran);
    derivation.observe("bash ./deploy.sh --now", {
      tag: "file",
      label: "RELEASING.md",
      digest: `sha256:${"cd".repeat(32)}`,
    });

    const invoked = chokepoint.invoke(shellCall("bash ./deploy.sh --now"));
    await waitForQuestion(queue);
    queue.refuseAll();

    expect((await invoked).failed).toBe(true);
    expect(ran).toEqual([]);
  });
});

describe("the confirmation queue", () => {
  it("shows one question at a time, in the order they were asked", async () => {
    const queue = createConfirmationQueue();
    const request = (detail: string) =>
      ({
        toolName: "shell",
        detail,
        reason: "derivation-heuristic",
        explanation: "overlaps content read a moment ago",
      }) as const;

    const first = queue.ask(request("one"));
    const second = queue.ask(request("two"));

    expect(queue.current()?.request.detail).toBe("one");
    queue.current()?.answer(true);
    expect(await first).toBe(true);

    expect(queue.current()?.request.detail).toBe("two");
    queue.current()?.answer(false);
    expect(await second).toBe(false);
    expect(queue.current()).toBeNull();
  });

  it("ignores a second answer to a question already answered", async () => {
    const queue = createConfirmationQueue();
    const asked = queue.ask({
      toolName: "shell",
      detail: "one",
      reason: "derivation-heuristic",
      explanation: "overlaps content read a moment ago",
    });

    const pending = queue.current();
    pending?.answer(true);
    pending?.answer(false);

    expect(await asked).toBe(true);
  });

  it("tells the screen when a question arrives and when it is gone", async () => {
    const queue = createConfirmationQueue();
    const seen: (string | null)[] = [];
    queue.subscribe((pending) => seen.push(pending?.request.detail ?? null));

    const asked = queue.ask({
      toolName: "shell",
      detail: "one",
      reason: "derivation-heuristic",
      explanation: "overlaps content read a moment ago",
    });
    queue.current()?.answer(true);
    await asked;

    expect(seen).toEqual(["one", null]);
  });
});

/** The chokepoint records the request before it asks, so the question arrives a tick later. */
async function waitForQuestion(queue: ReturnType<typeof createConfirmationQueue>): Promise<void> {
  for (let attempt = 0; attempt < 50 && queue.current() === null; attempt += 1) {
    await new Promise((settle) => setImmediate(settle));
  }
}

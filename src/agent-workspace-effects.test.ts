import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  insertBeforeTrailer,
  referencePattern,
  withWorkspaceEffects,
} from "./agent-workspace-effects.ts";
import type { ToolInvocation, ToolInvoker } from "./core/tool-invoker.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const trailer = `\n[evidence record sha256:${"a".repeat(64)} kind tool-call:x]`;

/** A recorder that keeps payloads, standing in for the chain. */
function recorder() {
  const payloads: Record<string, unknown>[] = [];
  const evidence = {
    record: async (entry: { payload: unknown }) => {
      payloads.push(entry.payload as Record<string, unknown>);
      return {} as never;
    },
  } as unknown as EvidenceRecorder;
  return { evidence, payloads };
}

/** An inner invoker that runs a shell action as a function, as the chokepoint would run the tool. */
function inner(effects: Record<string, () => Promise<void>>): ToolInvoker {
  return {
    async invoke(invocation: ToolInvocation) {
      const effect = effects[invocation.callId];
      if (effect === undefined)
        return {
          callId: invocation.callId,
          toolName: invocation.toolName,
          failed: true,
          output: "denied",
        };
      await effect();
      return {
        callId: invocation.callId,
        toolName: invocation.toolName,
        failed: false,
        output: `exit code: 0${trailer}`,
      };
    },
  };
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "swarm-effects-"));
  roots.push(root);
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "t@localhost"], { cwd: root });
  await run("git", ["config", "user.name", "t"], { cwd: root });
  await mkdir(join(root, "lib"));
  await writeFile(join(root, "lib", "wrapThenable.js"), "module.exports = 1\n");
  await writeFile(join(root, "lib", "reply.js"), "const w = require('./wrapThenable')\n");
  await writeFile(join(root, "package.json"), '{"scripts":{"t":"node lib/wrapThenable.js"}}\n');
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-qm", "seed"], { cwd: root });
  return root;
}

const shell = (callId: string): ToolInvocation => ({
  callId,
  toolName: "shell",
  input: { command: "x" },
  provenance: "model",
});

describe("the measured effect of a shell command", () => {
  it("names a move, the references it left behind, and keeps the evidence trailer last", async () => {
    const root = await repository();
    const { evidence, payloads } = recorder();
    const measured = withWorkspaceEffects(
      inner({
        mv: () =>
          rename(join(root, "lib", "wrapThenable.js"), join(root, "lib", "wrap-thenable.js")),
        look: async () => {},
      }),
      {
        workspace: root,
        baseRef: "HEAD",
        evidence,
        measured: new Set(["shell"]),
        writers: new Set(["edit"]),
      },
    );
    try {
      const moved = await measured.invoker.invoke(shell("mv"));
      expect(moved.output).toContain(
        "[workspace after this command: changed R lib/wrapThenable.js -> lib/wrap-thenable.js]",
      );
      expect(moved.output).toContain("[paths this command removed are still named at: ");
      expect(moved.output).toContain("lib/reply.js:1:const w = require('./wrapThenable')");
      expect(moved.output).toContain('package.json:1:{"scripts":{"t":"node lib/wrapThenable.js"}}');
      expect(moved.output).toContain('One edit call with "edits": [{path, find, replace}, ...]');
      expect(moved.output.endsWith(trailer)).toBe(true);
      const looked = await measured.invoker.invoke(shell("look"));
      expect(looked.output).toBe(
        `exit code: 0\n[workspace after this command: unchanged]${trailer}`,
      );
      // A refused call ran nothing and is told nothing.
      const refused = await measured.invoker.invoke(shell("refused"));
      expect(refused.output).toBe("denied");
      expect(payloads.map((one) => [one.rule, one.changeCount])).toEqual([
        ["workspace-effect-v1", 1],
        ["workspace-effect-v1", 0],
        ["workspace-effect-v1", 0],
      ]);
    } finally {
      await measured.close();
    }
  });

  it("says the effect was not measured where the workspace is no repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "swarm-effects-bare-"));
    roots.push(root);
    const { evidence, payloads } = recorder();
    const measured = withWorkspaceEffects(inner({ any: async () => {} }), {
      workspace: root,
      baseRef: "HEAD",
      evidence,
      measured: new Set(["shell"]),
      writers: new Set(),
    });
    const outcome = await measured.invoker.invoke(shell("any"));
    expect(outcome.output).toMatch(/\[workspace after this command: not measured \(.+\)\]/);
    expect(payloads[0]).toMatchObject({
      rule: "workspace-effect-v1",
      unmeasured: expect.any(String),
    });
    await measured.close();
  });

  it("matches a removed file's name only where a path would be written", () => {
    const pattern = new RegExp(
      (referencePattern("lib/fourOhFour.js") ?? "").replace("[:space:]", "\\s"),
    );
    expect(pattern.test("require('./lib/fourOhFour')")).toBe(true);
    expect(pattern.test("'lib/fourOhFour.js',")).toBe(true);
    expect(pattern.test("const fourOhFour = build404()")).toBe(false);
    expect(referencePattern("a/b.js")).toBeNull();
    expect(insertBeforeTrailer("out", "[line]")).toBe("out\n[line]");
  });
});

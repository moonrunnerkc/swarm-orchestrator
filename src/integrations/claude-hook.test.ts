import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHook, invokesTheVerifier, runHook, uninstallHook } from "./claude-hook.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-hook-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = { verifierCommand: "node /opt/swarm-verify.js", stateDirectory: "" };

describe("the Claude Code hook's decisions", () => {
  it("rewrites a recognised test command to the verifier, once, in the tool's own cwd", async () => {
    const outcome = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test", description: "run tests" },
        cwd: "/work/project",
        session_id: "s1",
      },
      { ...options, stateDirectory: root },
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: expect.stringContaining(
          "npm test became node /opt/swarm-verify.js check --workspace /work/project",
        ),
        updatedInput: {
          command: "node /opt/swarm-verify.js check --workspace /work/project",
          description: "run tests",
        },
      },
    });
  });

  it("leaves a command that already invokes the verifier untouched, which is the recursion guard", async () => {
    for (const command of [
      "node /opt/swarm-verify.js check --workspace /w",
      "swarm-verify check",
      "npx swarm-verify",
      "swarm ci --patch x",
    ]) {
      expect(invokesTheVerifier(command), command).toBe(true);
      const outcome = await runHook(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } },
        { ...options, stateDirectory: root },
      );
      expect(outcome.output).toBeNull();
    }
  });

  it("leaves every other command, tool and event alone", async () => {
    for (const input of [
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test -- --watch" },
      },
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
      { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "x" } },
      { hook_event_name: "Stop", stop_hook_active: true },
      "not an object",
      null,
    ]) {
      const outcome = await runHook(input, { ...options, stateDirectory: root });
      expect(outcome.output, JSON.stringify(input)).toBeNull();
      expect(outcome.exitCode).toBe(0);
    }
  });

  it("records the verifier's outcome after it ran, per session, and nothing for other commands", async () => {
    const outcome = await runHook(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "node /opt/swarm-verify.js check --workspace /w" },
        tool_response:
          "checks       passed 4\nresult       regression-only pass: the declared checks passed (exit 0)\n",
        session_id: "s/1",
      },
      { ...options, stateDirectory: root },
    );
    expect(outcome.note).toBe("recorded regression-only pass");
    const state = JSON.parse(await readFile(join(root, "s_1.json"), "utf8")) as { result: string };
    expect(state.result).toBe("regression-only pass");
    const other = await runHook(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_response: "x",
        session_id: "s2",
      },
      { ...options, stateDirectory: root },
    );
    expect(other.note).toBeNull();
  });
});

describe("installing the hook into a settings file", () => {
  it("adds its two entries beside foreign hooks and removes only its own", async () => {
    const settings = join(root, ".claude", "settings.json");
    await writeFile(
      settings,
      `${JSON.stringify(
        {
          model: "x",
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash|Edit",
                hooks: [{ type: "command", command: "/opt/other-hook pretooluse" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    ).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(
        settings,
        `${JSON.stringify(
          {
            model: "x",
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash|Edit",
                  hooks: [{ type: "command", command: "/opt/other-hook pretooluse" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );
    });
    const first = await installHook(settings, "node /opt/swarm-verify.js");
    const second = await installHook(settings, "node /opt/swarm-verify.js");
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    const installed = JSON.parse(await readFile(settings, "utf8")) as {
      model: string;
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    };
    expect(installed.model).toBe("x");
    expect(installed.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe("/opt/other-hook pretooluse");
    expect(installed.hooks.PreToolUse?.[1]?.hooks[0]?.command).toBe(
      "node /opt/swarm-verify.js hook run",
    );
    expect(installed.hooks.PostToolUse?.[0]?.matcher).toBe("Bash");

    const removed = await uninstallHook(settings);
    expect(removed.changed).toBe(true);
    const after = JSON.parse(await readFile(settings, "utf8")) as {
      hooks: Record<string, unknown[]>;
    };
    expect(after.hooks.PostToolUse).toBeUndefined();
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(JSON.stringify(after)).not.toContain("swarm-verify");
    expect((await uninstallHook(settings)).changed).toBe(false);
  });

  it("creates the settings file where none exists and refuses one that is not an object", async () => {
    const settings = join(root, "fresh", "settings.json");
    await installHook(settings, "node /opt/swarm-verify.js");
    expect(JSON.parse(await readFile(settings, "utf8"))).toHaveProperty("hooks.PreToolUse");
    const bad = join(root, "bad.json");
    await writeFile(bad, "[]");
    await expect(installHook(bad, "node /opt/swarm-verify.js")).rejects.toThrow(
      /does not hold a JSON object/,
    );
  });
});

describe("a test command an agent pipes through an output filter", () => {
  it("routes the test stage and keeps plain tail, head and grep filters", async () => {
    const { filteredTestCommand } = await import("./claude-hook.ts");
    expect(filteredTestCommand("npm test 2>&1 | tail -5")).toBe("tail -5");
    expect(filteredTestCommand("npm test | tail -n 20 | grep -i fail")).toBe(
      "tail -n 20 | grep -i fail",
    );
    expect(filteredTestCommand("npm test | head")).toBe("head");
  });

  it("leaves anything else in the pipeline alone", async () => {
    const { filteredTestCommand } = await import("./claude-hook.ts");
    for (const command of [
      "npm test",
      "npm test | sh",
      "npm test | tail -5; rm -rf x",
      "npm test | grep $(whoami)",
      "npm test > out.txt | tail",
      "npm run build | tail -5",
      "npm test | tee log.txt",
    ])
      expect(filteredTestCommand(command)).toBeNull();
  });
});

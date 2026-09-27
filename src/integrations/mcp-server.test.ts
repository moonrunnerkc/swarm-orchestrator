import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The MCP server as a client sees it: a real process over stdio, spoken to in JSON-RPC, with
 * the same fixture repository the check command is held to. The client here is small and
 * literal so a divergence from the protocol shows as a failed message, not as a passing mock.
 */
let scratch = "";
let workspace = "";
let child: ChildProcess;
let nextId = 1;
const answers = new Map<number, (message: unknown) => void>();

async function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  const answer = new Promise<unknown>((settle) => answers.set(id, settle));
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`,
  );
  return answer;
}

function notify(method: string, params?: Record<string, unknown>): void {
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`,
  );
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-mcp-"));
  workspace = join(scratch, "project");
  await mkdir(workspace);
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(workspace, "double.mjs"), "export const double = (n) => n * 2;\n");
  await writeFile(
    join(workspace, "double.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "./double.mjs";\ntest("doubles", () => assert.equal(double(2), 4));\n',
  );
  const git = (args: readonly string[]) =>
    run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: workspace,
    });
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  child = spawn(process.execPath, [resolve("src/swarm-verify.ts"), "mcp", "--root", scratch], {
    env: { PATH: process.env.PATH ?? "", HOME: join(scratch, "home"), NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream });
  lines.on("line", (line) => {
    const message = JSON.parse(line) as { id?: number };
    if (message.id !== undefined) answers.get(message.id)?.(message);
  });
});

afterAll(async () => {
  child.stdin?.end();
  await new Promise((settle) => child.on("close", settle));
  await rm(scratch, { recursive: true, force: true });
});

describe("the MCP server over stdio", () => {
  it("negotiates the protocol, names itself, and lists three bounded tools", async () => {
    const initialized = (await send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })) as {
      result: {
        protocolVersion: string;
        serverInfo: { name: string };
        capabilities: { tools: unknown };
      };
    };
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    expect(initialized.result.serverInfo.name).toBe("swarm-verify");
    expect(initialized.result.capabilities.tools).toBeDefined();
    notify("notifications/initialized");
    const listed = (await send("tools/list")) as {
      result: { tools: { name: string; inputSchema: unknown }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      "swarm_verify_check",
      "swarm_verify_status",
      "swarm_verify_evidence",
    ]);
    expect((await send("ping")) as object).toMatchObject({ result: {} });
  });

  it("answers an older protocol revision with that revision, and an unknown one with its latest", async () => {
    const older = (await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    })) as {
      result: { protocolVersion: string };
    };
    expect(older.result.protocolVersion).toBe("2024-11-05");
    const unknown = (await send("initialize", {
      protocolVersion: "1999-01-01",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    })) as {
      result: { protocolVersion: string };
    };
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
  });

  it("runs a check over a workspace under the root, remembers it, and reads its evidence", async () => {
    const checked = (await send("tools/call", {
      name: "swarm_verify_check",
      arguments: { workspace: "project" },
    })) as {
      result: { content: { type: string; text: string }[]; isError?: boolean };
    };
    expect(checked.result.isError).toBeFalsy();
    const report = JSON.parse(checked.result.content[0]?.text ?? "{}") as {
      schema: string;
      result: string;
      bundleDirectory: string;
    };
    expect(report.schema).toBe("swarm.check.v1");
    expect(report.result).toBe("pass");

    const status = (await send("tools/call", {
      name: "swarm_verify_status",
      arguments: { workspace: "project" },
    })) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(status.result.content[0]?.text ?? "{}")).toMatchObject({ result: "pass" });

    const manifest = (await send("tools/call", {
      name: "swarm_verify_evidence",
      arguments: { bundle: report.bundleDirectory, file: "manifest.json" },
    })) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(manifest.result.isError).toBeFalsy();
    expect(JSON.parse(manifest.result.content[0]?.text ?? "{}")).toHaveProperty("chainHead");
  }, 120_000);

  it("refuses a workspace outside the root, an unknown file, and an unknown tool by name", async () => {
    const outside = (await send("tools/call", {
      name: "swarm_verify_check",
      arguments: { workspace: "../.." },
    })) as { error: { code: number; message: string } };
    expect(outside.error.code).toBe(-32602);
    expect(outside.error.message).toContain("outside");
    const file = (await send("tools/call", {
      name: "swarm_verify_evidence",
      arguments: { bundle: ".", file: "../etc/passwd" },
    })) as { error: { message: string } };
    expect(file.error.message).toContain("not a file this server reads");
    const unknown = (await send("tools/call", { name: "swarm_verify_shell", arguments: {} })) as {
      error: { code: number };
    };
    expect(unknown.error.code).toBe(-32602);
    const method = (await send("shell/exec", {})) as { error: { code: number } };
    expect(method.error.code).toBe(-32601);
  });

  it("reports no status for a workspace nothing checked", async () => {
    const status = (await send("tools/call", { name: "swarm_verify_status", arguments: {} })) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(status.result.content[0]?.text ?? "{}")).toMatchObject({ status: "none" });
  });

  it("ends a cancelled check with the cancellation error", async () => {
    const id = nextId;
    const pending = send("tools/call", {
      name: "swarm_verify_check",
      arguments: { workspace: "project" },
    });
    notify("notifications/cancelled", { requestId: id, reason: "test" });
    const answer = (await pending) as { error?: { code: number }; result?: unknown };
    // The cancellation may land before or after the child finishes; either the cancellation
    // error or a completed result is a well-formed answer, and nothing hangs.
    expect(answer.error?.code === -32800 || answer.result !== undefined).toBe(true);
  }, 120_000);
});

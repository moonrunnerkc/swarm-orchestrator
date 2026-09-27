import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { buildVersion } from "../build-version.ts";

/**
 * A local MCP server over stdio exposing three bounded operations: run a check, read the
 * last result, read a piece of evidence. It speaks the protocol directly (JSON-RPC 2.0,
 * newline-delimited over stdio, revisions 2024-11-05 through 2025-06-18) so the verifier
 * carries no server framework. Operations are constrained to the root the server was started
 * in and to the session store; nothing here runs a shell, and no text a tool returns is read
 * as an instruction by anything in this process. Logging goes to stderr, never stdout.
 */
export const supportedProtocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface McpServerOptions {
  /** The directory operations are confined to. */
  readonly root: string;
  /** The session store evidence may be read from. */
  readonly sessionRoot: string;
  readonly entry: string;
  readonly home: string;
  readonly write: (line: string) => void;
  readonly log: (line: string) => void;
}

const tools = [
  {
    name: "swarm_verify_check",
    description:
      "Run swarm-verify check over a workspace under the server root: discover the declared checks, run them unattended, and return the swarm.check.v1 report. A pass is regression-only; task correctness is unmeasured without a contract.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Directory relative to the server root; defaults to the root.",
        },
        packages: {
          type: "array",
          items: { type: "string" },
          description: "Repository-relative package directories to check by name.",
        },
        explain: { type: "boolean", description: "Print the plan and run nothing." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "swarm_verify_status",
    description:
      "The last swarm_verify_check report this server produced for a workspace, or none.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Directory relative to the server root; defaults to the root.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "swarm_verify_evidence",
    description:
      "Read one file of an evidence bundle: manifest.json, summary.md, report.json or verdict.json, from a bundle under the session store or the server root. Bounded to 64 KB.",
    inputSchema: {
      type: "object",
      properties: {
        bundle: {
          type: "string",
          description: "Bundle directory, as a check report's bundleDirectory names it.",
        },
        file: {
          type: "string",
          enum: ["manifest.json", "summary.md", "report.json", "verdict.json", "ledger.jsonl"],
        },
      },
      required: ["bundle", "file"],
      additionalProperties: false,
    },
  },
] as const;

class ToolError extends Error {}

function text(value: unknown): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function within(root: string, candidate: string): Promise<string> {
  const target = await realpath(resolve(root, candidate)).catch(() => null);
  const base = await realpath(root).catch(() => root);
  if (target === null) throw new ToolError(`${candidate} does not exist under ${root}`);
  const inside = relative(base, target);
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) return target;
  throw new ToolError(`${candidate} is outside ${root}, which this server is confined to`);
}

/** Serve until stdin closes. */
export async function serveMcp(options: McpServerOptions): Promise<void> {
  const inFlight = new Map<number | string, AbortController>();
  const lastReports = new Map<string, string>();
  let initialized = false;

  const respond = (id: JsonRpcRequest["id"], result: unknown) =>
    options.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) =>
    options.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code, message, ...(data === undefined ? {} : { data }) },
      }),
    );

  const callTool = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    if (name === "swarm_verify_check") {
      const workspace = await within(
        options.root,
        typeof args.workspace === "string" ? args.workspace : ".",
      );
      const argv = [options.entry, "check", "--workspace", workspace, "--json"];
      if (args.explain === true) argv.push("--explain");
      for (const unit of Array.isArray(args.packages) ? args.packages : []) {
        if (typeof unit !== "string" || !/^[A-Za-z0-9_./-]+$/.test(unit) || unit.includes(".."))
          throw new ToolError("packages must be plain relative directory names");
        argv.push("--package", unit);
      }
      const ran = await runChild(process.execPath, argv, options.home, signal);
      const line =
        ran.stdout
          .trim()
          .split("\n")
          .findLast((one) => one.startsWith("{")) ?? "";
      if (line.length === 0)
        return failure(
          `the verifier exited ${ran.code} without a report${ran.stderr.length > 0 ? `: ${ran.stderr.slice(-1000)}` : ""}`,
        );
      lastReports.set(workspace, line);
      return { ...text(line), isError: ran.code === 2 || ran.code === 5 };
    }
    if (name === "swarm_verify_status") {
      const workspace = await within(
        options.root,
        typeof args.workspace === "string" ? args.workspace : ".",
      );
      const report = lastReports.get(workspace);
      return report === undefined ? text({ status: "none", workspace }) : text(report);
    }
    if (name === "swarm_verify_evidence") {
      if (typeof args.bundle !== "string" || typeof args.file !== "string")
        throw new ToolError("bundle and file are required");
      const file = args.file;
      if (
        !["manifest.json", "summary.md", "report.json", "verdict.json", "ledger.jsonl"].includes(
          file,
        )
      )
        throw new ToolError(`${file} is not a file this server reads`);
      let bundle: string;
      try {
        bundle = await within(options.sessionRoot, args.bundle);
      } catch {
        bundle = await within(options.root, args.bundle);
      }
      const path = join(bundle, file);
      const size = (await stat(path).catch(() => null))?.size ?? null;
      if (size === null) return failure(`${file} is not in ${bundle}`);
      const bytes = await readFile(path, "utf8");
      return text(
        bytes.length > 65_536
          ? `${bytes.slice(0, 65_536)}\n[truncated at 64 KB of ${size} bytes]`
          : bytes,
      );
    }
    throw new ToolError(`unknown tool ${name}`);
  };

  const handle = async (message: JsonRpcRequest) => {
    const { id, method, params } = message;
    if (method === "notifications/initialized") {
      initialized = true;
      return;
    }
    if (method === "notifications/cancelled") {
      const requestId = (params as { requestId?: number | string } | undefined)?.requestId;
      if (requestId !== undefined) inFlight.get(requestId)?.abort();
      return;
    }
    if (id === undefined || id === null) return;
    if (method === "initialize") {
      const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
      const protocolVersion = (supportedProtocolVersions as readonly string[]).includes(
        requested ?? "",
      )
        ? (requested as string)
        : supportedProtocolVersions[0];
      respond(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "swarm-verify", version: buildVersion },
        instructions:
          "Three bounded tools over the verifier: swarm_verify_check runs the declared checks of a workspace under the server root and returns the report; swarm_verify_status returns the last report; swarm_verify_evidence reads one bundle file. A regression pass says nothing broke, not that the task was done.",
      });
      return;
    }
    if (method === "ping") {
      respond(id, {});
      return;
    }
    if (!initialized && method !== "tools/list")
      options.log(`request ${method} before initialized`);
    if (method === "tools/list") {
      respond(id, { tools });
      return;
    }
    if (method === "tools/call") {
      const name = (params as { name?: string } | undefined)?.name;
      const args = ((params as { arguments?: Record<string, unknown> } | undefined)?.arguments ??
        {}) as Record<string, unknown>;
      if (typeof name !== "string" || !tools.some((tool) => tool.name === name)) {
        fail(id, -32602, `unknown tool ${String(name)}`);
        return;
      }
      const controller = new AbortController();
      inFlight.set(id, controller);
      try {
        respond(id, await callTool(name, args, controller.signal));
      } catch (cause) {
        if (controller.signal.aborted) fail(id, -32800, "request cancelled");
        else if (cause instanceof ToolError) fail(id, -32602, cause.message);
        else fail(id, -32603, cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight.delete(id);
      }
      return;
    }
    fail(id, -32601, `method not found: ${method}`);
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  const pending: Promise<void>[] = [];
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcRequest;
    } catch {
      fail(null, -32700, "parse error");
      continue;
    }
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      fail(message.id ?? null, -32600, "invalid request");
      continue;
    }
    const task = handle(message).catch((cause) =>
      options.log(`unhandled: ${cause instanceof Error ? cause.message : String(cause)}`),
    );
    pending.push(task);
  }
  for (const controller of inFlight.values()) controller.abort();
  await Promise.allSettled(pending);
}

function runChild(
  file: string,
  args: readonly string[],
  home: string,
  signal: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((settle) => {
    const child = spawn(file, [...args], {
      env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      settle({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (cause) => {
      signal.removeEventListener("abort", onAbort);
      settle({ code: 5, stdout, stderr: `${stderr}${cause.message}` });
    });
  });
}

/** The tool catalogue, for a reader who wants it without a session. */
export function describeTools(): string {
  return tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n");
}

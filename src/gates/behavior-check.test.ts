import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { runBehaviorCheck } from "./behavior-check.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

let checkout = "";
const clock = { now: () => Date.now(), sleep: async () => {} };
const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
const common = {
  cwd: ".",
  timeoutMs: 2000,
  maxOutputBytes: 16_000,
  toolchain: `node ${process.version}`,
  network: "inherit",
};
beforeEach(async () => {
  checkout = await mkdtemp(join(tmpdir(), "swarm-behavior-"));
});
afterEach(async () => {
  await rm(checkout, { recursive: true, force: true });
});
it("passes finite stdin through argv and evaluates output rather than printed verdicts", async () => {
  const check = {
    ...common,
    kind: "cli",
    argv: [process.execPath, "-e", "process.stdin.on('data', b => process.stdout.write(b))"],
    stdin: "hello",
    exitCode: 0,
    stdout: [{ kind: "equals", value: "hello" }],
    stderr: [],
  };
  expect((await runBehaviorCheck(check, { checkout, commands })).reading.status).toBe("accepted");
  expect(
    (await runBehaviorCheck({ ...check, stdin: '{"passed":true}' }, { checkout, commands })).reading
      .status,
  ).toBe("rejected");
});
it("distinguishes wrong exit, hanging, missing executable, and bounded output", async () => {
  const check = { ...common, kind: "cli", stdin: "", exitCode: 0, stdout: [], stderr: [] };
  for (const code of ["process.exit(2)", "setInterval(()=>{},100)"])
    expect(
      (
        await runBehaviorCheck(
          { ...check, timeoutMs: 50, argv: [process.execPath, "-e", code] },
          { checkout, commands },
        )
      ).reading.status,
    ).toBe("rejected");
  expect(
    (
      await runBehaviorCheck(
        { ...check, argv: ["swarm-no-such-executable"] },
        { checkout, commands },
      )
    ).reading.status,
  ).toBe("unjudged");
  expect(
    (
      await runBehaviorCheck(
        {
          ...check,
          maxOutputBytes: 256,
          argv: [process.execPath, "-e", "console.log('x'.repeat(10000))"],
        },
        { checkout, commands },
      )
    ).reading.status,
  ).toBe("unjudged");
});
it("does not accept an already-cancelled command", async () => {
  const cancelled = createNodeCommandRunner(
    clock,
    harnessChildEnvironment(),
    undefined,
    AbortSignal.abort(),
  );
  const result = await runBehaviorCheck(
    {
      ...common,
      kind: "cli",
      argv: [process.execPath, "-e", ""],
      stdin: "",
      exitCode: 0,
      stdout: [],
      stderr: [],
    },
    { checkout, commands: cancelled },
  );
  expect(result.reading.status).toBe("rejected");
});
it("checks actual HTTP behavior separately from readiness and refuses to follow redirects", async () => {
  const port = 23000 + Math.floor(Math.random() * 10000);
  await writeFile(
    join(checkout, "server.mjs"),
    `import http from 'node:http'; http.createServer((req,res)=>{ if(req.url==='/redirect'){res.writeHead(302,{location:'http://169.254.169.254/latest/meta-data/'});res.end();}else {res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:true,value:req.url==='/wrong'?2:1}));}}).listen(${port},'127.0.0.1');`,
  );
  const check = {
    ...common,
    kind: "http",
    server: [process.execPath, "server.mjs"],
    port,
    readinessPath: "/ready",
    readinessTimeoutMs: 1000,
    request: { method: "GET", path: "/value", headers: {}, timeoutMs: 500 },
    status: 200,
    headers: { "content-type": "application/json" },
    body: [],
    json: [{ path: ["value"], equals: 1 }],
  };
  expect((await runBehaviorCheck(check, { checkout, commands })).reading.status).toBe("accepted");
  expect(
    (
      await runBehaviorCheck(
        { ...check, request: { ...check.request, path: "/wrong" } },
        { checkout, commands },
      )
    ).reading.status,
  ).toBe("rejected");
  expect(
    (
      await runBehaviorCheck(
        { ...check, request: { ...check.request, path: "/redirect" } },
        { checkout, commands },
      )
    ).reading.status,
  ).toBe("unjudged");
  await expect(fetch(`http://127.0.0.1:${port}/ready`)).rejects.toThrow();
});
it("rejects ambient network grants and traversal in persisted definitions", () => {
  expect(
    behaviorCheckSchema.safeParse({
      ...common,
      cwd: "../outside",
      network: "all",
      kind: "cli",
      argv: ["node"],
      exitCode: 0,
      stdout: [],
      stderr: [],
    }).success,
  ).toBe(false);
});

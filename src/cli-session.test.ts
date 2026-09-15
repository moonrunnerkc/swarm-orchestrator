import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { harnessChildEnvironment } from "./exec/child-environment.ts";

it("loads help without calibration or terminal rendering", async () => {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'ink' || specifier.includes('/select/calibrate.') || specifier.endsWith('/cli-calibrate.ts'))
        throw new Error('command discovery loaded an inactive feature: ' + specifier);
      return next(specifier, context);
    }});
    process.argv = [process.execPath, ${JSON.stringify(resolve("src/cli.ts"))}, '--help'];
    await import(${JSON.stringify(resolve("src/cli.ts"))});
  `;
  const response = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      env: harnessChildEnvironment().variables,
      timeout: 10000,
    },
  );
  expect(response.stdout).toContain("swarm parallel");
  expect(response.stdout).toContain("swarm calibrate");
  expect(response.stderr).toBe("");
});
it("retains successive tasks already buffered on a pipe and closes at EOF", async () => {
  const script = `
    import { startInterface, closeTaskReader } from ${JSON.stringify(resolve("src/cli-terminal.ts"))};
    import { settingsFor, noFlagSettings } from ${JSON.stringify(resolve("src/cli-run-settings.ts"))};
    import { createSystemClock } from ${JSON.stringify(resolve("src/cli-runtime-inputs.ts"))};
    const ui = await startInterface({ task: '', workspace: process.cwd(),
      settings: await settingsFor(process.cwd(), noFlagSettings), clock: createSystemClock() });
    try { console.log(JSON.stringify([await ui.readTask(), await ui.readTask(), await ui.readTask()])); }
    finally { await ui.stop(); closeTaskReader(); }
  `;
  const response = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (settle, fail) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        env: harnessChildEnvironment().variables,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", fail);
      child.on("close", (code) => settle({ code, stdout, stderr }));
      child.stdin.end("first task\nsecond task\n");
    },
  );
  expect(response).toEqual({ code: 0, stdout: '["first task","second task",null]\n', stderr: "" });
});

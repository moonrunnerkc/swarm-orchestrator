import { spawn } from "node:child_process";
import { createServer } from "node:net";

const check = JSON.parse(process.argv[1]);
const origin = `http://127.0.0.1:${check.port}`;
const available = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(check.port, "127.0.0.1", () => probe.close(() => resolve(true)));
});
if (!available) {
  process.stdout.write(
    JSON.stringify({
      unavailable: "configured local port is already occupied; choose an unused test port",
    }),
  );
  process.exit(0);
}
const server = spawn(check.server[0], check.server.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let startupFailure = null;
let serverOutput = "";
server.on("error", (error) => {
  startupFailure = error.message;
});
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-8192);
  });
let observation;
try {
  const deadline = Date.now() + check.readinessTimeoutMs;
  let ready = false;
  while (!ready && Date.now() < deadline && startupFailure === null && server.exitCode === null) {
    try {
      const response = await fetch(origin + check.readinessPath, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))),
      });
      ready = response.status >= 200 && response.status < 300;
      await response.body?.cancel();
    } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!ready)
    observation = {
      unavailable:
        startupFailure ??
        "application readiness failed; inspect the declared server command and port",
      serverOutput,
    };
  else {
    const response = await fetch(origin + check.request.path, {
      method: check.request.method,
      headers: check.request.headers,
      ...(check.request.body === undefined ? {} : { body: check.request.body }),
      redirect: "manual",
      signal: AbortSignal.timeout(check.request.timeoutMs),
    });
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > check.maxOutputBytes / 2) {
        truncated = true;
        break;
      }
      chunks.push(Buffer.from(chunk));
    }
    observation = {
      unavailable: null,
      status: response.status,
      headers: Object.fromEntries(
        Object.keys(check.headers).map((name) => [name, response.headers.get(name)]),
      ),
      body: Buffer.concat(chunks).toString("utf8"),
      truncated,
      request: check.request,
      serverOutput,
    };
  }
} catch (error) {
  observation = { unavailable: null, failure: error.message, serverOutput };
} finally {
  if (server.pid) server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (server.pid && server.exitCode === null) server.kill("SIGKILL");
}
process.stdout.write(JSON.stringify(observation));

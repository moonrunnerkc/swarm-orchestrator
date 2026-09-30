import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeAcceptanceMaterial } from "./acceptance-material.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const limits = {
  cwd: ".",
  timeoutMs: 20_000,
  maxOutputBytes: 64_000,
  toolchain: "node",
  network: "inherit",
};
const server = (header) =>
  `import { createServer } from "node:http";\ncreateServer((request, response) => { response.writeHead(200, { "content-type": "text/plain", "cache-control": ${JSON.stringify(header)} }); response.end("hello site"); }).listen(Number(process.argv[2]), "127.0.0.1");\n`;

/** A contract of one CLI check, one HTTP check and one command check, run as plain CI runs it. */
function run(header, port) {
  const root = mkdtempSync(join(tmpdir(), "campaign-visible-"));
  roots.push(root);
  mkdirSync(join(root, "acceptance/visible"), { recursive: true });
  const contract = {
    checks: [
      {
        id: "prints",
        command: "cli",
        artifacts: [],
        behavior: {
          kind: "cli",
          ...limits,
          argv: ["node", "-e", "console.log(2 + 2)"],
          stdin: "",
          exitCode: 0,
          stdout: [{ kind: "equals", value: "4\n" }],
          stderr: [],
        },
      },
      {
        id: "serves",
        command: "http",
        artifacts: [{ path: "acceptance/visible/server.mjs", content: server(header) }],
        behavior: {
          kind: "http",
          ...limits,
          server: ["node", "acceptance/visible/server.mjs", String(port)],
          port,
          readinessPath: "/",
          readinessTimeoutMs: 10_000,
          request: { method: "GET", path: "/", headers: {}, timeoutMs: 5_000 },
          status: 200,
          headers: { "cache-control": "no-store" },
          body: [{ kind: "contains", value: "hello" }],
          json: [],
        },
      },
      { id: "command", command: "node -e 'process.exit(0)'", artifacts: [] },
    ],
  };
  writeAcceptanceMaterial(root, contract);
  const ran = spawnSync(
    process.execPath,
    [
      ".campaign/visible-runner.mjs",
      ".campaign/contract.json",
      "--json",
      ".campaign/readings.json",
    ],
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );
  return {
    code: ran.status,
    readings: JSON.parse(readFileSync(join(root, ".campaign/readings.json"), "utf8")),
  };
}

describe("the visible checks as plain CI runs them", () => {
  it("passes CLI, HTTP and command checks that hold, through the verifier's own HTTP runner", () => {
    const { code, readings } = run("no-store", 47_611);
    expect(readings.map((one) => [one.id, one.passed])).toEqual([
      ["prints", true],
      ["serves", true],
      ["command", true],
    ]);
    expect(code).toBe(0);
  });

  it("fails an HTTP check whose named header differs, and exits non-zero", () => {
    const { code, readings } = run("max-age=60", 47_612);
    expect(readings.find((one) => one.id === "serves")?.passed).toBe(false);
    expect(code).toBe(1);
  });

  it("reads committed acceptance files without writing them again", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-visible-"));
    roots.push(root);
    const contract = {
      checks: [
        {
          id: "file",
          command: "node acceptance/visible/check.mjs",
          artifacts: [{ path: "acceptance/visible/check.mjs", content: "process.exit(0);\n" }],
        },
      ],
    };
    writeAcceptanceMaterial(root, contract);
    writeFileSync(join(root, "acceptance/visible/check.mjs"), "process.exit(3);\n");
    const ran = spawnSync(
      process.execPath,
      [".campaign/visible-runner.mjs", ".campaign/contract.json", "--from-tree"],
      { cwd: root, encoding: "utf8" },
    );
    expect(ran.status).toBe(1);
  });
});

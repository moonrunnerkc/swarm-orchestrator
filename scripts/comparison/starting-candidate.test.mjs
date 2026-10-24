import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startScriptedEndpoint } from "../../src/providers/scripted-endpoint.ts";
import { candidateFiles, replayTurns, startCandidateProxy } from "./starting-candidate.mjs";

const scratches = [];
afterEach(() => {
  for (const one of scratches.splice(0)) rmSync(one, { recursive: true, force: true });
});

function repository() {
  const directory = mkdtempSync(join(tmpdir(), "starting-candidate-"));
  scratches.push(directory);
  const git = (...args) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  writeFileSync(join(directory, "a.js"), "export const a = 1;\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  return { directory, git };
}

it("reads a candidate's files from its patch and leaves the base as it was", () => {
  const { directory, git } = repository();
  writeFileSync(join(directory, "a.js"), "export const a = 2;\n");
  writeFileSync(join(directory, "b.js"), "export const b = 3;\n");
  git("add", "-A");
  const patch = git("diff", "--cached").stdout;
  git("reset", "-q", "--hard");
  git("clean", "-qfd");
  const files = candidateFiles(directory, Buffer.from(patch), directory);
  expect(files).toEqual({ "a.js": "export const a = 2;\n", "b.js": "export const b = 3;\n" });
  expect(readFileSync(join(directory, "a.js"), "utf8")).toBe("export const a = 1;\n");
  expect(git("status", "--porcelain").stdout).toBe("");
  expect(replayTurns(files).map((one) => one.toolCalls?.[0]?.name ?? "text")).toEqual([
    "declare_file_set",
    "write",
    "write",
    "text",
  ]);
});

it("refuses a candidate that deletes a file", () => {
  const { directory, git } = repository();
  git("rm", "-q", "a.js");
  const patch = git("diff", "--cached").stdout;
  git("reset", "-q", "--hard");
  expect(() => candidateFiles(directory, Buffer.from(patch), directory)).toThrow(/deletes/);
});

it("answers the replay first and forwards every later completion upstream", async () => {
  const upstream = await startScriptedEndpoint({
    modelId: "m",
    turns: [{ text: "from upstream" }],
  });
  const proxy = await startCandidateProxy({
    files: { "a.js": "x" },
    upstream: upstream.url,
    model: "m",
  });
  try {
    const chat = () =>
      fetch(`${proxy.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }),
      }).then((response) => response.text());
    for (let index = 0; index < proxy.replayTurns; index += 1) await chat();
    expect(await chat()).toContain("from upstream");
    expect(proxy.routed().map((one) => one.route)).toEqual([
      "replay",
      "replay",
      "replay",
      "upstream",
    ]);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

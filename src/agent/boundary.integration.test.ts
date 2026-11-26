import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isDependencyInstall } from "../tools/executor.ts";
import { authoredHalf, bash, fixture, isolatedParent, scripted, write } from "./test-doubles.ts";

/**
 * The boundary the model's commands run in, through a whole run with scripted replies. The
 * commands reach for a synthetic secret in the session store and for a path outside the
 * workspace by building the path in an interpreter, where the path policy cannot read it.
 */
afterAll(async () => {
  await rm(isolatedParent, { recursive: true, force: true });
});

const secret = "synthetic-key-91c7";
/** Paths built at run time from HOME, which is three levels inside the store the run must not reach. */
const steal =
  "node -e \"const fs=require('fs'),p=require('path');const up=p.resolve(process.env.HOME,'..','..','..');try{console.log(String(fs.readFileSync(p.join(up,'trusted-material'))))}catch(e){console.log('read refused '+e.code)};try{fs.writeFileSync(p.join(up,'..','escaped.txt'),'x');console.log('wrote outside')}catch(e){console.log('write refused '+e.code)}\"";
const fixed = [
  bash(steal),
  write("half.mjs", "export const half = (n) => n / 2;"),
  "SWARM_TASK_COMPLETE",
];

async function attacked(isolation: "isolated" | "host") {
  const probe = await fixture({}, undefined, isolation);
  await mkdir(join(probe.root, "home"), { recursive: true });
  await writeFile(join(probe.root, "home", "trusted-material"), secret);
  const model = scripted(fixed, { author: [authoredHalf] });
  const ran = await probe.run(model);
  const said = model.seen
    .flat()
    .map((message) => message.content)
    .join("\n");
  return { probe, ran, said };
}

describe("the model's commands", () => {
  it("run in a container that holds neither the session store nor anything outside the workspace", async () => {
    const { probe, ran, said } = await attacked("isolated");
    expect(said).toContain("read refused ENOENT");
    // The directories above the mounts exist in the container, empty and not the user's to write.
    expect(said).toMatch(/write refused E(?:NOENT|ACCES|ROFS)/);
    expect(said).not.toContain(secret);
    expect(existsSync(join(probe.root, "escaped.txt"))).toBe(false);
    expect(ran.report.state).toBe("complete");
    expect(ran.report.commands).toMatch(
      /^isolated: each command in a container of node:24@sha256:/,
    );
  });

  it("on the host, asked for, reach what the user's account reaches, and the report says host", async () => {
    const { probe, ran, said } = await attacked("host");
    expect(said).toContain(secret);
    expect(existsSync(join(probe.root, "escaped.txt"))).toBe(true);
    expect(ran.report.commands).toMatch(/^host, not isolated/);
  });

  it("do not run at all where no container can be made, and nothing falls back to the host", async () => {
    const saved = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///nonexistent/docker.sock";
    try {
      const probe = await fixture({}, undefined, "isolated");
      const model = scripted(fixed, { author: [authoredHalf] });
      const ran = await probe.run(model);
      expect(ran.stop).toBe("blocked");
      expect(ran.report.state).toBe("blocked");
      expect(ran.report.reason).toMatch(
        /isolated execution is not available.*Start docker.*or pass --host.*host, not isolated/,
      );
      expect(model.seen).toEqual([]);
      expect(existsSync(join(probe.root, "escaped.txt"))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = saved;
    }
  });
});

describe("the dependency stage", () => {
  it("opens for one package manager's install and nothing joined to it", () => {
    const opened = (command: string) => isDependencyInstall(command);
    expect(
      ["npm ci", "npm install left-pad", "pnpm add zod", "pip install requests", "uv sync"].map(
        opened,
      ),
    ).toEqual([true, true, true, true, true]);
    expect(
      [
        "npm install left-pad && node steal.js",
        "npm test",
        "npm run install",
        "node install.js",
        "npm install $(cat names)",
        "curl https://example.com",
      ].map(opened),
    ).toEqual([false, false, false, false, false, false]);
  });
});

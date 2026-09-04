import { describe, expect, it } from "vitest";
import { detectProject } from "../gates/project-type.ts";
import {
  initializeSwarmToml,
  initWouldHelp,
  planGates,
  renderSwarmToml,
  SwarmTomlExistsError,
} from "./init.ts";
import { parseSwarmToml } from "./swarm-toml.ts";

async function detected(scripts: Readonly<Record<string, string>>) {
  const manifest = JSON.stringify({ scripts });
  return detectProject((path) => Promise.resolve(path === "package.json" ? manifest : null));
}

describe("planning gates from package.json scripts", () => {
  it("writes a gate for each of test, lint, typecheck and build, from the script it came from", async () => {
    const plan = planGates(
      await detected({
        test: "node --test",
        lint: "biome check",
        typecheck: "tsc --noEmit",
        build: "tsc -p tsconfig.build.json",
      }),
    );

    expect(
      plan.map((gate) => [gate.id, gate.script, gate.command, gate.parser, gate.severity]),
    ).toEqual([
      ["tests", "test", "npm run --silent test", "test-output", "blocking"],
      ["lint", "lint", "npm run --silent lint", "exit-code", "blocking"],
      ["typecheck", "typecheck", "npm run --silent typecheck", "exit-code", "blocking"],
      ["build", "build", "npm run --silent build", "exit-code", "blocking"],
    ]);
    expect(plan.every((gate) => gate.reason === null)).toBe(true);
  });

  it("reads vitest's summary with the test-output rule", async () => {
    const [tests] = planGates(await detected({ test: "vitest run" }));

    expect(tests).toMatchObject({ parser: "test-output", severity: "blocking", reason: null });
  });

  it("writes a test script whose runner it has no parser for as advisory, and says why", async () => {
    const [tests] = planGates(await detected({ test: "jest --ci" }));

    expect(tests).toMatchObject({ parser: "exit-code", severity: "advisory" });
    expect(tests?.reason).toBe(
      "the harness has no parser for jest's output, so this gate reads the exit code only and is advisory",
    );
  });

  it("takes the spelling the harness itself detects, so type-check and tsc count as typecheck", async () => {
    const plan = planGates(await detected({ "type-check": "tsc --noEmit" }));

    expect(plan.map((gate) => [gate.id, gate.script])).toEqual([["typecheck", "type-check"]]);
  });

  it("writes nothing for a script that is not declared", async () => {
    expect(planGates(await detected({ start: "node server.js" }))).toEqual([]);
  });
});

describe("the rendered file", () => {
  it("parses back to the same overrides, with the script named above each line", async () => {
    const detection = await detected({ test: "jest", lint: "eslint ." });
    const text = renderSwarmToml(planGates(detection), detection);

    expect(text).toContain("# from package.json scripts.test: jest");
    expect(text).toContain("# the harness has no parser for jest's output");
    expect(text).toContain("# from package.json scripts.lint: eslint .");
    expect(parseSwarmToml(text, "swarm.toml").gates).toEqual({
      tests: { command: "npm run --silent test", parser: "exit-code", severity: "advisory" },
      lint: { command: "npm run --silent lint", parser: "exit-code" },
    });
  });

  it("keeps a script body from breaking out of its comment", async () => {
    const detection = await detected({ lint: "eslint .\n[budgets]\nmax_steps = 1" });
    const text = renderSwarmToml(planGates(detection), detection);

    expect(parseSwarmToml(text, "swarm.toml").budgets.maxSteps).toBeNull();
  });

  it("says so where there is no package.json, and still parses", async () => {
    const detection = await detectProject(() => Promise.resolve(null));
    const text = renderSwarmToml([], detection);

    expect(text).toContain("no package.json in this directory");
    expect(parseSwarmToml(text, "swarm.toml").gates).toEqual({});
  });
});

describe("initializeSwarmToml", () => {
  function memory(files: Record<string, string>) {
    return {
      workspace: "/repo",
      exists: (path: string) => Promise.resolve(path in files),
      readFile: (path: string) => Promise.resolve(files[path] ?? null),
      writeFile: (path: string, text: string) => {
        files[path] = text;
        return Promise.resolve();
      },
    };
  }

  it("writes the file and reports the gates it declared", async () => {
    const files: Record<string, string> = {
      "/repo/package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    };

    const outcome = await initializeSwarmToml(memory(files));

    expect(outcome.path).toBe("/repo/swarm.toml");
    expect(outcome.gates.map((gate) => gate.id)).toEqual(["tests"]);
    expect(files["/repo/swarm.toml"]).toContain('tests = { command = "npm run --silent test"');
  });

  it("refuses to overwrite a file that exists, and never edits one", async () => {
    const files: Record<string, string> = { "/repo/swarm.toml": "[gates]\n" };

    await expect(initializeSwarmToml(memory(files))).rejects.toBeInstanceOf(SwarmTomlExistsError);
    expect(files["/repo/swarm.toml"]).toBe("[gates]\n");
  });

  it("is offered on a first run only where there is a manifest and no file yet", async () => {
    expect(await initWouldHelp(memory({ "/repo/package.json": "{}" }))).toBe(true);
    expect(await initWouldHelp(memory({}))).toBe(false);
    expect(
      await initWouldHelp(memory({ "/repo/package.json": "{}", "/repo/swarm.toml": "" })),
    ).toBe(false);
  });
});

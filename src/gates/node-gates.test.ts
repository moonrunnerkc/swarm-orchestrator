import { describe, expect, it } from "vitest";
import { nodeGates } from "./node-gates.ts";

describe("assembling the Node checks", () => {
  /**
   * pnpm installs the lockfile through a fetched copy and is not in a trusted image; a check
   * composed as `pnpm run` read "the command is not installed" on every pnpm project rolled
   * out, while the exact `vitest run` test script, run in process, passed beside them.
   */
  it("runs the manifest's scripts through npm whichever manager installed the lockfile", () => {
    const gates = nodeGates(
      {
        types: ["node"],
        manifests: ["package.json"],
        nodeManager: "pnpm",
        nodeScripts: ["test", "typecheck", "build"],
        nodeScriptCommands: {
          test: "vitest run --coverage",
          typecheck: "tsc --noEmit",
          build: "tsc",
        },
        pythonTools: [],
      },
      "v24.0.0",
    );
    const commands = gates.map((gate) => [
      gate.id,
      gate.source.kind === "command" ? gate.source.command : gate.source.kind,
    ]);
    expect(commands).toContainEqual(["typecheck", "npm run --silent typecheck"]);
    expect(commands).toContainEqual(["build", "npm run --silent build"]);
    expect(commands.find(([id]) => id === "tests")?.[1]).toBe("npm run --silent test");
    expect(commands.every(([, command]) => !String(command).startsWith("pnpm"))).toBe(true);
  });

  /**
   * depose's `typecheck` is `pnpm -r run typecheck`, and each package's `tsc --noEmit` resolves
   * its workspace dependencies through the `dist/index.d.ts` only `build` writes. Its CI builds
   * first; a typecheck run before the build failed on a clean tree.
   */
  it("builds before every check that can read build output", () => {
    const gates = nodeGates(
      {
        types: ["node"],
        manifests: ["package.json"],
        nodeManager: "pnpm",
        nodeScripts: ["test", "typecheck", "lint", "format:check", "build"],
        nodeScriptCommands: {
          test: "vitest run --coverage",
          typecheck: "pnpm -r run typecheck",
          lint: "eslint .",
          "format:check": "prettier --check .",
          build: "tsc --build",
        },
        pythonTools: [],
      },
      "v24.0.0",
    );
    expect(gates.map((gate) => gate.id)).toEqual(["build", "typecheck", "lint", "format", "tests"]);
    // Without a build script nothing moves: the remaining checks keep their order.
    const unbuilt = nodeGates(
      {
        types: ["node"],
        manifests: ["package.json"],
        nodeScripts: ["test", "typecheck"],
        nodeScriptCommands: { test: "vitest run", typecheck: "tsc --noEmit" },
        pythonTools: [],
      },
      "v24.0.0",
    );
    expect(unbuilt.map((gate) => gate.id)).toEqual(["typecheck", "lint", "format", "tests"]);
  });
});

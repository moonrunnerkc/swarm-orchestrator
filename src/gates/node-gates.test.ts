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
});

import { describe, expect, it } from "vitest";
import { assembleGates, scriptBodyBehind } from "./default-gates.ts";
import { detectProject } from "./project-type.ts";

async function detected(scripts: Readonly<Record<string, string>>) {
  const manifest = JSON.stringify({ scripts });
  return detectProject((path) => Promise.resolve(path === "package.json" ? manifest : null));
}

describe("an override written as a table", () => {
  it("sets the severity and the rule the record names", async () => {
    const gates = assembleGates(await detected({ test: "jest" }), {
      commandOverrides: {
        tests: { command: "npm run --silent test", severity: "advisory", parser: "exit-code" },
      },
    });
    const tests = gates.find((gate) => gate.id === "tests");

    expect(tests).toMatchObject({ severity: "advisory", parserName: "exit-code" });
    expect(tests?.source).toMatchObject({ kind: "command", command: "npm run --silent test" });
  });

  it("adds a gate under an id the assembled set has no slot for", async () => {
    const gates = assembleGates(await detected({ build: "tsc -p tsconfig.build.json" }), {
      commandOverrides: { build: "npm run --silent build" },
    });
    const build = gates.find((gate) => gate.id === "build");

    expect(build).toMatchObject({ severity: "blocking", parserName: "exit-code" });
    expect(build?.source).toMatchObject({ kind: "command", command: "npm run --silent build" });
  });

  it("keeps the id's own rule where the table names none", async () => {
    const gates = assembleGates(await detected({ test: "vitest run" }), {
      commandOverrides: { tests: { command: "npm run --silent test" } },
    });

    expect(gates.find((gate) => gate.id === "tests")?.parserName).toBe("test-output");
  });
});

describe("an override that runs a script by name", () => {
  it("is vouched for by the script's body, so node's runner still gets the harness's reporters", async () => {
    const detection = await detected({ test: "node --test" });
    const gates = assembleGates(detection, {
      commandOverrides: { tests: "npm run --silent test" },
    });
    const tests = gates.find((gate) => gate.id === "tests");

    expect(scriptBodyBehind("npm run --silent test", detection)).toBe("node --test");
    expect(scriptBodyBehind("npm test", detection)).toBe("node --test");
    expect(scriptBodyBehind("npm run test:fast", detection)).toBeNull();
    expect(tests?.source.kind === "command" ? tests.source.argv : undefined).toContain(
      "--test-isolation=process",
    );
  });
});

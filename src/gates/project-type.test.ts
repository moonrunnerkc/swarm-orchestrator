import { describe, expect, it } from "vitest";
import { assembleGates } from "./default-gates.ts";
import type { GateDefinition } from "./gate-definition.ts";
import { detectProject, type ManifestReader } from "./project-type.ts";

function reader(files: Readonly<Record<string, string>>): ManifestReader {
  return (path) => Promise.resolve(files[path] ?? null);
}

function commandOf(gates: readonly GateDefinition[], id: string): string | null {
  const gate = gates.find((candidate) => candidate.id === id);
  return gate?.source.kind === "command" ? gate.source.command : null;
}

describe("project type detection", () => {
  it("detects a node project and the scripts its manifest declares", async () => {
    const detection = await detectProject(
      reader({
        "package.json": JSON.stringify({
          scripts: { test: "vitest run", lint: "biome check", typecheck: "tsc --noEmit" },
        }),
      }),
    );

    expect(detection.types).toEqual(["node"]);
    expect(detection.manifests).toEqual(["package.json"]);
    expect(detection.nodeScripts).toEqual(["lint", "test", "typecheck"]);
  });

  it("detects a python project and the tools its pyproject configures", async () => {
    const detection = await detectProject(
      reader({
        "pyproject.toml": "[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n",
      }),
    );

    expect(detection.types).toEqual(["python"]);
    expect(detection.pythonTools).toEqual(["mypy", "ruff"]);
  });

  it("detects rust and go from their manifests", async () => {
    expect((await detectProject(reader({ "Cargo.toml": "[package]\n" }))).types).toEqual(["rust"]);
    expect((await detectProject(reader({ "go.mod": "module example.com/x\n" }))).types).toEqual([
      "go",
    ]);
  });

  it("detects every manifest a polyglot repo carries", async () => {
    const detection = await detectProject(
      reader({ "package.json": "{}", "go.mod": "module x", "Cargo.toml": "[package]" }),
    );

    expect(detection.types).toEqual(["node", "rust", "go"]);
  });

  it("detects nothing when no manifest is present", async () => {
    const detection = await detectProject(reader({}));

    expect(detection.types).toEqual([]);
    expect(detection.nodeScripts).toEqual([]);
  });

  it("still identifies a node project whose package.json does not parse", async () => {
    const detection = await detectProject(reader({ "package.json": "{ not json" }));

    expect(detection.types).toEqual(["node"]);
    expect(detection.nodeScripts).toEqual([]);
  });
});

describe("assembling the default gate set", () => {
  it("always carries the four gates that hold whatever the language is", async () => {
    const gates = assembleGates(await detectProject(reader({})));

    expect(gates.map((gate) => gate.id)).toEqual([
      "typecheck",
      "lint",
      "format",
      "tests",
      "file-set",
      "placeholder",
      "secret-scan",
      "diff-budget",
    ]);
  });

  it("marks the diff budget advisory and everything else blocking", async () => {
    const gates = assembleGates(await detectProject(reader({ "go.mod": "module x" })));
    const advisory = gates.filter((gate) => gate.severity === "advisory");

    expect(advisory.map((gate) => gate.id)).toEqual(["diff-budget"]);
  });

  it("maps node gates onto the scripts package.json actually declares", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({
          "package.json": JSON.stringify({
            scripts: { test: "vitest run", lint: "biome check", "format:check": "biome format" },
          }),
        }),
      ),
    );

    expect(commandOf(gates, "tests")).toBe("npm run --silent test");
    expect(commandOf(gates, "lint")).toBe("npm run --silent lint");
    expect(commandOf(gates, "format")).toBe("npm run --silent format:check");
    // No typecheck script, so there is no command to run and the gate says so.
    expect(commandOf(gates, "typecheck")).toBeNull();
  });

  it("refuses to run a writing formatter as a gate", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({ "package.json": JSON.stringify({ scripts: { format: "biome format --write" } }) }),
      ),
    );

    expect(commandOf(gates, "format")).toBeNull();
  });

  it("assembles the toolchain commands for rust and go", async () => {
    const rust = assembleGates(await detectProject(reader({ "Cargo.toml": "[package]" })));
    expect(commandOf(rust, "tests")).toBe("cargo test");
    expect(commandOf(rust, "format")).toBe("cargo fmt --all --check");

    const go = assembleGates(await detectProject(reader({ "go.mod": "module x" })));
    expect(commandOf(go, "typecheck")).toBe("go build ./...");
    expect(commandOf(go, "lint")).toBe("go vet ./...");
  });

  it("assembles python gates only for the tools the manifest configures", async () => {
    const configured = assembleGates(
      await detectProject(reader({ "pyproject.toml": "[tool.ruff]\n[tool.mypy]\n" })),
    );
    expect(commandOf(configured, "lint")).toBe("ruff check .");
    expect(commandOf(configured, "typecheck")).toBe("mypy .");

    const bare = assembleGates(await detectProject(reader({ "pyproject.toml": "[project]\n" })));
    expect(commandOf(bare, "lint")).toBeNull();
    expect(commandOf(bare, "tests")).toBe("pytest -q");
  });

  it("keeps a polyglot repo's gates distinguishable by naming the type in the id", async () => {
    const gates = assembleGates(
      await detectProject(reader({ "package.json": "{}", "go.mod": "module x" })),
    );

    expect(gates.map((gate) => gate.id)).toContain("tests:node");
    expect(gates.map((gate) => gate.id)).toContain("tests:go");
  });

  it("lets a configured command replace an assembled one", async () => {
    const gates = assembleGates(await detectProject(reader({ "go.mod": "module x" })), {
      commandOverrides: { tests: "go test -race ./..." },
    });

    expect(commandOf(gates, "tests")).toBe("go test -race ./...");
  });
});

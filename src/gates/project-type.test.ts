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

/** What the gate actually spawns, as opposed to how the ledger renders it for a reader. */
function argvOf(gates: readonly GateDefinition[], id: string): readonly string[] | null {
  const gate = gates.find((candidate) => candidate.id === id);
  return gate?.source.kind === "command" ? (gate.source.argv ?? null) : null;
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
  it("always carries the inspections that hold whatever the language is", async () => {
    const gates = assembleGates(await detectProject(reader({})));

    expect(gates.map((gate) => gate.id)).toEqual([
      "typecheck",
      "lint",
      "format",
      "tests",
      "file-set",
      "placeholder",
      "secret-scan",
      "behaviour-probe",
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

  it("asks node's own runner for the reports the ratchet needs, on streams", async () => {
    // Both arms can only compare what a run measured, and they measure from streams the
    // harness owns rather than from files at paths anything on the machine can write. Node
    // rejects the flags after the file patterns, so the assembled command carries them in
    // front.
    const gates = assembleGates(
      await detectProject(
        reader({
          "package.json": JSON.stringify({ scripts: { test: "node --test ./test/*.mjs" } }),
        }),
      ),
    );

    // What runs is the vector, spawned with no shell in between. The command string beside it
    // is its rendering, which is what the ledger and the screen show and what nothing reads.
    expect(argvOf(gates, "tests")).toEqual([
      "node",
      "--test",
      "--experimental-test-coverage",
      "--test-isolation=process",
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      "--test-reporter-destination=stderr",
      "./test/*.mjs",
    ]);
    expect(commandOf(gates, "tests")).toBe(argvOf(gates, "tests")?.join(" "));
  });

  it("spawns nothing of its own for a gate it only declared a command for", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({ "package.json": JSON.stringify({ scripts: { lint: "biome check" } }) }),
      ),
    );

    expect(argvOf(gates, "lint")).toBeNull();
    expect(commandOf(gates, "lint")).toBe("npm run --silent lint");
  });

  it("runs the declared script where the harness cannot build a vector for it", async () => {
    // No path to configure any more, so what decides is whether the declared command is one
    // node-test-command.ts recognizes completely. Vitest is not.
    const gates = assembleGates(
      await detectProject(
        reader({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) }),
      ),
    );

    expect(commandOf(gates, "tests")).toBe("npm run --silent test");
    expect(argvOf(gates, "tests")).toBeNull();
  });

  it("leaves a runner it cannot ask for a readable report alone", async () => {
    // Vitest and pytest report coverage in shapes this harness does not parse, and asking
    // for it can fail outright. Those runs are recorded as not measured, never guessed at.
    for (const command of ["vitest run", "pytest -q && node --test", "jest"]) {
      const gates = assembleGates(
        await detectProject(
          reader({ "package.json": JSON.stringify({ scripts: { test: command } }) }),
        ),
      );
      expect({ command, assembled: commandOf(gates, "tests") }).toEqual({
        command,
        assembled: "npm run --silent test",
      });
    }
  });

  it("does not ask twice when the script already reports coverage", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({
          "package.json": JSON.stringify({
            scripts: { test: "node --test --experimental-test-coverage" },
          }),
        }),
      ),
    );

    expect(commandOf(gates, "tests")).toBe("npm run --silent test");
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

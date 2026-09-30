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
  it("detects legacy Python manifests without executing setup code or duplicating gates", async () => {
    const detection = await detectProject(
      reader({
        "setup.py": "raise RuntimeError('setup must not execute during detection')",
        "setup.cfg":
          "[metadata]\nname = example\n[mypy]\nstrict = true\n[tool:pytest]\ntestpaths = tests\n",
      }),
    );
    expect(detection.types).toEqual(["python"]);
    expect(detection.manifests).toEqual(["setup.cfg", "setup.py"]);
    expect(detection.pythonTools).toEqual(["mypy", "pytest"]);
    expect(commandOf(assembleGates(detection), "tests")).toBe("pytest -q");
    expect(commandOf(assembleGates(detection), "typecheck")).toBe("mypy .");
    const modern = await detectProject(
      reader({ "pyproject.toml": "[tool.ruff]\nfix = true", "setup.py": "" }),
    );
    expect(modern.types).toEqual(["python"]);
    expect(assembleGates(modern).filter((gate) => gate.id === "tests")).toHaveLength(1);
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

    expect(argvOf(gates, "tests")?.[0]).toBe("node");
    expect(argvOf(gates, "tests")?.join(" ")).toContain("require.resolve('vitest/package.json')");
    expect(argvOf(gates, "tests")?.join(" ")).toContain("--reporter=json");
    expect(commandOf(gates, "lint")).toBe("npm run --loglevel=error lint");
    expect(commandOf(gates, "format")).toBe("npm run --loglevel=error format:check");
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
    expect(commandOf(gates, "lint")).toBe("npm run --loglevel=error lint");
  });

  it("runs the declared script where the harness cannot build a vector for it", async () => {
    // Compound commands retain their declared behavior and do not gain measurement authority.
    const gates = assembleGates(
      await detectProject(
        reader({
          "package.json": JSON.stringify({ scripts: { test: "vitest run && node extra.mjs" } }),
        }),
      ),
    );

    expect(commandOf(gates, "tests")).toBe("npm run --loglevel=error test");
    expect(argvOf(gates, "tests")).toBeNull();
  });

  it("leaves a runner it cannot ask for a readable report alone", async () => {
    // Unrecognized runner configurations retain their commands and measurement limits.
    for (const command of ["vitest run --config custom.ts", "pytest -q && node --test", "jest"]) {
      const gates = assembleGates(
        await detectProject(
          reader({ "package.json": JSON.stringify({ scripts: { test: command } }) }),
        ),
      );
      expect({ command, assembled: commandOf(gates, "tests") }).toEqual({
        command,
        assembled: "npm run --loglevel=error test",
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

    expect(commandOf(gates, "tests")).toBe("npm run --loglevel=error test");
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
    expect(commandOf(configured, "lint")).toBe("ruff check --no-fix .");
    expect(commandOf(configured, "typecheck")).toBe("mypy .");

    const bare = assembleGates(await detectProject(reader({ "pyproject.toml": "[project]\n" })));
    expect(commandOf(bare, "lint")).toBeNull();
    expect(commandOf(bare, "tests")).toBeNull();
  });
  it("preserves explicit mypy target selection instead of checking unrelated untyped tests", async () => {
    for (const manifests of [
      { "pyproject.toml": "[tool.mypy]\nfiles = ['src', 'tests/typing']\nstrict = true\n" },
      {
        "setup.cfg":
          "[mypy]\nfiles = src, tests/typing\nstrict = True\n[tool:pytest]\ntestpaths = tests\n",
      },
    ]) {
      const detection = await detectProject(reader(manifests));
      expect(detection.pythonMypyTargetsConfigured).toBe(true);
      expect(commandOf(assembleGates(detection), "typecheck")).toBe("mypy");
    }
    const unrelated = await detectProject(
      reader({ "setup.cfg": "[mypy]\nstrict = True\n[other]\nfiles = ignored\n" }),
    );
    expect(commandOf(assembleGates(unrelated), "typecheck")).toBe("mypy .");
    const malformed = await detectProject(
      reader({ "pyproject.toml": "[tool.mypy]\nfiles = [not valid TOML" }),
    );
    expect(commandOf(assembleGates(malformed), "typecheck")).toBeNull();
    expect(malformed.setupProblem).toContain("malformed");
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

it("recognizes explicit Python tool dependencies and standalone pytest configuration", async () => {
  for (const manifests of [
    {
      "pyproject.toml":
        '[project]\nname="unit"\n[dependency-groups]\ndev=["pytest==9.0.2", "ruff>=0.15", "not-mypy"]\n',
    },
    { "pyproject.toml": '[project]\nname="unit"\n', "pytest.ini": "[pytest]\ntestpaths=tests\n" },
  ]) {
    const detected = await detectProject(reader(manifests));
    expect(detected.pythonTools).toContain("pytest");
    expect(detected.pythonTools).not.toContain("mypy");
    expect(commandOf(assembleGates(detected), "tests")).toBe("pytest -q");
  }
});

describe("what the project's own environment holds", () => {
  /**
   * tavern, in the README-only python simulation: pyproject.toml configures mypy, the synced
   * environment holds no mypy, and `python -m mypy` exited 1 with "No module named mypy",
   * which read as the typecheck failing on a clean checkout. Presence is a file in the
   * environment, read without running anything.
   */
  it("reads which configured tools are installed in .venv, and claims nothing without one", async () => {
    const files = {
      "pyproject.toml":
        "[tool.mypy]\nstrict = true\n[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\nminversion = '8'\n",
      ".venv/pyvenv.cfg": "home = /usr/bin\n",
      ".venv/lib/python3.12/site-packages/ruff/__init__.py": "",
      ".venv/lib/python3.12/site-packages/pytest/__init__.py": "",
    };
    const synced = await detectProject(reader(files));
    expect(synced.pythonTools).toEqual(["mypy", "pytest", "ruff"]);
    expect(synced.pythonToolsInstalled).toEqual(["pytest", "ruff"]);

    const unsynced = await detectProject(reader({ "pyproject.toml": files["pyproject.toml"] }));
    expect(unsynced.pythonToolsInstalled).toBeUndefined();
  });
});

describe("a formatter check runs only where the project declares that formatter", () => {
  function unavailableReason(gates: readonly GateDefinition[], id: string): string | null {
    const gate = gates.find((candidate) => candidate.id === id);
    return gate?.source.kind === "inspection" ? (gate.source.unavailableReason ?? null) : null;
  }

  /**
   * nborder, tracemantle, ironroot and tavern configure `[tool.ruff]` to lint. None of them
   * formats with ruff (ironroot formats with black), and `ruff format --check .` failed each
   * clean checkout on files the project never asked ruff to format.
   */
  it("does not invent a ruff format check from ruff lint configuration", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({
          "pyproject.toml": '[tool.ruff]\nline-length = 100\n[tool.ruff.lint]\nselect = ["E"]\n',
        }),
      ),
    );
    expect(commandOf(gates, "lint")).toBe("ruff check --no-fix .");
    expect(commandOf(gates, "format")).toBeNull();
    expect(unavailableReason(gates, "format")).toContain("declares no formatter");
  });

  it("runs ruff format where a [tool.ruff.format] table or a ruff-format hook declares it", async () => {
    for (const files of [
      { "pyproject.toml": "[tool.ruff]\n[tool.ruff.format]\nquote-style = 'double'\n" },
      { "pyproject.toml": "[tool.ruff]\nformat = { quote-style = 'single' }\n" },
      {
        "pyproject.toml": '[project]\nname = "p"\n',
        ".pre-commit-config.yaml":
          "repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    rev: v0.15.0\n    hooks:\n      - id: ruff\n      - id: ruff-format\n",
      },
    ]) {
      const gates = assembleGates(await detectProject(reader(files)));
      expect({ files, format: commandOf(gates, "format") }).toEqual({
        files,
        format: "ruff format --check .",
      });
      expect(gates.find((gate) => gate.id === "format")?.severity).toBe("blocking");
    }
  });

  it("runs black where the project declares black, and only when its environment holds it", async () => {
    const pyproject = "[tool.black]\nline-length = 100\n[tool.ruff]\nline-length = 100\n";
    const declared = assembleGates(await detectProject(reader({ "pyproject.toml": pyproject })));
    expect(commandOf(declared, "format")).toBe("black --check .");
    expect(declared.find((gate) => gate.id === "format")?.title).toBe("format (black --check)");

    const environment = {
      "pyproject.toml": pyproject,
      ".venv/pyvenv.cfg": "home = /usr/bin\n",
      ".venv/lib/python3.12/site-packages/ruff/__init__.py": "",
    };
    const absent = await detectProject(reader(environment));
    expect(absent.pythonToolsInstalled).toEqual(["ruff"]);
    expect(unavailableReason(assembleGates(absent), "format")).toContain(
      "configures black, but the project's environment does not hold it",
    );
    const installed = await detectProject(
      reader({ ...environment, ".venv/lib/python3.12/site-packages/black/__init__.py": "" }),
    );
    expect(commandOf(assembleGates(installed), "format")).toBe(
      "'/bin/sh' '-c' '.venv/bin/python -m black --check .'",
    );

    const hook = await detectProject(
      reader({
        "pyproject.toml": '[project]\nname = "p"\n',
        ".pre-commit-config.yaml":
          "repos:\n  - repo: https://github.com/psf/black-pre-commit-mirror\n    rev: 25.1.0\n    hooks:\n      - id: black\n",
      }),
    );
    expect(commandOf(assembleGates(hook), "format")).toBe("black --check .");
  });

  it("reads a pre-commit file that runs neither formatter as declaring none", async () => {
    const gates = assembleGates(
      await detectProject(
        reader({
          "pyproject.toml": "[tool.ruff]\n",
          ".pre-commit-config.yaml":
            "repos:\n  - repo: local\n    hooks:\n      - id: ruff\n      # - id: ruff-format\n",
        }),
      ),
    );
    expect(commandOf(gates, "format")).toBeNull();
  });
});

describe("mypy targets are read from the configuration file mypy itself reads", () => {
  const withMypy = '[project]\nname = "p"\n[dependency-groups]\ndev = ["mypy>=1.10"]\n';
  const typecheck = async (files: Readonly<Record<string, string>>) =>
    commandOf(assembleGates(await detectProject(reader(files))), "typecheck");

  /**
   * ironroot scopes mypy in `mypy.ini` (`files = src`); `mypy .` replaced that scope with the
   * whole tree and reported 180 errors in tests the project never type-checks.
   */
  it("runs plain mypy where mypy.ini or .mypy.ini names files, packages or modules", async () => {
    for (const file of ["mypy.ini", ".mypy.ini"])
      for (const targets of ["files = src", "packages = ironroot", "modules = ironroot.core"])
        expect({
          file,
          targets,
          command: await typecheck({
            "pyproject.toml": withMypy,
            [file]: `[mypy]\n${targets}\nstrict = True\n`,
          }),
        }).toEqual({ file, targets, command: "mypy" });
  });

  it("reads packages and modules as targets in pyproject.toml and setup.cfg as well", async () => {
    expect(await typecheck({ "pyproject.toml": "[tool.mypy]\npackages = ['ironroot']\n" })).toBe(
      "mypy",
    );
    expect(await typecheck({ "pyproject.toml": "[tool.mypy]\nmodules = 'ironroot.core'\n" })).toBe(
      "mypy",
    );
    expect(await typecheck({ "setup.cfg": "[mypy]\npackages = ironroot\n" })).toBe("mypy");
  });

  it("follows mypy's precedence, so targets in a file mypy would not read select nothing", async () => {
    // mypy reads mypy.ini, then .mypy.ini, then pyproject.toml with [tool.mypy], then setup.cfg
    // with [mypy], and only the first it finds. Plain `mypy` with no targets in that one file
    // exits with "Missing target module, package, files, or command".
    expect(
      await typecheck({
        "pyproject.toml": "[tool.mypy]\nfiles = ['src']\n",
        "mypy.ini": "[mypy]\nstrict = True\n",
      }),
    ).toBe("mypy .");
    expect(
      await typecheck({
        "pyproject.toml": withMypy,
        ".mypy.ini": "[mypy]\nstrict = True\n",
        "setup.cfg": "[mypy]\nfiles = src\n",
      }),
    ).toBe("mypy .");
    expect(
      await typecheck({
        "pyproject.toml": "[tool.mypy]\nstrict = true\n",
        "setup.cfg": "[mypy]\nfiles = src\n",
      }),
    ).toBe("mypy .");
    expect(
      await typecheck({
        "pyproject.toml": withMypy,
        "mypy.ini": "[mypy]\nstrict = True\n[mypy-ironroot.*]\nfiles = src\n",
      }),
    ).toBe("mypy .");
    // A pyproject.toml without [tool.mypy] and a setup.cfg without [mypy] are passed over.
    expect(
      await typecheck({
        "pyproject.toml": withMypy,
        "setup.cfg": "[metadata]\nname = p\n",
        "mypy.ini": "[mypy]\nfiles = src\n",
      }),
    ).toBe("mypy");
    expect(
      await typecheck({
        "pyproject.toml": '[project]\nname = "p"\n',
        "setup.cfg": "[mypy]\nfiles = src\n",
      }),
    ).toBe("mypy");
  });
});

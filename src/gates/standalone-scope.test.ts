import { describe, expect, it } from "vitest";
import { emptyFileSet } from "./file-set.ts";
import type { GateContext } from "./gate-definition.ts";
import { fileSetGate } from "./inspection-gates.ts";

function contextWith(options: {
  readonly changed: readonly string[];
  readonly authorizedScope?:
    | { readonly kind: "agent-declared" }
    | { readonly kind: "observed" }
    | { readonly kind: "allowed-files"; readonly files: readonly string[] };
}): GateContext {
  return {
    workspaceRoot: "/repo",
    changes: { files: options.changed.map((path) => ({ path, addedLines: 1 })) },
    fileSet: emptyFileSet,
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe: {} as never,
    ...(options.authorizedScope === undefined ? {} : { authorizedScope: options.authorizedScope }),
  } as unknown as GateContext;
}

async function readGate(context: GateContext) {
  if (fileSetGate.source.kind !== "inspection") {
    throw new Error("the file-set gate is an inspection");
  }
  const observation = await fileSetGate.source.inspect(context);
  return { reading: fileSetGate.parse(observation), observation };
}

describe("running the gates over a repository with no agent behind them", () => {
  /**
   * `swarm gates` runs the checks with no model and no planner, so nothing ever declared a
   * file set. Failing for that reason rejects every changed repository the command is for,
   * which is what made the standalone command unusable on real work.
   */
  it("does not fail a changed repository for a declaration no agent was there to make", async () => {
    const { reading } = await readGate(
      contextWith({ changed: ["src/a.ts", "src/b.ts"], authorizedScope: { kind: "observed" } }),
    );

    expect(reading.status).toBe("not-applicable");
  });

  it("names the observed scope, and says it is observed rather than authorized", async () => {
    const { reading } = await readGate(
      contextWith({ changed: ["src/a.ts", "src/b.ts"], authorizedScope: { kind: "observed" } }),
    );

    expect(reading.detail).toContain("src/a.ts");
    expect(reading.detail).toMatch(/observed/i);
    expect(reading.detail).toMatch(/not.*authoris|not.*authoriz/i);
  });

  it("checks membership against the files a caller authorized on the command line", async () => {
    const { reading } = await readGate(
      contextWith({
        changed: ["src/a.ts", "src/rogue.ts"],
        authorizedScope: { kind: "allowed-files", files: ["src/a.ts"] },
      }),
    );

    expect(reading.status).toBe("failed");
    expect(reading.detail).toContain("src/rogue.ts");
  });

  it("passes where every changed file is one the caller authorized", async () => {
    const { reading } = await readGate(
      contextWith({
        changed: ["src/a.ts"],
        authorizedScope: { kind: "allowed-files", files: ["src/a.ts", "src/b.ts"] },
      }),
    );

    expect(reading.status).toBe("passed");
  });

  it("still fails an agent run that edited without declaring, which is the case it is for", async () => {
    const { reading } = await readGate(
      contextWith({ changed: ["src/a.ts"], authorizedScope: { kind: "agent-declared" } }),
    );

    expect(reading.status).toBe("failed");
    expect(reading.detail).toContain("no file set was declared");
  });
});

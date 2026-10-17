import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type PlannedChecksDeclaration,
  plannedChecksInput,
  plannedContract,
  programDidNotLoad,
} from "./planned-check-program.ts";

/**
 * The checks the adapter builds, run by real Node the way the goal verifier runs them: the
 * harness's argv, the program and inputs on stdin, and the captured stdout compared with the one
 * expected text.
 */
let project = "";

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "swarm-planned-program-"));
  writeFileSync(
    join(project, "value.mjs"),
    "export function classify(n) {\n  if (typeof n !== 'number') throw new TypeError('not a number');\n  return { size: n < 10 ? 'small' : 'big', n };\n}\n",
  );
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

const task = "every n up to and including 10 is small";

function built(check: Partial<PlannedChecksDeclaration["checks"][number]>) {
  const contract = plannedContract(
    task,
    {
      requirements: [{ id: "boundary", description: "10 is small", quote: task }],
      checks: [
        {
          id: "boundary",
          requirement: "boundary",
          purpose: "change",
          program:
            "import { classify } from './value.mjs';\nconsole.log('noise');\nexport default (n) => classify(n);\n",
          cases: [{ input: 3, expected: { n: 3, size: "small" } }],
          why: "w",
          ...check,
        },
      ],
    },
    undefined,
  );
  const [made] = contract.checks;
  if (made?.behavior?.kind !== "cli") throw new Error("a command-line check");
  return { check: made, behavior: made.behavior };
}

function run(made: ReturnType<typeof built>) {
  const [program, ...args] = made.behavior.argv;
  const ran = spawnSync(program ?? "node", args, {
    cwd: project,
    input: made.behavior.stdin,
    encoding: "utf8",
  });
  return {
    exitCode: ran.status,
    stdout: ran.stdout,
    stderr: ran.stderr,
    expected: made.behavior.stdout[0]?.value,
  };
}

describe("a planned check as the harness runs it", () => {
  it("prints one sorted JSON line per case, with what the program prints moved to stderr", () => {
    const ran = run(built({}));
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toBe('{"input":3,"result":{"n":3,"size":"small"}}\n');
    expect(ran.stdout).toBe(ran.expected);
    expect(ran.stderr).toContain("noise");
    // The program was there only while it was imported.
    expect(readdirSync(project)).toEqual(["value.mjs"]);
  });

  it("reads a wrong answer as a completed run whose lines differ", () => {
    const ran = run(built({ cases: [{ input: 3, expected: { n: 3, size: "big" } }] }));
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).not.toBe(ran.expected);
  });

  it("records a thrown case as a result, and a declared throw as its expectation", () => {
    const ran = run(
      built({
        cases: [
          { input: "x", throws: true },
          { input: 12, expected: { n: 12, size: "big" } },
        ],
      }),
    );
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toBe(ran.expected);
    expect(ran.stdout.split("\n")[0]).toBe('{"input":"x","threw":true}');
    expect(ran.stderr).toMatch(/case 1 threw: TypeError: not a number/);
  });

  it("reads undefined as null", () => {
    const ran = run(
      built({
        program: "export default () => undefined;\n",
        cases: [{ input: 1, expected: null }],
      }),
    );
    expect(ran.stdout).toBe(ran.expected);
  });

  it("exits with its own status when the program does not load, naming why", () => {
    const missing = run(
      built({
        program: "import { classify } from './dist/value.mjs';\nexport default classify;\n",
      }),
    );
    expect(missing.exitCode).toBe(programDidNotLoad);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/did not load: .*ERR_MODULE_NOT_FOUND|Cannot find module/s);
    const syntax = run(built({ program: "export default (n) => classify(n;\n" }));
    expect(syntax.exitCode).toBe(programDidNotLoad);
    expect(syntax.stderr).toMatch(/did not load: SyntaxError/);
  });
});

it("offers the model a tool schema that admits object inputs and results", () => {
  // z.json() rendered every object as closed to all properties, so a model following the
  // schema could pass only {} where a case needed { size, uid }.
  const rendered = z.toJSONSchema(plannedChecksInput, { io: "input" }) as unknown as {
    properties: { checks: { items: { properties: { cases: { items: { anyOf: unknown[] } } } } } };
  };
  const [valued] = rendered.properties.checks.items.properties.cases.items.anyOf as {
    properties: { input: object; expected: object };
  }[];
  expect(valued?.properties).toEqual({ input: {}, expected: {} });
  const parsed = plannedChecksInput.safeParse({
    requirements: [{ id: "a", description: "d" }],
    checks: [
      {
        id: "a",
        requirement: "a",
        purpose: "preserve",
        program: "export default (x) => x;",
        cases: [{ input: { record: "10 uid=-1\n" }, expected: { uid: -1, size: null } }],
        why: "w",
      },
    ],
  });
  expect(parsed.success).toBe(true);
});

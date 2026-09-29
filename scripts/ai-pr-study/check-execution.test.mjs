import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutModuleResolver,
  classifyCheckExecution,
  shellCommands,
} from "./check-execution.mjs";

const classOf = (check, options) => classifyCheckExecution(check, options).class;

describe("shellCommands", () => {
  it("splits on operators, strips quotes and redirections, and keeps substitutions apart", () => {
    const { commands, substitutions } = shellCommands(
      "cd pkg && FOO=1 npx vitest run 'a b.test.ts' 2>&1 | tee out.txt > /dev/null; echo \"$(node -e 'x')\"",
    );
    expect(commands).toEqual([
      ["cd", "pkg"],
      ["FOO=1", "npx", "vitest", "run", "a b.test.ts"],
      ["tee", "out.txt"],
      ["echo", "$SUBSTITUTION"],
    ]);
    expect(substitutions).toEqual(["node -e 'x'"]);
  });

  it("does not read arithmetic, array assignments or function definitions as programs", () => {
    const { commands, substitutions, functions } = shellCommands(
      'n=$((n + 1))\nFILES=( "a.tsx" "b.tsx" )\ncheck() { grep -q x "$1"; }\ncheck a',
    );
    expect(substitutions).toEqual([]);
    expect(functions).toEqual(new Set(["check"]));
    expect(commands.map((words) => words[0])).toEqual([
      "n=$ARITHMETIC",
      'FILES=( "a.tsx" "b.tsx" )',
      "{",
      "}",
      "check",
    ]);
  });
});

describe("classifyCheckExecution", () => {
  it("reads a grep script over .tsx files as text inspection (row 7 and 14 of 1.0.2)", () => {
    const check = {
      path: "check.sh",
      command: "bash check.sh",
      contents:
        'FILE="src/icon-detail.tsx "\nif ! grep -q aria-label "$FILE"; then echo "FAIL"; exit 1; fi\nmissing=$((missing + 1))\n',
    };
    expect(classOf(check)).toBe("text-inspected");
    const inline = {
      path: "x",
      command:
        'bash -c \'for f in $FILES; do if ! grep -qF "$P" "$f"; then missing=$((missing + 1)); fi; done\'',
      contents: "",
    };
    expect(classOf(inline)).toBe("text-inspected");
  });

  it("reads python -c that imports the project as behavioural (row 20 and 26 of 1.0.2)", () => {
    const check = {
      path: "tests/check.py",
      command:
        "python -c \"\nimport sys\nsys.path.insert(0, 'src')\nfrom safety.forecast import Advisor\nassert Advisor().run() == 1\n\"",
      contents: "unused",
    };
    const result = classifyCheckExecution(check);
    expect(result.class).toBe("behavioural-executed");
    expect(result.resolution).toBe("heuristic");
  });

  it("reads a node script that only opens a source file as text inspection", () => {
    const check = {
      path: "scripts/check.mjs",
      command: "node scripts/check.mjs",
      contents:
        "import fs from 'fs';\nconst text = fs.readFileSync('src/a.tsx', 'utf8');\nif (!text.includes('useMemo')) process.exit(1);\n",
    };
    expect(classOf(check)).toBe("text-inspected");
  });

  it("reads a vitest file importing through an alias, and a relative import, as behavioural", () => {
    expect(
      classOf({
        path: "packages/ui/test/a.test.ts",
        command: "cd packages/ui && npx vitest run test/a.test.ts",
        contents: 'import { expect, it } from "vitest";\nimport { find } from "~/reader/find";\n',
      }),
    ).toBe("behavioural-executed");
    expect(
      classOf({
        path: "check.mjs",
        command: "node check.mjs",
        contents: "import { add } from './lib.mjs';\n",
      }),
    ).toBe("behavioural-executed");
  });

  it("reads a project script or the project's suite as behavioural", () => {
    expect(classOf({ path: "c", command: "npm test", contents: "" })).toBe("behavioural-executed");
    expect(classOf({ path: "c", command: "bash scripts/verify.sh", contents: "" })).toBe(
      "behavioural-executed",
    );
    expect(classOf({ path: "c", command: "python -m pytest", contents: "" })).toBe(
      "behavioural-executed",
    );
  });

  it("leaves a program it does not recognise, or a subprocess it cannot follow, unscored", () => {
    expect(classOf({ path: "c", command: "ruby check.rb", contents: "" })).toBe("unscored");
    expect(
      classOf({
        path: "c.py",
        command: "python c.py",
        contents: "import subprocess\nsubprocess.run(['x'])\n",
      }),
    ).toBe("unscored");
    expect(classOf({ path: "c", command: "", contents: "" })).toBe("unscored");
  });
});

describe("checkoutModuleResolver over a real checkout", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "resolver-"));
    mkdirSync(join(root, "src", "safety"), { recursive: true });
    writeFileSync(join(root, "src", "safety", "__init__.py"), "");
    mkdirSync(join(root, "packages", "core"), { recursive: true });
    writeFileSync(
      join(root, "packages", "core", "package.json"),
      JSON.stringify({ name: "@acme/core" }),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("tells project modules from third-party ones", () => {
    const resolver = checkoutModuleResolver(root);
    expect(resolver("python", "safety.forecast")).toBe(true);
    expect(resolver("python", "yaml")).toBe(false);
    expect(resolver("javascript", "@acme/core/util")).toBe(true);
    expect(resolver("javascript", "react")).toBe(false);
    const readsYaml = {
      path: "c.py",
      command: "python c.py",
      contents: "import yaml\nyaml.safe_load(open('x.yml'))\n",
    };
    expect(classOf(readsYaml, { projectModule: resolver })).toBe("text-inspected");
    expect(classOf(readsYaml)).toBe("behavioural-executed");
    const importsCore = {
      path: "c.mjs",
      command: "node c.mjs",
      contents: 'import { a } from "@acme/core";\n',
    };
    expect(classOf(importsCore, { projectModule: resolver })).toBe("behavioural-executed");
  });
});

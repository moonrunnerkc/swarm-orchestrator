import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bash, fixture, halfTest, recordAndComplete, scripted, write } from "./test-doubles.ts";

/**
 * One task of each kind, end to end through the installed verifier, with scripted model replies
 * so the semantics are proven before any live model is involved.
 */
const checker = join(
  createRequire(import.meta.url).resolve("swarm-verify/package.json"),
  "..",
  "verify.mjs",
);

describe("a task of each kind, end to end", () => {
  it("completes a feature with new tests, and its evidence checks offline", async () => {
    const probe = await fixture(
      { "half.mjs": "export const half = (n) => n / 2;\n" },
      "Add an exported double(n) returning n * 2, with a test.",
    );
    const ran = await probe.run(
      scripted([
        write("half.mjs", "export const half = (n) => n / 2;\nexport const double = (n) => n * 2;"),
        write(
          "test/double.test.mjs",
          'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../half.mjs";\ntest("doubles", () => assert.equal(double(4), 8));',
        ),
        recordAndComplete([
          { id: "R1", text: "x", kind: "feature", evidence: { tests: [{ name: "doubles" }] } },
        ]),
      ]),
    );
    expect(ran.report.state).toBe("complete");
    expect(ran.report.requirements[0]).toMatchObject({
      id: "R1",
      text: "Add an exported double(n) returning n * 2, with a test.",
      status: "satisfied",
    });
    expect(ran.report.requirements[0]?.evidence[0]).toMatchObject({
      outcome: "witness",
      authority: "implementation-authored",
    });
    const bundle = ran.report.attestation ?? "";
    const checked = spawnSync(
      process.execPath,
      [
        checker,
        bundle,
        "--key",
        join(bundle, "..", "attestation.pub.pem"),
        "--patch",
        ran.report.snapshot.patch,
      ],
      { encoding: "utf8" },
    );
    expect(checked.stdout).toContain("ok     signature");
    expect(checked.stdout).toContain("ok     state");
    expect(checked.status).toBe(0);
  });

  it("completes a fix while an unrelated inherited failure stays reported", async () => {
    const probe = await fixture({
      "test/half.test.mjs": `${halfTest()}test("unrelated", () => assert.equal(1, 2));\n`,
    });
    const ran = await probe.run(
      scripted([
        write("half.mjs", "export const half = (n) => n / 2;"),
        recordAndComplete([
          { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } },
        ]),
      ]),
    );
    expect(ran.report.state).toBe("complete");
    expect(ran.report.requirements[0]).toMatchObject({ status: "satisfied" });
    expect(ran.result?.regression).toMatchObject({
      status: "none",
      inherited: ["test/half.test.mjs::unrelated"],
    });
  });

  it("completes a refactor that moves the module and its test without a failing baseline", async () => {
    const probe = await fixture(
      { "half.mjs": "export const half = (n) => n / 2;\n" },
      "Move half into lib/math.mjs.",
    );
    const ran = await probe.run(
      scripted([
        bash(
          "mkdir -p lib test/lib && git mv half.mjs lib/math.mjs && git mv test/half.test.mjs test/lib/math.test.mjs",
        ),
        bash(
          "sed -i.bak 's#../half.mjs#../../lib/math.mjs#' test/lib/math.test.mjs && rm test/lib/math.test.mjs.bak",
        ),
        recordAndComplete([
          {
            id: "R1",
            text: "x",
            kind: "refactor",
            evidence: {
              tests: [{ name: "half" }],
              structure: [
                { path: "lib/math.mjs", contains: "export const half" },
                { path: "half.mjs", absent: true },
              ],
            },
          },
        ]),
      ]),
    );
    expect(ran.result?.testFiles.moved).toEqual([
      { from: "test/half.test.mjs", to: "test/lib/math.test.mjs" },
    ]);
    expect(ran.report.requirements[0]).toMatchObject({ status: "satisfied" });
    expect(ran.report.state).toBe("complete");
  });

  it("completes an upgrade judged on dependencies installed fresh from each lockfile", async () => {
    const probe = await fixture(
      {
        "half.mjs": 'import { divide } from "dep";\nexport const half = (n) => divide(n, 2);\n',
        "package.json":
          '{ "name": "fixture", "version": "1.0.0", "type": "module", "private": true }\n',
      },
      "Upgrade dep to 2.0.0 and adapt half to its API.",
    );
    const vendor = join(probe.repo, "vendor");
    for (const [version, body] of [
      ["1.0.0", "export const divide = (a, b) => a / b;\n"],
      ["2.0.0", "export const quotient = ({ dividend, divisor }) => dividend / divisor;\n"],
    ] as const) {
      const dir = join(probe.root, `dep-${version}`);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        `{ "name": "dep", "version": "${version}", "type": "module", "main": "index.js" }\n`,
      );
      await writeFile(join(dir, "index.js"), body);
      await mkdir(vendor, { recursive: true });
      execFileSync("npm", ["pack", "--silent", "--pack-destination", vendor], { cwd: dir });
    }
    execFileSync(
      "npm",
      ["install", "--save-exact", "--no-audit", "--no-fund", "./vendor/dep-1.0.0.tgz"],
      { cwd: probe.repo, stdio: "ignore" },
    );
    await rm(join(probe.repo, "node_modules"), { recursive: true, force: true });
    await probe.put(".gitignore", "node_modules/\n");
    probe.git("add", "-A");
    probe.git("commit", "-qm", "depend on dep 1.0.0");
    const ran = await probe.run(
      scripted([
        bash("npm install --save-exact --no-audit --no-fund ./vendor/dep-2.0.0.tgz"),
        write(
          "half.mjs",
          'import { quotient } from "dep";\nexport const half = (n) => quotient({ dividend: n, divisor: 2 });',
        ),
        recordAndComplete([
          {
            id: "R1",
            text: "x",
            kind: "upgrade",
            evidence: {
              tests: [{ name: "half" }],
              packages: [{ name: "dep", ecosystem: "npm", version: "2.0.0" }],
            },
          },
        ]),
      ]),
    );
    expect(ran.result?.execution.dependencies).toMatchObject({
      mode: "prepared",
      reproducible: true,
    });
    expect(ran.report.requirements[0]).toMatchObject({ status: "satisfied" });
    expect(ran.report.state).toBe("complete");
  });
});

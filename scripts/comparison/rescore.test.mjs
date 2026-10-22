import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { recordedPatch, recordedPatchDigests, rescore, stageFile } from "./rescore.mjs";
import { mirrorOf } from "./workspace.mjs";

/**
 * The rescorer against a stage directory built here: a frozen manifest over a tiny task whose
 * mirror sits where the harness looks, and a record whose patch is either in the tree or in a
 * pack. Every reading comes from the pinned commits and the recorded bytes.
 */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const ran = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", ...args],
    { cwd, encoding: "utf8" },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  return ran.stdout.trim();
}

const digest = (text) =>
  `sha256:${spawnSync("shasum", ["-a", "256"], { input: text, encoding: "utf8" }).stdout.slice(0, 64)}`;

function mirrorTask(repository) {
  const source = mkdtempSync(join(tmpdir(), "rescore-source-"));
  roots.push(source);
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify({ name: "calc", type: "module", version: "1.0.0", scripts: { test: "node test/run.mjs" } })}\n`,
  );
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\n",
  );
  mkdirSync(join(source, "test"));
  writeFileSync(
    join(source, "test/run.mjs"),
    'import { mul } from "../calc.mjs";\nif (mul(2, 3) !== 6) { console.error("mul"); process.exit(1); }\n',
  );
  git(source, "init", "-q");
  git(source, "add", "--all");
  git(source, "commit", "-qm", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n",
  );
  writeFileSync(
    join(source, "test/add.test.mjs"),
    'import { add } from "../calc.mjs";\nif (add(2, 3) !== 5 || add(1, 1) !== 2) { console.error("add"); process.exit(1); }\n',
  );
  git(source, "add", "--all");
  git(source, "commit", "-qm", "fix add");
  const upstream = git(source, "rev-parse", "HEAD");
  const mirror = mirrorOf(repository);
  mkdirSync(dirname(mirror), { recursive: true });
  git(source, "clone", "--quiet", "--bare", source, mirror);
  roots.push(mirror);
  return { base, upstream };
}

const unique = () =>
  `fixture/rescore-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const fix =
  "diff --git a/calc.mjs b/calc.mjs\n--- a/calc.mjs\n+++ b/calc.mjs\n@@ -1,2 +1,2 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n export const mul = (a, b) => a * b;\n";

/** A stage directory: manifest.json, and a record with its patch in the tree or in a pack. */
function stage(repository, commits, { packed = false, patch = fix } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rescore-stage-"));
  roots.push(root);
  const task = {
    id: "calc-add",
    repository,
    workType: "bugfix",
    baseCommit: commits.base,
    upstreamCommit: commits.upstream,
    install: [["true"]],
    build: [],
    projectTest: ["node", "test/run.mjs"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source: 'import { add } from "../../calc.mjs";\nif (add(2, 3) !== 5) { process.exit(1); }\n',
    },
    hidden: { testFiles: ["test/add.test.mjs"], argv: ["node", "test/add.test.mjs"] },
    immutable: [],
    taskText:
      "add(a, b) in calc.mjs subtracts instead of adding; make it add and keep mul as it is.",
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({ tasks: [task] })}\n`);
  const record = JSON.stringify({
    task: "calc-add",
    arm: "swarm",
    finalPatchDigest: digest(patch),
  });
  if (!packed) {
    mkdirSync(join(root, "records"));
    writeFileSync(join(root, "records/calc-add.swarm.json"), record);
    writeFileSync(join(root, "records/calc-add.swarm.patch"), patch);
    return root;
  }
  // The record in the tree, the patch only in a pack under the stage's parent, as the
  // 2026-10-21 stage publishes its streams.
  mkdirSync(join(root, "records"));
  writeFileSync(join(root, "records/calc-add.swarm.json"), record);
  const stageName = root.split("/").at(-1);
  const pack = join(dirname(root), "packed-derived", `streams-${stageName}`);
  mkdirSync(pack, { recursive: true });
  roots.push(join(dirname(root), "packed-derived"));
  const files = { [`${stageName}/records/calc-add.swarm.patch`]: patch, "inventory.json": "{}" };
  const expanded = Buffer.from(JSON.stringify(files));
  const compressed = brotliCompressSync(expanded);
  writeFileSync(join(pack, "archive.json.br"), compressed);
  writeFileSync(
    join(pack, "archive-manifest.json"),
    JSON.stringify({ digest: digest(compressed), expandedBytes: expanded.length }),
  );
  return root;
}

describe("the recorded patch", () => {
  it("is read from the tree or from a pack, and held to the digest its record carries", () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const inTree = stage(repository, commits);
    expect(recordedPatch(inTree, "calc-add", "swarm")).toMatchObject({
      path: "records/calc-add.swarm.patch",
      text: fix,
      carrier: "records/calc-add.swarm.json",
    });
    const packed = stage(repository, commits, { packed: true });
    expect(stageFile(packed, "records/calc-add.swarm.patch")).toBe(fix);
    expect(recordedPatch(packed, "calc-add", "swarm").digest).toBe(digest(fix));
    expect([...recordedPatchDigests(packed, "calc-add", "swarm").keys()]).toEqual([digest(fix)]);
  });

  it("is refused where its bytes hash to nothing a record carries", () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const root = stage(repository, commits);
    writeFileSync(join(root, "records/calc-add.swarm.patch"), `${fix}\n`);
    expect(() => recordedPatch(root, "calc-add", "swarm")).toThrow(
      /which no record of calc-add swarm carries/,
    );
    expect(() => recordedPatch(root, "calc-add", "opencode")).toThrow(
      /no patch for calc-add opencode/,
    );
  });
});

describe("rescoring from pinned commits", () => {
  it("reads the delivered tree and the hidden overlay apart and names what the overlay displaced", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const own =
      'diff --git a/test/add.test.mjs b/test/add.test.mjs\nnew file mode 100644\n--- /dev/null\n+++ b/test/add.test.mjs\n@@ -0,0 +1,2 @@\n+import { add } from "../calc.mjs";\n+if (add(2, 2) !== 4) { process.exit(1); }\n';
    const root = stage(repository, commits, { patch: fix + own });
    const blobs = mkdtempSync(join(tmpdir(), "rescore-blobs-"));
    roots.push(blobs);
    const result = await rescore({ stage: root, taskId: "calc-add", arm: "swarm", blobs });
    expect(result.kind).toContain("supplemental scoring");
    expect(result.commits).toEqual(commits);
    expect(result.patch).toMatchObject({
      path: "records/calc-add.swarm.patch",
      digest: digest(fix + own),
      carrier: "records/calc-add.swarm.json",
    });
    expect(result.deliveredTree.passed).toBe(true);
    expect(result.hiddenOverlay.verdict).toBe("pass");
    expect(result.hiddenOverlay.displaced).toEqual(["test/add.test.mjs"]);
    expect(result.hiddenOverlay.displacedNote).toContain("the overlay displaced it");
    expect(result.hiddenOverlay.policy.testFilesAdded).toEqual(["test/add.test.mjs"]);
  }, 120_000);
});

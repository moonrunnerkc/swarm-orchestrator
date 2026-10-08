import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionReference,
  distributionFiles,
  distributionLinks,
  distributionManifest,
  manifestInterface,
} from "./build-action-distribution.mjs";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages", "swarm-verify");
const canonical = readFileSync(join(packageRoot, "action.yml"), "utf8");
const packageReadme = readFileSync(join(packageRoot, "README.md"), "utf8");
const examplesRoot = join(root, "docs", "examples");
const examples = readdirSync(examplesRoot)
  .filter((name) => name.endsWith(".yml"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(examplesRoot, name), "utf8") }));
const commit = "0123456789abcdef0123456789abcdef01234567";

/**
 * The distribution repository is the verifier's product home and is never hand-edited, so
 * everything a reader finds there has to come out of this generator, and it has to agree with
 * the canonical manifest and the package README it was rendered from.
 */
describe("the verifier's distribution, rendered from source", () => {
  const files = distributionFiles({
    canonical,
    packageReadme,
    changelog: "# Changelog: swarm-verify\n",
    license: "ISC\n",
    examples,
    version: "9.9.9",
    sourceCommit: commit,
  });

  it("replaces the source build with an install of the one published version and keeps every other step", () => {
    const manifest = distributionManifest(canonical, "9.9.9", commit);
    expect(manifest).not.toContain("npm run build:verify");
    expect(manifest).not.toContain("SOURCE-BUILD");
    expect(manifest).toContain("npm ci --ignore-scripts --omit=dev --no-audit --no-fund");
    expect(manifest).toContain("node_modules/swarm-verify/dist/swarm-verify.js");
    expect(manifest).toContain(`swarm-verify@9.9.9 by integrity`);
    expect(manifest).toContain(commit);
    for (const step of ["action verify", "action comment", "action retain", "actions/attest@"]) {
      expect(manifest).toContain(step);
    }
    expect(manifest.startsWith("name: Swarm Verify\n")).toBe(true);
    expect(files["action.yml"]).toBe(manifest);
  });

  it("reads every input and output the manifest declares, with defaults and descriptions", () => {
    const { inputs, outputs } = manifestInterface(canonical);
    const names = inputs.map((input) => input.name);
    expect(names).toContain("install");
    expect(names).toContain("goal-contract");
    expect(inputs.find((input) => input.name === "target")?.default).toBe("head");
    expect(inputs.find((input) => input.name === "isolation")?.default).toBe("docker");
    expect(inputs.find((input) => input.name === "goal-contract")?.default).toBe("");
    expect(inputs.every((input) => input.description.length > 0)).toBe(true);
    expect(outputs.map((output) => output.name)).toContain("verdict-digest");
    expect(outputs.every((output) => output.description.length > 0)).toBe(true);
  });

  it("refuses a manifest whose inputs it cannot read rather than rendering an empty table", () => {
    expect(() => manifestInterface("name: x\nruns:\n  using: composite\n")).toThrow(
      /declares no inputs/,
    );
  });

  it("renders the Action reference with one row per input and output and every example inline", () => {
    const reference = actionReference(canonical, examples);
    const { inputs, outputs } = manifestInterface(canonical);
    for (const input of inputs) {
      expect(reference).toContain(`| \`${input.name}\` |`);
    }
    for (const output of outputs) {
      expect(reference).toContain(`| \`${output.name}\` |`);
    }
    for (const example of examples) {
      expect(reference).toContain(`### ${example.name}`);
      expect(reference).toContain(example.text.trimEnd());
    }
    expect(files["docs/action.md"]).toBe(reference);
  });

  it("writes every file the README links to, so the product home has no dangling pointer", () => {
    const linked = distributionLinks(files["README.md"]);
    expect(linked.length).toBeGreaterThan(2);
    for (const path of linked) {
      if (path === "examples" || path === "SOURCE.json") continue;
      expect(Object.keys(files)).toContain(path);
    }
  });

  it("carries the package README whole, then says what the repository is and where it came from", () => {
    expect(files["README.md"].startsWith(packageReadme.trimEnd())).toBe(true);
    expect(files["README.md"]).toContain("## This repository");
    expect(files["README.md"]).toContain("`9.9.9`");
    expect(files["README.md"]).toContain(commit);
    expect(files["README.md"].startsWith("# Swarm Verify\n")).toBe(true);
  });

  it("pins the hook manifest and the package manifest to the same version", () => {
    expect(files[".pre-commit-hooks.yaml"]).toContain("swarm-verify@9.9.9 pre-commit");
    expect(JSON.parse(files["package.json"]).dependencies).toEqual({ "swarm-verify": "9.9.9" });
    expect(JSON.parse(files["package.json"]).private).toBe(true);
  });

  it("describes neither product as the other's beta or source-only shadow", () => {
    for (const text of [files["README.md"], files["docs/action.md"], files["action.yml"]]) {
      expect(text).not.toMatch(/beta coding agent|advanced beta|optional beta/i);
      expect(text).not.toMatch(/main source repository for Swarm Verify/i);
      expect(text).not.toMatch(/Falsifying Swarm Orchestrator/i);
    }
  });
});

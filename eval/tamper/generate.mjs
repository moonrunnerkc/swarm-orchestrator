import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cheatPatches } from "./cheat-patches.mjs";
import { git } from "./fixtures.mjs";
import { honestPatches } from "./honest-patches.mjs";

const oracleScript = join(dirname(fileURLToPath(import.meta.url)), "oracle.mjs");
const runLimitMs = 60_000;

/** The 40 patch definitions in a fixed order: honest first, then cheats by technique. */
export const patchDefinitions = [...honestPatches, ...cheatPatches].map((patch, index) => ({
  ...patch,
  id: `${String(index + 1).padStart(2, "0")}-${patch.repo}-${patch.technique ?? "honest"}`,
}));

/** The test command the patched project declares in its own swarm.toml. */
function declaredTestCommand(toml) {
  const match = /^test\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*$/m.exec(toml);
  if (match === null) throw new Error("swarm.toml declares no test command");
  return match[1] === undefined ? match[2] : JSON.parse(`"${match[1]}"`);
}

/** Runs the visible tests the naive way: the patched tree's own test command. */
async function naiveVisibleRun(dir, home) {
  const command = declaredTestCommand(await readFile(join(dir, "swarm.toml"), "utf8"));
  const ran = spawnSync("/bin/sh", ["-c", command], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", HOME: home },
    encoding: "utf8",
    timeout: runLimitMs,
  });
  return { command, passed: ran.status === 0, output: `${ran.stdout}${ran.stderr}` };
}

function oracleVerdict(dir, repo) {
  const output = execFileSync(process.execPath, [oracleScript, dir, repo], {
    encoding: "utf8",
    timeout: runLimitMs,
  });
  return JSON.parse(output);
}

async function applyEdits(dir, edits) {
  for (const [path, edit] of Object.entries(edits)) {
    const target = join(dir, path);
    const base = await readFile(target, "utf8").catch(() => null);
    const text = typeof edit === "function" ? edit(base ?? "") : edit;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}

/**
 * Writes each patch as `git diff --binary` from a scratch clone of its fixture, after checking
 * the definition does what it claims: every patch passes its visible tests when run naively,
 * honest patches are right on every oracle input and cheats are wrong on at least one. A
 * definition that breaks this is a fixture error, so generation stops rather than skew results.
 */
export async function generatePatches(repoDirs, outDir) {
  await mkdir(outDir, { recursive: true });
  const scratch = await mkdtemp(join(outDir, "work-"));
  const home = join(scratch, "home");
  await mkdir(home);
  const generated = [];
  try {
    for (const definition of patchDefinitions) {
      const clone = join(scratch, definition.id);
      git(scratch, ["clone", "-q", repoDirs[definition.repo], clone]);
      await applyEdits(clone, definition.edits);
      git(clone, ["add", "-A"]);
      const diff = git(clone, ["diff", "--cached", "--binary"]);
      if (diff === "") throw new Error(`${definition.id} changes nothing`);

      const naive = await naiveVisibleRun(clone, home);
      if (!naive.passed) {
        throw new Error(
          `${definition.id} fails its visible tests (${naive.command}):\n${naive.output}`,
        );
      }
      const truth = oracleVerdict(clone, definition.repo);
      if (truth.correct !== (definition.kind === "honest")) {
        throw new Error(
          `${definition.id} is a ${definition.kind} patch but the oracle says ${JSON.stringify(truth)}`,
        );
      }

      const path = join(outDir, `${definition.id}.patch`);
      await writeFile(path, diff);
      const { id, repo, kind, technique } = definition;
      generated.push({ id, repo, kind, technique, path });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return generated;
}

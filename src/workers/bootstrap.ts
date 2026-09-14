import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asJsonValue, canonicalJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import type { IsolationBackend } from "../exec/execution-mode.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import { bootstrapCheckPassed, bootstrapHistory } from "./bootstrap-history.ts";
import { type BootstrapIntent, bootstrapRecordSchema } from "./bootstrap-schema.ts";
import type { ControllerLaunch } from "./controller-launch.ts";
import type { RunContext } from "./run-context.ts";

const manifest = {
  ".gitignore": "node_modules/\ncoverage/\n",
  "package.json": `${JSON.stringify({ private: true, type: "module", engines: { node: ">=24" }, scripts: { test: "node --test" } }, null, 2)}\n`,
};
const positive =
  "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('bootstrap-positive',()=>assert.equal(1,1));\n";
const negative =
  "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('bootstrap-negative',()=>assert.equal(1,2));\n";
const toolchain =
  "process.stdout.write(process.versions.node); if(Number(process.versions.node.split('.')[0])<24) process.exitCode=1";

function objectId(kind: string, bytes: Buffer, algorithm: string) {
  return createHash(algorithm).update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
}
function objects(base: string, timestamp: number) {
  const algorithm = base.length === 40 ? "sha1" : "sha256";
  const blobs = Object.entries(manifest).map(([path, content]) => ({
    path,
    bytes: Buffer.from(content),
    kind: "blob",
  }));
  const treeBytes = Buffer.concat(
    blobs.map((blob) =>
      Buffer.concat([
        Buffer.from(`100644 ${blob.path}\0`),
        Buffer.from(objectId("blob", blob.bytes, algorithm), "hex"),
      ]),
    ),
  );
  const tree = objectId("tree", treeBytes, algorithm);
  const identity = `Swarm Orchestrator <swarm@localhost> ${timestamp} +0000`;
  const commitBytes = Buffer.from(
    `tree ${tree}\nparent ${base}\nauthor ${identity}\ncommitter ${identity}\n\nEstablish Node 24 bootstrap harness\n`,
  );
  return {
    tree,
    commit: objectId("commit", commitBytes, algorithm),
    entries: [...blobs, { kind: "tree", bytes: treeBytes }, { kind: "commit", bytes: commitBytes }],
  };
}

function git(
  repository: string,
  args: readonly string[],
  signal: AbortSignal,
  input?: Buffer,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: repository,
        env: harnessChildEnvironment().variables,
        signal,
        timeout: 30000,
        maxBuffer: 1000000,
      },
      (error, stdout, stderr) => {
        if (error !== null)
          reject(
            new Error(
              `bootstrap git ${args.join(" ")} failed: ${stderr || error.message}; preserve the recorded setup and reconcile`,
            ),
          );
        else resolve(stdout.trim());
      },
    );
    child.stdin?.on("error", () => {
      /* The process callback reports an early exit. */
    });
    child.stdin?.end(input);
  });
}

async function exists(path: string) {
  try {
    return await lstat(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

/** Only exact harness-authored files may be reconstructed or removed after interruption. */
async function ownedDirectory(
  path: string,
  files: Record<string, string>,
  signal: AbortSignal,
  remove = false,
) {
  signal.throwIfAborted();
  const stat = await exists(path);
  if (stat === null) {
    if (remove) return;
    await mkdir(path, { mode: 0o700 });
  } else if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`bootstrap ownership changed at ${path}; preserve and reconcile`);
  for (const name of await readdir(path)) {
    signal.throwIfAborted();
    const filename = join(path, name);
    const entry = await lstat(filename);
    if (
      !(name in files) ||
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      (await readFile(filename, "utf8")) !== files[name]
    )
      throw new Error(
        `bootstrap contains an unexpected or altered file at ${filename}; preserve and reconcile`,
      );
  }
  for (const [name, content] of Object.entries(files)) {
    signal.throwIfAborted();
    const filename = join(path, name);
    if (remove) {
      if (await exists(filename)) await unlink(filename);
    } else if ((await exists(filename)) === null)
      await writeFile(filename, content, { mode: 0o600, flag: "wx" });
  }
  if (remove) await rmdir(path);
}

const record = (
  evidence: EvidenceRecorder,
  payload: Parameters<typeof bootstrapRecordSchema.parse>[0],
) =>
  evidence.record({
    type: "bootstrap-stage",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(bootstrapRecordSchema.parse(payload)),
  });

export async function bootstrapRepository(options: {
  launch: ControllerLaunch;
  evidence: EvidenceRecorder;
  context: RunContext;
  isolation?: (workspace: string) => IsolationBackend;
}): Promise<{
  baseCommit: string;
  workspace: string;
  immutablePaths: readonly string[];
  cleanup(signal: AbortSignal): Promise<void>;
}> {
  const { launch, evidence, context } = options;
  if (launch.bootstrap !== "node")
    throw new Error("bootstrap needs an explicit Node stage in the pinned launch");
  context.signal.throwIfAborted();
  const previous = bootstrapHistory(evidence);
  const intents = previous.filter((entry) => entry.payload.phase === "intent");
  if (intents.length > 1) throw new Error("bootstrap intent is duplicated; preserve history");
  const old = intents[0]?.payload;
  const timestamp = old?.phase === "intent" ? old.timestamp : 0;
  const prepared = objects(launch.baseCommit, timestamp);
  const intent: BootstrapIntent = {
    phase: "intent",
    version: 1,
    language: "node",
    baseCommit: launch.baseCommit,
    ...{ commit: prepared.commit, tree: prepared.tree },
    ref: `refs/swarm-bootstrap/${launch.runId}`,
    workspace: join(launch.scratchRoot, "bootstrap"),
    timestamp,
    files: manifest,
  };
  if (old !== undefined && canonicalJson(asJsonValue(old)) !== canonicalJson(asJsonValue(intent)))
    throw new Error("bootstrap intent differs from its original policy or bytes; preserve history");
  if (old === undefined) {
    for (const name of ["bootstrap", "bootstrap-positive", "bootstrap-negative"])
      if (await exists(join(launch.scratchRoot, name)))
        throw new Error("bootstrap directory exists without its ownership intent; preserve it");
    if (
      (await git(
        launch.repositoryRoot,
        ["ls-tree", "-r", "--name-only", launch.baseCommit],
        context.signal,
      )) !== "" ||
      (await git(
        launch.repositoryRoot,
        ["status", "--porcelain", "--untracked-files=all"],
        context.signal,
      )) !== ""
    )
      throw new Error(
        "--bootstrap node requires an empty Git base and a clean workspace; use an existing project without bootstrap",
      );
    if (
      (await git(launch.repositoryRoot, ["rev-parse", "HEAD"], context.signal)) !==
      launch.baseCommit
    )
      throw new Error("bootstrap base must be the current empty commit");
    if (
      (await git(
        launch.repositoryRoot,
        ["for-each-ref", "--format=%(refname)", intent.ref],
        context.signal,
      )) !== ""
    )
      throw new Error("bootstrap reference already exists without its intent; preserve it");
    await record(evidence, intent);
  }
  for (const entry of prepared.entries) {
    const written = await git(
      launch.repositoryRoot,
      ["hash-object", "-t", entry.kind, "-w", "--stdin"],
      context.signal,
      entry.bytes,
    );
    if (
      written !==
      objectId(entry.kind, entry.bytes, launch.baseCommit.length === 40 ? "sha1" : "sha256")
    )
      throw new Error("Git bootstrap object identity disagrees with its planned bytes");
  }
  const retained = await git(
    launch.repositoryRoot,
    ["for-each-ref", "--format=%(objectname)", intent.ref],
    context.signal,
  );
  if (retained !== "" && retained !== prepared.commit)
    throw new Error("bootstrap reference was moved; preserve and reconcile");
  if (retained === "" && previous.some((entry) => entry.payload.phase === "ready"))
    throw new Error(
      "accepted bootstrap reference is missing; preserve history and reconcile its removal",
    );
  if (retained === "")
    await git(
      launch.repositoryRoot,
      ["update-ref", intent.ref, prepared.commit, "0".repeat(launch.baseCommit.length)],
      context.signal,
    );
  await mkdir(launch.scratchRoot, { recursive: true, mode: 0o700 });
  const directories = [
    { path: intent.workspace, files: manifest },
    {
      path: join(launch.scratchRoot, "bootstrap-positive"),
      files: { ...manifest, "control.test.js": positive },
    },
    {
      path: join(launch.scratchRoot, "bootstrap-negative"),
      files: { ...manifest, "control.test.js": negative },
    },
  ];
  for (const directory of directories)
    await ownedDirectory(directory.path, directory.files, context.signal);
  const ready = previous.filter((entry) => entry.payload.phase === "ready");
  if (
    ready.length > 1 ||
    ready.some(
      (entry) =>
        entry.payload.phase === "ready" &&
        (entry.payload.commit !== prepared.commit || entry.payload.tree !== prepared.tree),
    )
  )
    throw new Error("bootstrap completion differs from the pinned setup");
  if (ready.length === 0) {
    const checks: string[] = [];
    for (const check of ["toolchain", "positive", "negative"] as const) {
      const tries = previous.filter(
        (entry) => entry.payload.phase === "check-intent" && entry.payload.check === check,
      ).length;
      if (tries >= 3)
        throw new Error(`bootstrap ${check} retry cap exhausted; retain the captured failures`);
      const id = `${check}-${tries + 1}`;
      const workspace =
        check === "toolchain" ? intent.workspace : join(launch.scratchRoot, `bootstrap-${check}`);
      const backend = options.isolation?.(workspace);
      const argv =
        check === "toolchain"
          ? [backend?.nodeProgram ?? process.execPath, "-e", toolchain]
          : ["npm", "test", "--", "--test-reporter=tap"];
      await record(evidence, {
        phase: "check-intent",
        id,
        check,
        argv,
        backend: backend?.name ?? "host",
        files:
          check === "toolchain"
            ? manifest
            : { ...manifest, "control.test.js": check === "positive" ? positive : negative },
      });
      const observation = await context.tests.run(
        () =>
          backend === undefined
            ? runProcessGroup(argv[0] ?? "", argv.slice(1), {
                cwd: workspace,
                env: harnessChildEnvironment().variables,
                signal: context.signal,
                timeoutMs: Math.min(30000, context.remainingWallMs()),
                maxOutputBytes: 64000,
              })
            : backend.run(argv, {
                cwd: workspace,
                environment: harnessChildEnvironment().variables,
                signal: context.signal,
                timeoutMs: Math.min(30000, context.remainingWallMs()),
              }),
        context.signal,
      );
      const captured = await record(evidence, { phase: "check-observed", id, observation });
      checks.push(captured.record.payloadDigest);
      if (!bootstrapCheckPassed(check, observation))
        throw new Error(
          `bootstrap ${check} was not established; inspect ${captured.record.payloadDigest} before implementation`,
        );
    }
    for (const directory of directories)
      await ownedDirectory(directory.path, directory.files, context.signal);
    await record(evidence, {
      phase: "ready",
      commit: prepared.commit,
      tree: prepared.tree,
      checks,
    });
  }
  return {
    baseCommit: prepared.commit,
    workspace: intent.workspace,
    immutablePaths: Object.keys(manifest),
    cleanup: (signal) => cleanupBootstrap(launch, evidence, signal),
  };
}

export async function cleanupBootstrap(
  launch: ControllerLaunch,
  evidence: EvidenceRecorder,
  signal: AbortSignal,
): Promise<void> {
  const intent = bootstrapHistory(evidence).find(
    (entry) => entry.payload.phase === "intent",
  )?.payload;
  if (intent === undefined) return;
  if (
    intent.phase !== "intent" ||
    intent.workspace !== join(launch.scratchRoot, "bootstrap") ||
    intent.baseCommit !== launch.baseCommit ||
    canonicalJson(asJsonValue(intent.files)) !== canonicalJson(asJsonValue(manifest))
  )
    throw new Error("bootstrap cleanup ownership differs from the pinned launch");
  await record(evidence, { phase: "cleanup-intent" });
  for (const [name, files] of [
    ["bootstrap", manifest],
    ["bootstrap-positive", { ...manifest, "control.test.js": positive }],
    ["bootstrap-negative", { ...manifest, "control.test.js": negative }],
  ] as const)
    await ownedDirectory(join(launch.scratchRoot, name), files, signal, true);
  await record(evidence, { phase: "cleanup-completed" });
}

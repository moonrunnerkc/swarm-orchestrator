/**
 * The release's pre-publish smoke: a real sealed task, feature-pubprep, through the packed install.
 * The packed agent and the verifier it pins are installed into an empty prefix and pubprep is
 * cloned at the task's base. A stub model then gives the check author a recorded reply (the check
 * gemma4:31b wrote for this wording in an authoring trial, which held the reference patch in the
 * verifier's container) and gives the loop one write block per file of a patch the corpus judges
 * complete (`reference-2`, which also adds the tests the wording asks for). Everything else is the
 * packed product: the author's check validated at the base, the harness's checks after each
 * change, and the verifier. The run must report complete, and the sealed judge, with the corpus's
 * held-out checks at the tag of the pinned verifier, must find the delivered patch complete too.
 *
 * The replies are fixed, so this shows the packed harness and verifier reach the judged result on
 * a real repository once a correct change is made, not that a live model will make it.
 *
 *   node scripts/release-smoke.mjs <swarm-orchestrator-x.y.z.tgz> [swarm-verify checkout] [swarm-verify tgz]
 *
 * Before the verifier is published and tagged, a checkout of it stands in for the clone at its
 * tag and its packed tarball is installed beside the agent's.
 */
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStubModel } from "../eval/stub-model.mjs";

const root = join(import.meta.dirname, "..");
const entryId = "cmp-feature-pubprep";
const patchName = "reference-2";

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });

/** Runs a command to its end with its output shown and kept. */
function streamed(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
    process.stdout.write(chunk);
  });
  return new Promise((settle) => child.on("close", (code) => settle({ code, out })));
}

async function main() {
  const tarball = resolve(process.argv[2] ?? "");
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const verifier = manifest.dependencies["swarm-verify"];
  const authorReply = await readFile(
    join(root, "scripts", "release-smoke", `${entryId}.author.md`),
    "utf8",
  );
  // Under RUNNER_TEMP where Actions sets it; a container runtime in a VM may share only some paths.
  const scratch = await realpath(
    await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "release-smoke-")),
  );

  const prefix = join(scratch, "prefix");
  await mkdir(prefix);
  await writeFile(join(prefix, "package.json"), '{ "name": "smoke", "private": true }\n');
  const verifierTarball = process.argv[4];
  const tarballs = verifierTarball === undefined ? [tarball] : [resolve(verifierTarball), tarball];
  run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: prefix });
  const bin = (name) => join(prefix, "node_modules", ".bin", name);

  // The sealed criteria and the patch, as the corpus at the pinned verifier's tag holds them.
  const given = process.argv[3];
  const criteria = given === undefined ? join(scratch, "swarm-verify") : resolve(given);
  if (given === undefined)
    run("git", [
      "clone",
      "-q",
      "--depth",
      "1",
      "--branch",
      `v${verifier}`,
      "https://github.com/moonrunnerkc/swarm-verify",
      criteria,
    ]);
  const entryDir = join(criteria, "corpus", entryId);
  const entry = JSON.parse(await readFile(join(entryDir, "entry.json"), "utf8"));
  // R1 is the task as the user wrote it.
  const [first] = JSON.parse(await readFile(join(entryDir, "requirements.json"), "utf8"));
  const task = first?.text;
  if (typeof task !== "string" || task.length === 0)
    throw new Error(`${entryId} names no task wording`);
  const patch = join(entryDir, "patches", `${patchName}.patch`);

  const clone = async (dir) => {
    run("git", ["clone", "-q", `https://github.com/${entry.repository}`, dir]);
    run("git", ["checkout", "-q", entry.base], { cwd: dir });
    run("git", ["config", "user.email", "smoke@example.com"], { cwd: dir });
    run("git", ["config", "user.name", "smoke"], { cwd: dir });
    run("bash", ["-c", entry.setup], { cwd: dir });
  };
  const env = {
    ...process.env,
    SWARM_HOME: join(scratch, "home"),
    SWARM_SIGNING_KEY: generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
  };

  // The loop's replies: each file the patch changes, written whole, then the completion marker.
  const patched = join(scratch, "patched");
  await clone(patched);
  run("git", ["apply", patch], { cwd: patched });
  const files = run("git", ["diff", "--name-only", "HEAD"], { cwd: patched }).trim().split("\n");
  const writes = await Promise.all(
    files.map(
      async (path) => `\`\`\`write ${path}\n${await readFile(join(patched, path), "utf8")}\`\`\``,
    ),
  );

  const work = join(scratch, "work");
  await clone(work);
  const stub = await startStubModel({ replies: [authorReply, ...writes, "SWARM_TASK_COMPLETE"] });
  const swarm = await streamed(
    bin("swarm"),
    [
      "run",
      task,
      "--endpoint",
      `http://127.0.0.1:${stub.port}/v1`,
      "--model",
      "replay",
      "--approve",
      "auto",
      "--max-steps",
      "20",
    ],
    { cwd: work, env },
  );
  await stub.close();
  const state = /^state +(\S+)/m.exec(swarm.out)?.[1];
  if (swarm.code !== 0 || state !== "complete")
    throw new Error(`swarm run reported ${state ?? "no state"} (exit ${swarm.code}), not complete`);
  const delivered = /^patch +(\S+)/m.exec(swarm.out)?.[1] ?? "";

  // The sealed judge: a fresh clone, the held-out checks sealed, the entry's declared checks.
  const judged = join(scratch, "judged");
  await clone(judged);
  if (entry.heldOut !== null) {
    await cp(join(entryDir, "held-out"), judged, { recursive: true });
    await writeFile(
      join(judged, "swarm.toml"),
      `[checks]\nheld-out = { command = "${entry.heldOut.command}", kind = "test" }\n`,
    );
    run(bin("swarm-verify"), ["init", "--seal", entry.heldOut.glob], { cwd: judged, env });
  }
  await cp(join(entryDir, "swarm.toml"), join(judged, "swarm.toml"));
  const verdict = join(scratch, "verdict");
  await streamed(
    bin("swarm-verify"),
    [
      "verify",
      "--base",
      entry.base,
      "--patch",
      delivered,
      "--isolation",
      entry.isolation,
      "--dependencies",
      entry.isolation === "host" ? "linked" : "prepare",
      "--requirements",
      join(entryDir, "requirements.json"),
      "--out",
      verdict,
    ],
    { cwd: judged, env },
  );
  const statement = JSON.parse(await readFile(join(verdict, "statement.json"), "utf8"));
  if (statement.predicate.state !== "complete")
    throw new Error(
      `the sealed judge found the delivered patch ${statement.predicate.state}, not complete`,
    );
  console.log(`release smoke: ${entryId} complete, self-reported and judged`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

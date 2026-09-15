#!/usr/bin/env node
// Every command the help text promises, run from the packed tarball installed into an empty
// directory. Testing the working tree tests something no user installs: a file left out of
// `files` in package.json is present locally and missing everywhere else, and the command
// that reads it works here and fails there.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repository = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "swarm-packed-"));
let failures = 0;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

try {
  const packed = run("npm", ["pack", "--json", "--pack-destination", scratch], {
    cwd: repository,
  });
  // `npm pack` runs the prepare script, whose build output lands on the same stream ahead of
  // the JSON, so the document starts at the first bracket rather than at the first byte.
  const tarball = join(scratch, JSON.parse(packed.slice(packed.indexOf("[")))[0].filename);

  const install = join(scratch, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), '{"name":"packed-check","private":true}\n');
  run("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: install });

  const swarm = join(install, "node_modules", ".bin", "swarm");

  // The workspace every command that needs one is pointed at: a real repository, so a failure
  // is the command's and not git's.
  const workspace = join(scratch, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "package.json"), '{"name":"w","version":"1.0.0"}\n');
  run("git", ["init", "-q"], { cwd: workspace });
  run("git", ["add", "-A"], { cwd: workspace });
  run("git", ["-c", "user.email=c@i", "-c", "user.name=ci", "commit", "-qm", "init"], {
    cwd: workspace,
  });

  const usage = run(swarm, ["help"]);
  const documented = [
    ...new Set(
      usage
        .split("\n")
        .map((line) => /^ {2}swarm ([a-z][a-z-]*)/.exec(line)?.[1])
        .filter((name) => name !== undefined),
    ),
  ];

  if (documented.length < 5) {
    console.error(`only ${documented.length} command(s) found in the help text; expected more`);
    process.exit(1);
  }

  const { commandDefinitions } = await import(
    pathToFileURL(
      join(install, "node_modules", "swarm-orchestrator", "dist", "cli-command-definitions.js"),
    )
  );
  const home = join(scratch, "home");
  mkdirSync(home);
  for (const name of documented) {
    const contract = commandDefinitions.find((command) => command.name === name)?.smoke;
    if (contract === undefined) {
      console.error(`FAIL no behavioral smoke contract for ${name}`);
      failures += 1;
      continue;
    }
    let status = 0;
    let output = "";
    try {
      output = run(swarm, [name, ...contract.args], {
        cwd: workspace,
        timeout: 60000,
        env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
      });
    } catch (cause) {
      status = cause.status;
      output = `${cause.stdout ?? ""}${cause.stderr ?? ""}`;
    }
    const passed =
      contract.exits.includes(status) &&
      new RegExp(contract.output, "i").test(output) &&
      !/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|TypeError/.test(output);
    if (!passed) {
      console.error(
        `FAIL swarm ${name}: exit ${status}, expected ${contract.exits.join("/")} and ${contract.output}\n${output}`,
      );
      failures += 1;
    } else console.log(`ok   swarm ${name}: expected exit ${status} and diagnostic`);
  }

  // The standalone verifier, packed from its workspace and installed beside the full CLI. It
  // has to meet the same behavioral contracts for the commands it carries, and `verify` over a
  // committed bundle has to print the same bytes through both binaries, with the tamper demo's
  // flipped byte refused by the packed verifier the way it is refused by the embedded one.
  run(process.execPath, [join(repository, "scripts", "build-swarm-verify.mjs")], {
    cwd: repository,
  });
  const packedVerify = run("npm", ["pack", "--json", "--pack-destination", scratch], {
    cwd: join(repository, "packages", "swarm-verify"),
  });
  const verifyPacked = JSON.parse(packedVerify.slice(packedVerify.indexOf("[")))[0];
  console.log(`swarm-verify tarball: ${verifyPacked.filename}, ${verifyPacked.size} bytes packed`);
  run("npm", ["install", "--no-audit", "--no-fund", join(scratch, verifyPacked.filename)], {
    cwd: install,
  });
  const swarmVerify = join(install, "node_modules", ".bin", "swarm-verify");
  for (const contract of commandDefinitions.filter((command) => command.model === "none")) {
    let status = 0;
    let output = "";
    try {
      output = run(swarmVerify, [contract.name, ...contract.smoke.args], {
        cwd: workspace,
        timeout: 60000,
        env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
      });
    } catch (cause) {
      status = cause.status;
      output = `${cause.stdout ?? ""}${cause.stderr ?? ""}`;
    }
    const passed =
      contract.smoke.exits.includes(status) &&
      new RegExp(contract.smoke.output, "i").test(output) &&
      !/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|TypeError/.test(output);
    if (!passed) {
      console.error(`FAIL swarm-verify ${contract.name}: exit ${status}\n${output}`);
      failures += 1;
    } else
      console.log(`ok   swarm-verify ${contract.name}: expected exit ${status} and diagnostic`);
  }

  const bundle = join(repository, "docs", "evidence", "2026-08-18", "live-frontier");
  const signer = "sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a";
  const verifyWith = (binary, target) => {
    try {
      return {
        status: 0,
        output: run(binary, ["verify", target, "--signer", signer], { cwd: workspace }),
      };
    } catch (cause) {
      return { status: cause.status, output: `${cause.stdout ?? ""}` };
    }
  };
  const throughSwarm = verifyWith(swarm, bundle);
  const throughVerify = verifyWith(swarmVerify, bundle);
  if (throughSwarm.status !== 0 || throughVerify.output !== throughSwarm.output) {
    console.error(
      `FAIL swarm-verify verify differs from swarm verify on the committed bundle (exit ${throughSwarm.status} and ${throughVerify.status})`,
    );
    failures += 1;
  } else console.log("ok   swarm-verify verify prints the bytes swarm verify prints, exit 0");

  const tampered = join(scratch, "tampered");
  run(process.execPath, [join(bundle, "..", "tamper-demo", "flip-one-byte.mjs"), bundle, tampered]);
  const refused = verifyWith(swarmVerify, tampered);
  if (refused.status !== 1 || !refused.output.includes("integrity:  invalid")) {
    console.error(`FAIL swarm-verify verify accepted the tampered bundle (exit ${refused.status})`);
    failures += 1;
  } else console.log("ok   swarm-verify verify refuses the bundle one byte later, exit 1");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} documented command(s) failed their packaged behavioral contract`);
  process.exit(1);
}
console.log("every documented command met its packaged behavioral contract");

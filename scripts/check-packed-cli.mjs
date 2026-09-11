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
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} documented command(s) failed their packaged behavioral contract`);
  process.exit(1);
}
console.log("every documented command met its packaged behavioral contract");

#!/usr/bin/env node
// Every command the help text promises, run from the packed tarball installed into an empty
// directory. Testing the working tree tests something no user installs: a file left out of
// `files` in package.json is present locally and missing everywhere else, and the command
// that reads it works here and fails there.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  // A command that needs an argument gets one that is valid but does nothing, so what is under
  // test is whether the command exists in the package rather than what it does.
  const argumentsFor = {
    gates: ["--workspace", workspace],
    init: ["--workspace", workspace],
    replay: [join(scratch, "absent-bundle")],
    review: [join(scratch, "absent-bundle")],
    verify: [join(scratch, "absent-bundle")],
    parallel: ["--tasks", join(scratch, "absent-tasks.txt")],
    select: ["--shortlist", "bundled"],
  };

  for (const name of documented) {
    try {
      run(swarm, [name, ...(argumentsFor[name] ?? [])], { cwd: workspace });
      console.log(`ok   swarm ${name}`);
    } catch (cause) {
      const output = `${cause.stdout ?? ""}${cause.stderr ?? ""}`;
      // A command that ran and reported something is present. One the build does not have
      // reports that it does not have it, which is the failure this looks for.
      const missing =
        /is not a (?:command|swarm command)/i.test(output) ||
        /Cannot find module/i.test(output) ||
        /ERR_MODULE_NOT_FOUND/.test(output);
      if (missing) {
        console.error(`FAIL swarm ${name}: the packed build does not have it\n${output}`);
        failures += 1;
      } else {
        console.log(`ok   swarm ${name} (exited non-zero, which is a command that ran)`);
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} documented command(s) are missing from the packed build`);
  process.exit(1);
}
console.log("every documented command exists in the packed build");

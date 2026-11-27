#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "swarm-verify/node-floor-check";

import { dispatch, verifierCommands } from "swarm-verify/cli";
import { buildVersion } from "./build-version.ts";
import { usageFor } from "./cli-command-definitions.ts";

process.exitCode = await dispatch(
  "swarm",
  {
    run: async (args, signal) => (await import("./cli-run.ts")).run(args, signal),
    // The installed verifier's own commands, not a copy of them. Replay stays swarm-verify's.
    verify: verifierCommands.verify,
    // The conventions profile is learned and approved here; anything else is the verifier's init.
    init: async (args) =>
      (await import("./cli-conventions.ts")).initCommand(args, verifierCommands.init),
    ci: verifierCommands.ci,
    doctor: async (args) => (await import("./cli-doctor.ts")).doctorCommand(args),
  },
  process.argv.slice(2),
  { usage: usageFor("swarm"), version: buildVersion },
);

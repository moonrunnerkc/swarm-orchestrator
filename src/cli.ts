#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { verifierCommands } from "swarm-verify/cli";
import { dispatch } from "./cli-main.ts";

process.exitCode = await dispatch(
  "swarm",
  {
    run: async (args) => (await import("./cli-run.ts")).run(args),
    // The installed verifier's own commands, not a copy of them. Replay stays swarm-verify's.
    verify: verifierCommands.verify,
    init: verifierCommands.init,
    ci: verifierCommands.ci,
    doctor: async (args) => (await import("./cli-doctor.ts")).doctorCommand(args),
  },
  process.argv.slice(2),
);

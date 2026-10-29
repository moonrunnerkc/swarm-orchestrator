#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { dispatch } from "./cli-main.ts";

process.exitCode = await dispatch(
  "swarm",
  {
    run: async (args) => (await import("./cli-run.ts")).run(args),
    verify: async (args) => (await import("./cli-verify.ts")).verify(args),
    init: async (args) => (await import("./cli-init.ts")).init(args),
    ci: async (args) => (await import("./cli-verify.ts")).ci(args),
    doctor: async (args) => (await import("./cli-doctor.ts")).doctorCommand(args),
  },
  process.argv.slice(2),
);

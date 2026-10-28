#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { dispatch } from "./cli-main.ts";

// The verifier alone: no model client, no agent loop. The verifier build refuses a closure that
// reaches either.
process.exitCode = await dispatch(
  "swarm-verify",
  {
    verify: async (args) => (await import("./cli-verify.ts")).verify(args),
    init: async (args) => (await import("./cli-init.ts")).init(args),
    ci: async (args) => (await import("./cli-verify.ts")).ci(args),
  },
  process.argv.slice(2),
);

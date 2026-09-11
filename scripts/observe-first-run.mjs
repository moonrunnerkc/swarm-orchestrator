#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSystemClock } from "../dist/cli-runtime-inputs.js";
import {
  firstRunProtocolSchema,
  recordFirstRunObservation,
} from "../dist/eval/first-run-observation.js";
import { openEvidenceSession } from "../dist/evidence/session.js";

const [protocolPath, eventPath] = process.argv.slice(2);
if (protocolPath === undefined || eventPath === undefined)
  throw new Error(
    "usage: node scripts/observe-first-run.mjs <protocol.json> <event.json>; observations require participant consent",
  );
const protocol = firstRunProtocolSchema.parse(JSON.parse(await readFile(protocolPath, "utf8")));
const clock = createSystemClock();
const evidence = await openEvidenceSession({
  root: join(homedir(), ".swarm", "first-run-observations"),
  sessionId: `${protocol.phase}-${protocol.participant}`,
  clock,
});
const observed = await recordFirstRunObservation(
  protocol,
  JSON.parse(await readFile(eventPath, "utf8")),
  evidence,
  clock,
);
process.stdout.write(`${JSON.stringify({ ...observed, ledger: evidence.ledgerPath })}\n`);

/**
 * Replays the registered decision point (adaptive-decision-v1) over a retained session ledger,
 * with no model: the conversation as the loop held it is rebuilt from the ledger's recorded
 * transcript messages, the point fires where its rule says (40 percent of the loop's steps or of
 * its wall, whichever comes first), and the working state, signals and chosen action are printed.
 * What a diagnosis would have answered is not replayed: that is model output and only a live run
 * can show it.
 *
 *   node docs/evidence/2026-10-22-adaptive/replay-decision-point.mjs <session-directory>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chooseDecision,
  decisionSignals,
  deriveWorkingState,
  describeWorkingState,
} from "../../../src/core/working-state.ts";

const share = 0.4;
const directory = process.argv[2];
const records = readFileSync(join(directory, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const payload = (record) => {
  const bytes = readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest)
    throw new Error(`payload of record ${record.sequence} differs from its digest`);
  return JSON.parse(bytes);
};

const started = records.find((record) => record.type === "session-started");
const spec = records.find((record) => record.type === "run-spec-sealed");
const maxSteps = payload(started).maxSteps;
const maxWallMs = payload(spec).spec.budgets.maxWallMs;
const firstCall = records.find((record) => record.type === "model-call-started");
const atStep = Math.max(1, Math.ceil(maxSteps * share));
const atElapsedMs = Math.floor(maxWallMs * share);

const messages = [];
let steps = 0;
let fired = null;
for (const record of records) {
  if (record.type !== "transcript-component") continue;
  const value = payload(record);
  if (value.kind !== "message") continue;
  messages.push(value.value);
  if (value.value.role === "assistant") steps += 1;
  // The point fires after a step's tool results are in, as the loop's own check does.
  if (value.value.role === "tool" && fired === null) {
    const elapsed = record.timestamp - firstCall.timestamp;
    if (steps >= atStep || elapsed >= atElapsedMs) {
      fired = { step: steps, elapsedMs: elapsed, sequence: record.sequence, by: steps >= atStep ? "step" : "wall" };
      break;
    }
  }
}

if (fired === null) {
  console.log(JSON.stringify({ session: directory.split("/").at(-1), fired: null, note: "the loop ended before the decision point" }, null, 2));
} else {
  const state = deriveWorkingState(messages);
  const signals = decisionSignals(state);
  console.log(
    JSON.stringify(
      {
        session: directory.split("/").at(-1),
        evidence: "replay of recorded messages through the registered policy; no model call, so no diagnosis content",
        loop: { maxSteps, maxWallMs, atStep, atElapsedMs },
        fired,
        remaining: { steps: maxSteps - fired.step },
        signals,
        chosen: chooseDecision(signals),
        workingState: describeWorkingState(state, { candidate: null }),
      },
      null,
      2,
    ),
  );
}

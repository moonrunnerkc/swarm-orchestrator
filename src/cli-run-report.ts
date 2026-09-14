import type { EvidenceRecorder } from "./evidence/session.ts";
import type { AutoResolveOutcome } from "./gates/auto-resolve.ts";
import type { BondOutcome } from "./gates/bond-runner.ts";
import { vacuousBlockingBonds } from "./gates/engine.ts";
import { describeEscalation } from "./gates/escalation.ts";
import { citedRecords, type GateCycle, outstandingJustifications } from "./gates/gate-runner.ts";

export function describeCycle(cycle: GateCycle): string {
  return cycle.runs
    .map((gate) => {
      const label = gate.status === "not-applicable" ? "n/a" : gate.status;
      const advisory = gate.severity === "advisory" ? " (advisory)" : "";
      return `  ${label.padEnd(8)} ${gate.gateId}${advisory}: ${gate.detail}`;
    })
    .join("\n");
}

/** Written through `note`, so an interactive screen holds them until it comes down. */
export function reportGates(
  outcome: AutoResolveOutcome,
  evidence: EvidenceRecorder,
  note: (line: string) => void,
): void {
  // Said before the gate table rather than after it, because a table of passes over a tree
  // nothing touched is the most misleading thing this tool can print. A model that answered in
  // prose, or emitted its tool calls as text the protocol never parsed, reaches here having
  // done nothing, stops for the honest reason "completed", and every gate then passes over an
  // empty diff. A task can legitimately change nothing, so this states the fact rather than
  // calling it a failure.
  if (outcome.finalCycle.measures.changedFiles === 0) {
    note(
      "\nno files were changed. The gates below measured an unchanged workspace, so they say " +
        "nothing about work being done.",
    );
  }
  note(`\ngates:\n${describeCycle(outcome.finalCycle)}`);

  for (const attempt of outcome.attempts) {
    note(
      `attempt ${attempt.attempt}: ${attempt.decision.accepted ? "accepted" : "REJECTED"} - ` +
        `${attempt.decision.detail}`,
    );
  }

  for (const run of outstandingJustifications(outcome.finalCycle, citedRecords(evidence))) {
    note(
      `\nthe ${run.gateId} gate asked for a justification and no claim cites its record ` +
        `${run.record}. This does not block, and the bundle shows it unanswered.`,
    );
  }

  if (outcome.escalation !== null) {
    note(`\n${describeEscalation(outcome.escalation)}`);
  }
}

/**
 * What each pass was shown to be worth. Said after the table, since the table is what the
 * gates decided and this is whether that decision could have gone the other way.
 */
export function reportBonds(bonds: readonly BondOutcome[], note: (line: string) => void): void {
  if (bonds.length === 0) {
    return;
  }
  note("\nbonds, one per gate that passed:");
  for (const bond of bonds) {
    const mark =
      bond.verdict === "held"
        ? "held"
        : bond.verdict === "vacuous"
          ? "VACUOUS"
          : bond.verdict === "not-bonded"
            ? "not bonded"
            : bond.verdict;
    note(`  ${bond.gateId}: ${mark}. ${bond.detail}`);
  }
  const vacuous = vacuousBlockingBonds(bonds);
  if (vacuous.length > 0) {
    note(
      `\n${vacuous.map((bond) => bond.gateId).join(", ")}: a blocking gate passed over a change it ` +
        "had to refuse, so its pass has not been shown capable of failing and this run is not green.",
    );
  }
}

import type { EvidenceRecorder } from "../evidence/session.ts";
import { openFindings } from "./findings.ts";
import type { StopReason, Verification } from "./loop-types.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import { runVerificationStep } from "./verification-step.ts";

/** How a finding is repaired: from a reproduction, at its cause, with the legitimate case kept. */
const repair =
  "Repair each at its cause: reproduce the failure it names with a command and read what it prints, say in one line what in the code lets it happen, look for other paths that share that cause, and fix it where the decision is made. Keep the legitimate use working; a change that refuses everything fails too. Never edit, delete or special-case a check.";

/** What follows a change that moved nothing: a different diagnosis, not the same edit again. */
const retry =
  "Your last change left these findings exactly as they were, so their cause is not where you changed. Do not repeat it: read the code the failing request or test actually runs through, name a different cause, and fix that.";

const hung =
  " A check timed out: a test that leaves a server listening, a timer or a connection open keeps its runner from exiting, most often after a failed assertion. Close what each test opens before its first assertion.";

/** What one verification left the loop to do. */
export type VerifyOutcome =
  | { readonly kind: "stop"; readonly stop: StopReason; readonly reason: string | null }
  | {
      readonly kind: "continue";
      /** What the model reads in answer: why the task is not complete, and what to act on. */
      readonly answer: string;
      /** The findings to keep showing at the end of every prompt, and their ledger record. */
      readonly findings: string | null;
      readonly checked: string | null;
    };

/**
 * Verifies the tree under the record, the harness's choice once every check passes or the
 * model's when it marks the task complete, and says what follows: complete, blocked, a stop
 * because the only missing piece is evidence no edit can supply, or findings to act on. A second
 * completion on an unchanged tree and record is answered with the same findings once, then stops.
 */
export function createVerifyStep(input: {
  readonly verify: (record: RequirementRecord) => Promise<Verification>;
  readonly evidence: EvidenceRecorder;
}) {
  let last: Verification | null = null;
  let nudged = false;
  let count = 0;
  // The open findings as last read, and how many changes in a row left them as they were.
  let open = "";
  let unmoved = 0;
  return {
    verifications: () => count,
    last: () => last,
    async run(record: RequirementRecord, by: "harness" | "model"): Promise<VerifyOutcome> {
      const { judged, repeated, evidence } = await runVerificationStep({
        verify: input.verify,
        record,
        last,
        evidence: input.evidence,
      });
      last = judged;
      if (judged.reused !== true) count += 1;
      if (judged.state === "complete") return { kind: "stop", stop: "complete", reason: null };
      if (judged.state === "blocked")
        return { kind: "stop", stop: "blocked", reason: judged.reasons?.[0] ?? null };
      // Only independent evidence is missing, and no edit of the model's can write it.
      if (judged.independenceMissing === true) {
        const why = judged.reasons?.find((one) => one.startsWith("independent evidence missing"));
        return { kind: "stop", stop: "incomplete", reason: why ?? "independent evidence missing" };
      }
      const said = `${by === "harness" ? "every check passed, so the harness verified the tree" : "the task marked complete"}; the verifier found it ${judged.state} [evidence ${evidence}]`;
      if (repeated && by === "model") {
        if (nudged)
          return {
            kind: "stop",
            stop: "no-progress",
            reason: "the task was marked complete again with no change since the last verification",
          };
        nudged = true;
        return {
          kind: "continue",
          answer: [
            `(${said})`,
            "Marking the task complete again changes nothing: the tree and the requirements are the ones just verified, so the findings are the same:",
            ...openFindings(judged.feedback),
            "Change the tree, or send a requirements block that maps the evidence the findings name, before marking it complete.",
          ].join("\n"),
          findings: judged.feedback,
          checked: evidence,
        };
      }
      const now = openFindings(judged.feedback).join("\n");
      unmoved = !repeated && now !== "" && now === open ? unmoved + 1 : 0;
      open = now;
      if (unmoved >= 3)
        return {
          kind: "stop",
          stop: "no-progress",
          reason: `three changes in a row left the verifier's findings exactly as they were: ${now.split("\n")[0]}`,
        };
      return {
        kind: "continue",
        answer: `(${said}) The verifier did not find the task complete. Act on its findings; the harness runs the checks again after your next change. ${unmoved > 0 ? retry : repair}${/timed out/.test(judged.feedback) ? hung : ""}`,
        findings: judged.feedback,
        checked: evidence,
      };
    },
  };
}

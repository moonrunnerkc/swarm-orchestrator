import type { SourceIdentity } from "../gates/change-source.ts";
import type { IndependentVerification } from "../gates/independent-verification.ts";
import { scrubText } from "./scrub.ts";

/** Render untrusted text as bounded literal Markdown without links, HTML, or commands. */
export function reviewerText(value: string): string {
  const scrubbed = scrubText(value).value;
  const bounded = scrubbed.length > 2000 ? `${scrubbed.slice(0, 1988)} [truncated]` : scrubbed;
  return bounded
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/([\\`*_{}[\]()#+.!|:-])/g, "\\$1");
}

/** A concise projection of the recorded assessment, never a second verdict engine. */
export function renderCiSummary(options: {
  result: IndependentVerification;
  source: SourceIdentity;
  executionTrust: string;
  bundleDirectory: string;
  assessmentDigest: string;
  changedPaths?: readonly string[];
}): string {
  const { result, source } = options;
  const text = reviewerText;
  const evidenceLink = `[assessment](bundle/blobs/${options.assessmentDigest.replace("sha256:", "")}.json)`;
  const lines = [
    "# Swarm verification",
    "",
    `Result: ${result.verified ? "verified" : "not verified"}. Regression: ${result.regression}. Task: ${result.task}.`,
    "",
    `Change: ${source.mode}; head ${source.head ?? "patch input"}; patch ${source.patchDigest}.`,
    `Changed files: ${(options.changedPaths ?? []).slice(0, 50).map(text).join(", ") || "none"}.`,
    `Target base: ${source.targetBase}. Comparison base: ${source.comparisonBase} (${source.comparison}).`,
    "",
    `Execution: ${text(options.executionTrust)}. Integrity: exported signed bundle; independently verify it. Signer trust: not established by this run.`,
    `Assessment evidence: ${options.assessmentDigest}. Bundle: ${text(options.bundleDirectory)}.`,
    "",
    "| Check | Result | Finding |",
    "| --- | --- | --- |",
    ...result.checks
      .slice(0, 100)
      .map(
        (check) =>
          `| ${text(check.id)} | ${check.status} | ${text(check.detail)} (${evidenceLink}) |`,
      ),
    "",
    `Unmeasured: ${result.unmeasured ? "regression unavailable" : "see individual checks"}; oracle reach ${result.oracleReach}; oracle bond ${result.oracleBond}.`,
    `Next action: ${text(
      result.refusal ??
        (result.goalAcceptance?.checkResults?.find((check) => check.status === "unjudged")
          ?.detail ||
          result.advice ||
          (result.verified
            ? "Review the recorded scope, assurance dimensions and signer policy before accepting the change."
            : "Supply missing acceptance criteria or repair the failing checks, then verify again.")),
    )}`,
  ];
  if (result.checks.length > 100)
    lines.push("Summary truncated after 100 checks; consult the assessment digest in the bundle.");
  if ((options.changedPaths?.length ?? 0) > 50)
    lines.push(`Changed-file list truncated; consult ${evidenceLink}.`);
  for (const check of result.goalAcceptance?.checkResults ?? [])
    lines.push(
      `Behavior ${text(check.id)}: ${check.status}; ${text(check.detail)} ([evidence](bundle/blobs/${check.record.replace("sha256:", "")}.json)).`,
    );
  for (const obligation of result.goalAcceptance?.obligations ?? [])
    lines.push(
      `Requirement ${text(obligation.id)}: ${obligation.status}; checks ${obligation.checks.map(text).join(", ")} (${evidenceLink}).`,
    );
  for (const obligation of result.acceptance?.obligations ?? []) {
    lines.push(`Requirement: ${text(JSON.stringify(obligation))} (${evidenceLink}).`);
  }
  return `${lines.join("\n")}\n`;
}

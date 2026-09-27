import type { SourceIdentity } from "../gates/change-source.ts";
import type { IndependentVerification } from "../gates/independent-verification.ts";
import { scrubText } from "./scrub.ts";

/** Render untrusted text as bounded literal Markdown without links, HTML, or commands. */
export function reviewerText(value: string): string {
  return scrubText(value)
    .value.slice(0, 2000)
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
}): string {
  const { result, source } = options;
  const text = reviewerText;
  const lines = [
    "# Swarm verification",
    "",
    `Result: ${result.verified ? "verified" : "not verified"}. Regression: ${result.regression}. Task: ${result.task}.`,
    "",
    `Change: ${source.mode}; head ${source.head ?? "patch input"}; patch ${source.patchDigest}.`,
    `Target base: ${source.targetBase}. Comparison base: ${source.comparisonBase} (${source.comparison}).`,
    "",
    `Execution: ${text(options.executionTrust)}. Integrity: exported signed bundle; independently verify it. Signer trust: not established by this run.`,
    `Assessment evidence: ${options.assessmentDigest}. Bundle: ${text(options.bundleDirectory)}.`,
    "",
    "| Check | Result | Finding |",
    "| --- | --- | --- |",
    ...result.checks
      .slice(0, 100)
      .map((check) => `| ${text(check.id)} | ${check.status} | ${text(check.detail)} |`),
    "",
    `Unmeasured: ${result.unmeasured ? "regression unavailable" : "see individual checks"}; oracle reach ${result.oracleReach}; oracle bond ${result.oracleBond}.`,
    `Next action: ${text(
      result.refusal ??
        (result.advice ||
          (result.verified
            ? "Review the recorded scope, assurance dimensions and signer policy before accepting the change."
            : "Supply missing acceptance criteria or repair the failing checks, then verify again.")),
    )}`,
  ];
  if (result.checks.length > 100)
    lines.push("Summary truncated after 100 checks; consult the assessment digest in the bundle.");
  for (const obligation of result.acceptance?.obligations ?? []) {
    lines.push(`Requirement: ${text(JSON.stringify(obligation))}`);
  }
  return `${lines.join("\n")}\n`;
}

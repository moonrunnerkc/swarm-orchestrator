import { join } from "node:path";
import { bundleFileNames } from "../evidence/bundle-manifest.ts";
import { formatElapsed } from "./elapsed.ts";
import { fileUrl } from "./hyperlink.ts";
import type { EvidenceLocation } from "./open-path.ts";
import { truncateToWidth } from "./terminal-text.ts";

/**
 * What a finished run produced, named by what each artifact is for. The same lines serve the
 * interactive panel, the plain stream, and `swarm review`, so there is one account of a
 * bundle rather than three that can disagree.
 */

/**
 * Whether the bundle was checked in this session. "Opening a file is not verifying it": the
 * panel may say verified only where the embedded verifier ran here and exited zero, and it
 * names the exit code either way.
 */
export type BundleVerification =
  | { readonly kind: "verified"; readonly exitCode: 0 }
  | { readonly kind: "refused"; readonly exitCode: number; readonly detail: string }
  | { readonly kind: "not-run"; readonly reason: string };

/**
 * What the run that wrote the bundle took, as the harness measured it: the clock, the loop's
 * own step count, the token count the provider reported, and the price of those tokens at the
 * published rate, or null where no rate could be read. Absent when the summary is of a past
 * bundle, where nothing ran.
 */
export interface RunFacts {
  readonly durationMs: number;
  readonly steps: number;
  readonly tokensUsed: number;
  readonly costUsd: number | null;
}

export interface EvidenceSummary {
  readonly location: EvidenceLocation;
  readonly recordCount: number;
  readonly claimsVerified: number;
  /** The interesting half: what the harness looked at and would not call proven. */
  readonly claimsRefused: number;
  readonly verification: BundleVerification;
  readonly run?: RunFacts;
}

/** Dollars, with the cents that matter: a fraction of a cent is shown rather than rounded to none. */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) {
    return "cost not priced";
  }
  return costUsd > 0 && costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} tokens`;
}

/** `11m 14s, 23 steps, 122,734 tokens, $0.00`, with the joiner the caller's screen uses. */
export function describeRun(run: RunFacts, separator: string): string {
  return [
    formatElapsed(run.durationMs),
    `${run.steps} steps`,
    formatTokens(run.tokensUsed),
    formatCost(run.costUsd),
  ].join(separator);
}

/** `node <bundle>/verify.mjs <bundle>`, as a vector rather than a string. */
export function verifyCommandFor(
  location: EvidenceLocation,
  nodeExecutable = "node",
): { readonly file: string; readonly args: readonly string[] } {
  return {
    file: nodeExecutable,
    args: [join(location.directory, bundleFileNames.verifier), location.directory],
  };
}

/** The same vector, spelled the way a person retypes it. */
export function verifyCommandText(location: EvidenceLocation): string {
  const command = verifyCommandFor(location);
  return [command.file, ...command.args].join(" ");
}

export function describeVerification(verification: BundleVerification): string {
  switch (verification.kind) {
    case "verified":
      return `bundle verified in this run: verify.mjs exited ${verification.exitCode}`;
    case "refused":
      return `bundle REFUSED by its own verifier: exit ${verification.exitCode}, ${verification.detail}`;
    case "not-run":
      return `not verified in this run (${verification.reason})`;
  }
}

/**
 * The panel as lines. Truncated to the width given, so the same text reads at 80 columns and
 * at 200 without a second layout. A null width is a stream rather than a screen, where a
 * truncated path is a path nobody can retype and there is no row to overflow.
 */
export function describeEvidence(
  summary: EvidenceSummary,
  columns: number | null,
): readonly string[] {
  return evidencePanelRows(summary, columns).map((row) => row.text);
}

export interface EvidencePanelRow {
  readonly text: string;
  /** A file URL for the path the row names, where the row names one a person opens. */
  readonly link?: string;
}

/**
 * The same panel as rows, with the two paths a person opens carried as links beside their
 * text. The text is what the plain stream prints, byte for byte; the link is what a terminal
 * that understands OSC 8 is given as well.
 */
export function evidencePanelRows(
  summary: EvidenceSummary,
  columns: number | null,
): readonly EvidencePanelRow[] {
  const directory = summary.location.directory;
  const reviewPage = join(directory, bundleFileNames.review);
  const rows: readonly (readonly [string, string, string | null])[] = [
    ["the page a person reads", reviewPage, fileUrl(reviewPage)],
    ["the bundle a stranger verifies", directory, fileUrl(directory)],
    ["its own verifier, needing nothing installed", verifyCommandText(summary.location), null],
    ["the chain every record is on", join(directory, bundleFileNames.ledger), null],
  ];

  const toWidth = (line: string): string =>
    columns === null ? line : truncateToWidth(line, Math.max(20, columns));

  return [
    { text: "what this run produced" },
    { text: "" },
    ...rows.map(([label, value, link]) => ({
      text: toWidth(`  ${label}: ${value}`),
      ...(link === null ? {} : { link }),
    })),
    { text: "" },
    {
      text: toWidth(
        `  ${summary.recordCount} records. The harness verified ${summary.claimsVerified} ` +
          `claim(s) and refused ${summary.claimsRefused}.`,
      ),
    },
    { text: toWidth(`  ${describeVerification(summary.verification)}`) },
    ...(summary.verification.kind === "verified"
      ? []
      : [{ text: toWidth(`  check it yourself: ${verifyCommandText(summary.location)}`) }]),
    ...(summary.run === undefined
      ? []
      : [{ text: toWidth(`  the run took ${describeRun(summary.run, ", ")}`) }]),
  ];
}

/**
 * The finish card's body: the two paths a person opens first, each a link, then the verifier
 * command, then the counts on one line. The verdict line above it is the screen's, since only
 * the screen holds the view the verdict comes from.
 */
export function finishCardRows(
  summary: EvidenceSummary,
  columns: number | null,
): readonly EvidencePanelRow[] {
  const directory = summary.location.directory;
  const reviewPage = join(directory, bundleFileNames.review);
  const toWidth = (line: string): string =>
    columns === null ? line : truncateToWidth(line, Math.max(20, columns));
  const verified =
    summary.verification.kind === "verified"
      ? `bundle verified here (exit ${summary.verification.exitCode})`
      : describeVerification(summary.verification);
  return [
    { text: toWidth(`  review page   ${reviewPage}`), link: fileUrl(reviewPage) },
    { text: toWidth(`  bundle        ${directory}`), link: fileUrl(directory) },
    { text: toWidth(`  verify        ${verifyCommandText(summary.location)}`) },
    {
      text: toWidth(
        `  ${summary.recordCount} records, ${summary.claimsVerified} claims verified, ` +
          `${summary.claimsRefused} refused, ${verified}`,
      ),
    },
  ];
}

import type { RequirementOutcome } from "swarm-verify";

/**
 * A requirement as the user worded it, as the model read it, and as the verifier judged it, side
 * by side, so a reading that drifted from the wording shows without opening the session.
 */

/** The model's reading: the kind and every piece of evidence it said would show the requirement. */
export function readingOf(one: RequirementOutcome): string {
  const { tests, checks, structure, packages } = one.expected;
  const parts = [
    ...packages.map(
      (claim) => `${claim.ecosystem}:${claim.name} ${claim.version ?? "at any new version"}`,
    ),
    ...(tests.length === 0
      ? []
      : [
          `tests ${tests.map((test) => (test.file === undefined ? test.name : `${test.file}::${test.name}`)).join(", ")}`,
        ]),
    ...(checks.length === 0 ? [] : [`checks ${checks.join(", ")}`]),
    ...structure.map((claim) => {
      const by = claim.authority === "independently-generated" ? " (authored apart)" : "";
      if (claim.symbol !== undefined) {
        const form =
          claim.provides === true
            ? "provides"
            : claim.absent === true
              ? "no longer defines"
              : "defines";
        return `${claim.path} ${form} ${claim.symbol}${by}`;
      }
      const text = JSON.stringify(claim.contains);
      if (claim.absent === true)
        return claim.contains === undefined
          ? `${claim.path} absent${by}`
          : `${claim.path} lacks ${text}${by}`;
      return claim.contains === undefined
        ? `${claim.path} exists${by}`
        : `${claim.path} contains ${text}${by}`;
    }),
    ...(one.assumptions.length === 0 ? [] : [`assumes ${one.assumptions.join("; ")}`]),
  ];
  return parts.length === 0
    ? `${one.kind}, with no evidence named`
    : `${one.kind}: ${parts.join("; ")}`;
}

/** The versions the wording itself holds the change to, read by code; null where it names none. */
export function heldTo(one: RequirementOutcome): string | null {
  if (one.versions.length === 0) return null;
  return one.versions
    .map(
      (constraint) =>
        `${constraint.ecosystem}:${constraint.name} within ${constraint.latest ? "the latest " : ""}${constraint.range} (from ${JSON.stringify(constraint.wording)})`,
    )
    .join("; ");
}

const label = (text: string) => text.padEnd(12);
const sub = (text: string) => `${"".padEnd(12)} ${text.padEnd(8)}`;

/** The summary's lines for one requirement: asked, read as, held to where any, then status. */
export function summaryRequirementLines(one: RequirementOutcome): string[] {
  const held = heldTo(one);
  return [
    `${label(one.id)} ${"asked".padEnd(8)} ${one.text}`,
    `${sub("read as")} ${readingOf(one)}`,
    ...(held === null ? [] : [`${sub("held to")} ${held}`]),
    `${sub("status")} ${one.status}, witness ${one.witness}${one.limitation === null ? "" : `: ${one.limitation}`}`,
  ];
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export const requirementTableHeader = [
  "| Requirement | Source | Read as | Held to | Status | Witness | Evidence | Limitation |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
];

export function requirementRow(one: RequirementOutcome): string {
  const evidence = one.evidence.map((ref) => `${ref.ref} (${ref.outcome}, ${ref.authority})`);
  return `| ${one.id}: ${cell(one.text)} | ${one.source} | ${cell(readingOf(one))} | ${cell(heldTo(one) ?? "")} | ${one.status} | ${one.witness} | ${cell(evidence.join("; ") || "none")} | ${cell(one.limitation ?? "")} |`;
}

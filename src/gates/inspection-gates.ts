import { findBlockingSecrets } from "../evidence/scrub.ts";
import { checkFileSet } from "./file-set.ts";
import {
  type GateContext,
  type GateDefinition,
  type GateObservation,
  observationFromJson,
} from "./gate-definition.ts";
import { inspectionParser } from "./parsers.ts";
import { countAddedLines } from "./workspace-changes.ts";

/**
 * Gates that read the working tree instead of shelling out. They print their findings as
 * JSON and are judged by the same parser contract as a command, so the engine has one
 * execution path and a reviewer has one thing to re-read.
 */

/**
 * No exemption for scaffold markers exists on purpose. A placeholder the harness is willing
 * to overlook is a placeholder that ships.
 *
 * The two kinds are separated because they live in different places. An annotation counts
 * only in comment position: a line carrying one of these words inside a regex, a table, or
 * a sentence about annotations is prose, and flagging it teaches people to route around the
 * gate. A stub marker counts wherever it appears, because it is executable.
 */
const annotationMarkers: readonly RegExp[] = [/TODO/, /FIXME/, /XXX/, /HACK/, /TBD/];

const stubMarkers: readonly RegExp[] = [
  /\braise\s+NotImplementedError\b/,
  /\btodo!\s*\(/,
  /\bunimplemented!\s*\(/,
  /\b(panic|unimplemented)!\s*\(\s*["'`]\s*(not implemented|unimplemented|todo)/i,
  /\bthrow new Error\(\s*["'`]\s*(not implemented|unimplemented|todo|placeholder)/i,
  /\bNotImplemented(Error)?\s*\(\s*\)/,
];

/** Where a line's comment begins, or -1. Blunt on purpose: this is a cheap check. */
function commentStart(line: string): number {
  return /\/\/|\/\*|<!--|#(?![[!])|^\s*\*(?!\/)/.exec(line)?.index ?? -1;
}

function markerIn(line: string): string | null {
  for (const marker of stubMarkers) {
    if (marker.test(line)) {
      return marker.source;
    }
  }

  const comment = commentStart(line);
  if (comment === -1) {
    return null;
  }
  for (const marker of annotationMarkers) {
    const found = marker.exec(line);
    if (found !== null && found.index > comment) {
      return marker.source;
    }
  }
  return null;
}

interface PlaceholderFinding {
  readonly path: string;
  readonly line: number;
  readonly marker: string;
  readonly text: string;
}

function findPlaceholders(context: GateContext): readonly PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  for (const file of context.changes.files) {
    for (const added of file.addedLines) {
      const marker = markerIn(added.text);
      if (marker === null) {
        continue;
      }
      findings.push({
        path: file.path,
        line: added.line,
        marker,
        text: added.text.trim().slice(0, 200),
      });
    }
  }
  return findings;
}

/** Only lines this change introduced. A marker that was already there is not this run's doing. */
export const placeholderGate: GateDefinition = {
  id: "placeholder",
  title: "no placeholder markers introduced",
  severity: "blocking",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      const findings = findPlaceholders(context);
      return observationFromJson(
        {
          detail:
            findings.length === 0
              ? "no placeholder marker was introduced by this change"
              : `${findings.length} placeholder marker(s) introduced: ` +
                findings
                  .slice(0, 10)
                  .map((finding) => `${finding.path}:${finding.line} ${finding.text}`)
                  .join("; "),
          findings,
          measures: { placeholdersIntroduced: findings.length },
        },
        findings.length === 0 ? 0 : 1,
      );
    },
  },
  parse: inspectionParser,
};

export const fileSetGate: GateDefinition = {
  id: "file-set",
  title: "changes stay inside the declared file set",
  severity: "blocking",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      const changed = context.changes.files.map((file) => file.path);
      const verdict = checkFileSet(context.fileSet, changed);

      if (!verdict.wasDeclared) {
        const idle = changed.length === 0;
        return observationFromJson(
          {
            detail: idle
              ? "nothing changed and no file set was declared, so there is nothing to check"
              : `${changed.length} file(s) changed but no file set was declared before editing. ` +
                "Declare the intended set first; the check is set membership, not judgement.",
            outside: changed,
            measures: { filesOutsideDeclaredSet: changed.length, filesDeclared: 0 },
          },
          idle ? 0 : 1,
        );
      }

      return observationFromJson(
        {
          detail:
            verdict.outside.length === 0
              ? `all ${verdict.changedCount} changed file(s) are inside the declared set of ${verdict.declaredCount}`
              : `${verdict.outside.length} file(s) outside the declared set: ${verdict.outside.join(", ")}. ` +
                "Record an amendment to widen the set, which puts the widening in front of a reviewer.",
          outside: verdict.outside,
          declared: [...context.fileSet.allowed].sort(),
          amendments: context.fileSet.amendments.length,
          measures: {
            filesOutsideDeclaredSet: verdict.outside.length,
            filesDeclared: verdict.declaredCount,
            fileSetAmendments: context.fileSet.amendments.length,
          },
        },
        verdict.outside.length === 0 ? 0 : 1,
      );
    },
  },
  parse: inspectionParser,
};

/**
 * The same detector as the write-time scrub and the export scan, asked its blocking question
 * instead of its redaction one. Scrubbing is fail-safe, so it over-matches on purpose and
 * `key: gate.gateId` is redacted on its way to the ledger and nobody minds. Blocking is not
 * fail-safe, so this gate only sees matches whose value is shaped like credential material.
 * The asymmetry is safe in the direction that matters: a credential this gate lets through is
 * still scrubbed out of every record (invariant 9). What is lost is a warning, never the
 * redaction.
 */
export const secretScanGate: GateDefinition = {
  id: "secret-scan",
  title: "no credential material in the change",
  severity: "blocking",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      const hits: { path: string; line: number; labels: readonly string[] }[] = [];
      for (const file of context.changes.files) {
        for (const added of file.addedLines) {
          const labels = findBlockingSecrets(added.text);
          if (labels.length > 0) {
            hits.push({ path: file.path, line: added.line, labels });
          }
        }
      }
      return observationFromJson(
        {
          // Labels only. Naming the matched text here would put the secret in the ledger,
          // which is the thing invariant 9 exists to prevent.
          detail:
            hits.length === 0
              ? "no known credential pattern appears in the added lines"
              : `${hits.length} added line(s) match a known credential pattern: ` +
                hits.map((hit) => `${hit.path}:${hit.line} (${hit.labels.join(", ")})`).join("; "),
          hits,
          measures: { secretMatches: hits.length },
        },
        hits.length === 0 ? 0 : 1,
      );
    },
  },
  parse: inspectionParser,
};

/**
 * Advisory by design (section 3.7). Exceeding the budget does not block; it demands a
 * justification claim that lands in the bundle for a reviewer to weigh.
 */
export const diffBudgetGate: GateDefinition = {
  id: "diff-budget",
  title: "change stays inside its size budget",
  severity: "advisory",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      const files = context.changes.files.length;
      const addedLines = countAddedLines(context.changes);
      const overFiles = files > context.budgets.maxChangedFiles;
      const overLines = addedLines > context.budgets.maxAddedLines;
      const over = overFiles || overLines;

      return observationFromJson(
        {
          detail: over
            ? `over budget: ${files} file(s) against ${context.budgets.maxChangedFiles} and ` +
              `${addedLines} added line(s) against ${context.budgets.maxAddedLines}. ` +
              "This does not block. It requires a justification claim citing this record."
            : `within budget: ${files} file(s) and ${addedLines} added line(s)`,
          overBudget: over,
          justificationRequired: over,
          measures: {
            changedFiles: files,
            addedLines,
            maxChangedFiles: context.budgets.maxChangedFiles,
            maxAddedLines: context.budgets.maxAddedLines,
          },
        },
        over ? 1 : 0,
      );
    },
  },
  parse: inspectionParser,
};

export const inspectionGates: readonly GateDefinition[] = [
  fileSetGate,
  placeholderGate,
  secretScanGate,
  diffBudgetGate,
];

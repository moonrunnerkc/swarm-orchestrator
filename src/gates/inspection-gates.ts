import { join } from "node:path";
import { asLatinLetters } from "../evidence/latin-lookalikes.ts";
import { findBlockingSecrets } from "../evidence/scrub.ts";
import { probeChangedBehaviour } from "./behaviour-probe.ts";
import { commentColumns, commentTextAt } from "./comment-spans.ts";
import { checkFileSet } from "./file-set.ts";
import {
  type GateContext,
  type GateDefinition,
  type GateObservation,
  observationFromJson,
} from "./gate-definition.ts";
import { inspectionParser } from "./parsers.ts";
import { assignmentsIn, bindingsIn, concatenatedLiteral } from "./value-flow.ts";
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
const annotationMarkers: readonly RegExp[] = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bHACK\b/i,
  /\bTBD\b/i,
];

const stubMarkers: readonly RegExp[] = [
  /\braise\s+NotImplementedError\b/i,
  /\btodo!\s*\(/i,
  /\bunimplemented!\s*\(/i,
  /\b(panic|unimplemented)!\s*\(\s*["'`]\s*(not implemented|unimplemented|todo)/i,
  /\bthrow new Error\(\s*["'`]\s*(not implemented|unimplemented|todo|placeholder)/i,
  /\bNotImplemented(Error)?\s*\(\s*\)/i,
];

/**
 * The marker a line introduces, or null. A stub marker counts wherever it appears, because it
 * is executable. An annotation counts only in comment position: a line carrying one of these
 * words inside a regex, a table, or a sentence about annotations is prose, and flagging it
 * teaches people to route around the gate.
 *
 * Comment position comes from the file rather than from the line, so a marker on its own line
 * inside a block comment is seen for what a reader sees it as.
 */
function markerIn(rawLine: string, commentText: string | null): string | null {
  const line = asLatinLetters(rawLine);

  for (const marker of stubMarkers) {
    if (marker.test(line)) {
      return marker.source;
    }
  }

  if (commentText === null) {
    return null;
  }
  const comment = asLatinLetters(commentText);
  for (const marker of annotationMarkers) {
    if (marker.test(comment)) {
      return marker.source;
    }
  }
  return null;
}

/** The fallback when the file itself is not readable: one line, with no block-comment state. */
function lineLocalComment(line: string): string | null {
  const at = /\/\/|\/\*|<!--|#(?![[!])|^\s*\*(?!\/)/.exec(line)?.index;
  return at === undefined ? null : line.slice(at);
}

interface PlaceholderFinding {
  readonly path: string;
  readonly line: number;
  readonly marker: string;
  readonly text: string;
}

async function findPlaceholders(context: GateContext): Promise<readonly PlaceholderFinding[]> {
  const findings: PlaceholderFinding[] = [];
  for (const file of context.changes.files) {
    // The whole file, because a comment is a property of the file and not of a line. A file
    // that cannot be read falls back to reading each added line on its own, which sees a
    // marker beside code but not one alone inside a block comment.
    const text = await context.probe.readCurrent(file.path);
    const lines = text === null ? [] : text.split("\n");
    const columns = text === null ? [] : commentColumns(text);

    for (const added of file.addedLines) {
      const comment =
        text === null ? lineLocalComment(added.text) : commentTextAt(columns, lines, added.line);
      const marker = markerIn(added.text, comment);
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
      const findings = await findPlaceholders(context);
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
  parserName: "inspection",
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

      const late = verdict.editedBeforeAuthorized;
      const failed = verdict.outside.length > 0 || late.length > 0;

      return observationFromJson(
        {
          detail: !failed
            ? `all ${verdict.changedCount} changed file(s) are inside the declared set of ${verdict.declaredCount}, ` +
              "and every one of them was declared before it was edited"
            : [
                verdict.outside.length === 0
                  ? ""
                  : `${verdict.outside.length} file(s) outside the declared set: ${verdict.outside.join(", ")}.`,
                late.length === 0
                  ? ""
                  : `${late.length} file(s) were edited before anything declared them: ${late.join(", ")}. ` +
                    "A declaration written after the edit describes what was done, not what was intended.",
                "Record an amendment to widen the set, which puts the widening in front of a reviewer.",
              ]
                .filter((part) => part.length > 0)
                .join(" "),
          outside: verdict.outside,
          editedBeforeAuthorized: late,
          declared: [...context.fileSet.allowed].sort(),
          amendments: context.fileSet.amendments.length,
          measures: {
            filesOutsideDeclaredSet: verdict.outside.length,
            filesEditedBeforeDeclared: late.length,
            filesDeclared: verdict.declaredCount,
            fileSetAmendments: context.fileSet.amendments.length,
          },
        },
        failed ? 1 : 0,
      );
    },
  },
  parse: inspectionParser,
  parserName: "inspection",
};

/**
 * The same detector as the write-time scrub and the export scan, asked its blocking question
 * instead of its redaction one. Scrubbing is fail-safe, so it over-matches on purpose and
 * `key: gate.gateId` is redacted on its way to the ledger and nobody minds. Blocking is not
 * fail-safe, so this gate only sees matches whose value is shaped like credential material.
 * The asymmetry is safe in the direction that matters: a credential this gate lets through is
 * still scrubbed out of every record (invariant 9). What is lost is a warning, never the
 * redaction.
 *
 * Read twice, per line and then over the added block as one text. The line reading is what
 * puts a finding on a line number, and the block reading is what sees a value written across
 * several of them: a credential in pretty-printed JSON has its name on one line and its value
 * on the next, so a line at a time is the one shape that hides it from a detector keyed on the
 * name. Where the block parses as JSON the detector walks it structurally, which is the same
 * traversal the write-time scrub runs.
 */
/**
 * The added lines as the values they build, for the case where a credential is written in
 * pieces. A detector reading text sees two short strings and a plus sign; substituting the
 * pieces back in produces the value the change actually creates, and that value is handed to
 * the same detector, under the name the change gave it.
 *
 * No second detector and no new threshold: what decides is the one that already decides, asked
 * about a value it would have seen had the credential been written whole. So the names it
 * knows, the value shapes it knows, and the metric exemptions it honours all carry over
 * unchanged, and a rejoin of two ordinary numbers under an ordinary name stays as quiet here
 * as it does anywhere else (invariant 9).
 *
 * What this does not reach is a secret split and never rejoined. There is no concatenation to
 * read there, and guessing that two adjacent short values are one value is the false positive
 * build-guide section 7.1 declines. That half stays a residual and stays named.
 */
function rejoinedValues(block: string): readonly string[] {
  const bindings = bindingsIn(block);
  const rebuilt: string[] = [];
  for (const assignment of assignmentsIn(block)) {
    const joined = concatenatedLiteral(assignment.expression, bindings);
    if (joined !== null) {
      rebuilt.push(`${assignment.name} = ${JSON.stringify(joined)}`);
    }
  }
  return rebuilt;
}

/**
 * A function that answered several ways at the base commit and answers one way now.
 *
 * The residual build-guide section 7.1 named is that `return 0` is a stub in one function and
 * the right answer three functions away, and that only knowing what the function is for tells
 * them apart. That is true of the text and false of the behaviour, so this measures the
 * behaviour: both versions over the same fixed inputs, counting distinct answers.
 *
 * Blocking, because what it reports is a measured number that moved the wrong way, which is the
 * same shape as every other blocking arm here and not a judgement about meaning. It stays quiet
 * on a function that was always constant, on one that takes no arguments and so has nothing to
 * vary, and on one that now refuses every input, which is a signature getting tighter rather
 * than an implementation going away.
 *
 * Not-applicable where the harness cannot run a probe of its own, and where it can, the files
 * it could not load are named in the detail. Not measured is a verdict; silence would be a
 * claim.
 */
export const behaviourProbeGate: GateDefinition = {
  id: "behaviour-probe",
  title: "a changed function still answers to its inputs",
  severity: "blocking",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      if (context.harnessRun === undefined) {
        return observationFromJson(
          {
            detail:
              "the harness has no way to spawn a probe here, so nothing about behaviour was measured",
            unavailable: true,
            measures: { functionsFlattened: 0, functionsProbed: 0 },
          },
          0,
        );
      }

      const result = await probeChangedBehaviour({
        changes: context.changes,
        probe: context.probe,
        commands: context.harnessRun.commands,
        scratchDirectory: join(context.harnessRun.scratchDirectory, "behaviour-probe"),
      });

      const unprobed =
        result.unprobed.length === 0
          ? ""
          : ` Not measured: ${result.unprobed.map((one) => `${one.file} (${one.reason})`).join("; ")}.`;

      return observationFromJson(
        {
          detail:
            result.flattened.length === 0
              ? `${result.probed.length} changed function(s) still answer to their inputs.${unprobed}`
              : `${result.flattened.length} changed function(s) answered several ways at the base ` +
                `and answer one way now: ${result.flattened
                  .map((one) => `${one.file}:${one.name} (${one.baseOutcomes} to 1)`)
                  .join("; ")}.${unprobed}`,
          flattened: result.flattened.map((one) => ({ ...one })),
          unprobed: result.unprobed.map((one) => ({ ...one })),
          measures: {
            functionsFlattened: result.flattened.length,
            functionsProbed: result.probed.length,
            functionsUnprobed: result.unprobed.length,
          },
        },
        result.flattened.length === 0 ? 0 : 1,
      );
    },
  },
  parse: inspectionParser,
  parserName: "inspection",
};

export const secretScanGate: GateDefinition = {
  id: "secret-scan",
  title: "no credential material in the change",
  severity: "blocking",
  source: {
    kind: "inspection",
    inspect: async (context: GateContext): Promise<GateObservation> => {
      const hits: { path: string; line: number; labels: readonly string[] }[] = [];
      for (const file of context.changes.files) {
        const attributed = new Set<string>();
        for (const added of file.addedLines) {
          const labels = findBlockingSecrets(added.text);
          if (labels.length > 0) {
            hits.push({ path: file.path, line: added.line, labels });
            for (const label of labels) {
              attributed.add(label);
            }
          }
        }
        const block = file.addedLines.map((added) => added.text).join("\n");
        const acrossLines = findBlockingSecrets(block).filter((label) => !attributed.has(label));
        if (acrossLines.length > 0) {
          hits.push({
            path: file.path,
            line: file.addedLines[0]?.line ?? 0,
            labels: acrossLines,
          });
        }
        for (const rejoined of rejoinedValues(block)) {
          const labels = findBlockingSecrets(rejoined).filter((label) => !attributed.has(label));
          if (labels.length > 0) {
            hits.push({ path: file.path, line: file.addedLines[0]?.line ?? 0, labels });
            for (const label of labels) {
              attributed.add(label);
            }
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
  parserName: "inspection",
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
  parserName: "inspection",
};

export const inspectionGates: readonly GateDefinition[] = [
  fileSetGate,
  placeholderGate,
  secretScanGate,
  behaviourProbeGate,
  diffBudgetGate,
];

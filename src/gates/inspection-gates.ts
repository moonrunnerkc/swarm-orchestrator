import { findBlockingSecrets } from "../evidence/scrub.ts";
import { commentColumns, commentTextAt } from "./comment-spans.ts";
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
 * Format characters (zero-width spaces and joiners, bidi controls, the soft hyphen) render as
 * nothing, so a marker split by one reads to a human exactly like the marker. They appear in
 * source for no other reason, and stripping them before matching is what makes the check about
 * the text rather than about its code points. Case is folded by the patterns for the same
 * reason: `// todo` is a TODO.
 */
const formatCharacters = /\p{Cf}/gu;

/**
 * Letters from other scripts that render as the Latin ones these markers are spelled with, so
 * a marker built out of them reads to a human exactly like the marker. A named list of the
 * Cyrillic, Greek, and fullwidth capitals that are indistinguishable in ordinary type, rather
 * than a general confusables engine: every entry here is one code point mapping to one, so
 * folding cannot change what any other check sees. A marker spelled in a script nobody listed
 * still reads as a marker to a person and is not caught, which build-guide section 7.1 says
 * rather than implying otherwise.
 */
const latinLookalikes: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "\u0410": "A",
    "\u0412": "B",
    "\u0415": "E",
    "\u041A": "K",
    "\u041C": "M",
    "\u041D": "H",
    "\u041E": "O",
    "\u0420": "P",
    "\u0421": "C",
    "\u0422": "T",
    "\u0425": "X",
    "\u0430": "a",
    "\u0435": "e",
    "\u043E": "o",
    "\u0440": "p",
    "\u0441": "c",
    "\u0445": "x",
    "\u0443": "y",
    "\u0391": "A",
    "\u0392": "B",
    "\u0395": "E",
    "\u0396": "Z",
    "\u0397": "H",
    "\u0399": "I",
    "\u039A": "K",
    "\u039C": "M",
    "\u039D": "N",
    "\u039F": "O",
    "\u03A1": "P",
    "\u03A4": "T",
    "\u03A5": "Y",
    "\u03A7": "X",
    "\u03BF": "o",
    "\u03B9": "i",
    "\u03BA": "k",
    "\u03BD": "v",
    "\u03C1": "p",
    "\u03C4": "t",
    "\u03C7": "x",
  }),
);

const fullwidthUpper = /[\uFF21-\uFF3A]/g;
const fullwidthLower = /[\uFF41-\uFF5A]/g;

/** The text as a reader sees it: no invisibles, and every lookalike letter as its Latin twin. */
function asRead(text: string): string {
  return (
    text
      .replace(formatCharacters, "")
      .replace(fullwidthUpper, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xff21 + 0x41),
      )
      .replace(fullwidthLower, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xff41 + 0x61),
      )
      // Greek and Cyrillic, which is where every entry in the table lives.
      .replaceAll(/[\u0370-\u04FF]/gu, (character) => latinLookalikes.get(character) ?? character)
  );
}

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
  const line = asRead(rawLine);

  for (const marker of stubMarkers) {
    if (marker.test(line)) {
      return marker.source;
    }
  }

  if (commentText === null) {
    return null;
  }
  const comment = asRead(commentText);
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
        const acrossLines = findBlockingSecrets(
          file.addedLines.map((added) => added.text).join("\n"),
        ).filter((label) => !attributed.has(label));
        if (acrossLines.length > 0) {
          hits.push({
            path: file.path,
            line: file.addedLines[0]?.line ?? 0,
            labels: acrossLines,
          });
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

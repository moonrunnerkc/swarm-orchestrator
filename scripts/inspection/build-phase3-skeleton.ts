/* eslint-disable no-console */
/**
 * Build the Phase 3 inspection.md skeleton at
 * `evidence/phase3/run/config-b-prime/inspection.md`, pre-populated
 * with heuristic classifications for all 60 candidates produced by the
 * Phase 3 ship-B' run.
 *
 * Audit-and-corrections (DECISIONS.md 2026-05-09): Phase 3's "60
 * catches, 0 false positives" headline was unaudited. This skeleton
 * walks the existing run artefacts at
 * `evidence/phase3/run/config-bp/<id>/result.json`, pulls each
 * candidate file, runs the AST-based heuristic classifier, and
 * generates a per-candidate section the operator fills in.
 *
 * The classifier output is heuristic, not authoritative — operator
 * verdict has the final word. The aggregate section reports
 * heuristic counts and an explicit `TODO: operator inspection
 * pending` for confirmed counts; those land when the operator commits
 * the inspection.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  classifyCandidate,
  type CandidateFile,
  type HeuristicLabel,
} from '../../src/falsification/inspection/heuristic-classifier';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../src/contract/types';

interface Phase3Obligation {
  readonly id: string;
  readonly stratum: 'I' | 'F';
  readonly type: 'import-graph-must-satisfy' | 'function-must-have-signature';
  readonly constraint?: 'no-cycles' | 'no-upward-imports';
  readonly scope?: string;
  readonly file?: string;
  readonly name?: string;
  readonly signature?: string;
}

interface Phase3SampleFile {
  readonly obligationCount: number;
  readonly obligations: readonly Phase3Obligation[];
  readonly fixturePath: string;
}

interface ResultJson {
  readonly result: {
    readonly kind: string;
    readonly inputs?: ReadonlyArray<{
      readonly files: ReadonlyArray<{ readonly relPath: string; readonly bytes: string }>;
      readonly reproducer: string;
      readonly reproducerOutput: string;
      readonly reproducerExitCode: number;
    }>;
  };
  readonly cost: {
    readonly counterExamplesFound: number;
    readonly falsePositives: number;
    readonly dollarsBilled: number;
    readonly dollarsTokenEstimate: number;
    readonly dollarsApiEquivalent?: number;
  };
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function toObligation(
  sample: Phase3Obligation,
): ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation {
  if (sample.type === 'import-graph-must-satisfy') {
    return {
      type: 'import-graph-must-satisfy',
      constraint: sample.constraint!,
      scope: sample.scope!,
    };
  }
  return {
    type: 'function-must-have-signature',
    file: sample.file!,
    name: sample.name!,
    signature: sample.signature!,
  };
}

function fenceContent(content: string, lang: string): string {
  // Pick a fence length longer than any consecutive run of backticks
  // in the content so embedded fences cannot break the wrapper.
  let maxRun = 0;
  let cur = 0;
  for (const ch of content) {
    if (ch === '`') {
      cur += 1;
      if (cur > maxRun) maxRun = cur;
    } else {
      cur = 0;
    }
  }
  const fence = '`'.repeat(Math.max(3, maxRun + 1));
  return `${fence}${lang}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`;
}

function renderObligationHeader(o: Phase3Obligation): string {
  if (o.type === 'import-graph-must-satisfy') {
    return `${o.id} — ${o.constraint} in \`${o.scope}\` (stratum ${o.stratum}, import-graph-must-satisfy)`;
  }
  return `${o.id} — \`${o.name}${o.signature}\` in \`${o.file}\` (stratum ${o.stratum}, function-must-have-signature)`;
}

function renderCandidate(
  obligationHeader: string,
  candidateIdx: number,
  candidate: { files: ReadonlyArray<CandidateFile>; reproducer: string; reproducerOutput: string; reproducerExitCode: number },
  classification: { label: HeuristicLabel; reason: string },
): string {
  const out: string[] = [];
  out.push(`### ${obligationHeader} — candidate ${candidateIdx + 1}`);
  out.push('');
  out.push(`**Heuristic label:** \`${classification.label}\``);
  out.push('');
  out.push(`**Heuristic reason:** ${classification.reason}`);
  out.push('');
  out.push(`**Files written by the candidate:**`);
  out.push('');
  for (const file of candidate.files) {
    out.push(`- \`${file.relPath}\``);
    out.push('');
    out.push(fenceContent(file.bytes, ''));
    out.push('');
  }
  out.push(`**Reproducer:** \`${candidate.reproducer.replace(/\n/g, ' ')}\``);
  out.push('');
  out.push(`**Reproducer exit:** ${candidate.reproducerExitCode}`);
  out.push('');
  out.push('<details><summary>Reproducer output</summary>');
  out.push('');
  out.push(fenceContent(candidate.reproducerOutput, ''));
  out.push('');
  out.push('</details>');
  out.push('');
  out.push(
    '**Operator verdict:** [ ] Confirmed real failure  [ ] Predicate-gaming  [ ] Mechanical false positive',
  );
  out.push('');
  out.push('**Operator notes:**');
  out.push('');
  out.push('---');
  out.push('');
  return out.join('\n');
}

function main(): void {
  const obligationsPath = path.join(REPO_ROOT, 'evidence', 'phase3', 'obligations.json');
  const runDir = path.join(REPO_ROOT, 'evidence', 'phase3', 'run', 'config-bp');
  const outDir = path.join(REPO_ROOT, 'evidence', 'phase3', 'run', 'config-b-prime');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'inspection.md');

  const sample = JSON.parse(fs.readFileSync(obligationsPath, 'utf8')) as Phase3SampleFile;

  let totalCandidates = 0;
  const counts: Record<HeuristicLabel, number> = {
    'likely-real': 0,
    'likely-gaming': 0,
    ambiguous: 0,
  };

  const out: string[] = [];
  out.push('# Phase 3 inspection — config B\' (audit-and-corrections, 2026-05-09)');
  out.push('');
  out.push(
    'Operator inspection of every machine-claimed Copilot catch from the ' +
      'Phase 3 ship-B\' run. Pre-populated with heuristic AST-based ' +
      'classifications by `scripts/inspection/build-phase3-skeleton.ts`. ' +
      '**Heuristic labels are not authoritative; operator verdict is.**',
  );
  out.push('');
  out.push(
    'For each candidate the inspection records: file path + content, ' +
      'reproducer command, reproducer exit code and output, the heuristic ' +
      'label/reason, and the operator verdict (confirmed real failure / ' +
      'predicate-gaming / mechanical false positive). The aggregate ' +
      'section at the bottom rolls the verdicts into confirmed counts the ' +
      'corrected Phase 3 close-out (Part F of the audit) consumes.',
  );
  out.push('');
  out.push(
    'Sources: per-obligation `result.json` files at ' +
      '`evidence/phase3/run/config-bp/<id>/result.json` ' +
      '(the ship-B\' run); machine-claimed yield = 60 ' +
      '(20 obligations × 3 candidates each).',
  );
  out.push('');

  for (const o of sample.obligations) {
    const resultPath = path.join(runDir, o.id, 'result.json');
    if (!fs.existsSync(resultPath)) {
      throw new Error(`missing result.json for obligation ${o.id} at ${resultPath}`);
    }
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ResultJson;
    if (result.result.kind !== 'counter-example-input') {
      throw new Error(
        `obligation ${o.id} has result.kind=${result.result.kind}; expected counter-example-input`,
      );
    }
    const inputs = result.result.inputs ?? [];
    const obligation = toObligation(o);
    const obligationHeader = renderObligationHeader(o);
    out.push(`## ${obligationHeader}`);
    out.push('');
    out.push(
      `Machine-claimed yield: ${inputs.length} (cost record reports counterExamplesFound=${result.cost.counterExamplesFound}, falsePositives=${result.cost.falsePositives}).`,
    );
    out.push('');
    for (let i = 0; i < inputs.length; i++) {
      const candidate = inputs[i]!;
      // The classifier targets a single file; pick the first written
      // file (Phase 3 candidates each write exactly one file).
      const firstFile = candidate.files[0];
      if (firstFile === undefined) {
        out.push(`### ${obligationHeader} — candidate ${i + 1}`);
        out.push('');
        out.push('**Heuristic label:** `ambiguous` (candidate wrote zero files; operator decides)');
        out.push('');
        continue;
      }
      const classification = classifyCandidate(firstFile, obligation);
      counts[classification.label] += 1;
      totalCandidates += 1;
      out.push(renderCandidate(obligationHeader, i, candidate, classification));
    }
  }

  out.push('## Aggregate');
  out.push('');
  out.push(`- Machine-claimed catches: ${totalCandidates}`);
  out.push(`- Heuristic likely-real: ${counts['likely-real']}`);
  out.push(`- Heuristic likely-gaming: ${counts['likely-gaming']}`);
  out.push(`- Heuristic ambiguous: ${counts.ambiguous}`);
  out.push(`- Operator-confirmed real failures: TODO until inspection completes`);
  out.push(`- Operator-confirmed predicate-gaming: TODO until inspection completes`);
  out.push(`- Operator-confirmed mechanical false positives: TODO until inspection completes`);
  out.push('');
  out.push('**Conservation check (operator fills in):**');
  out.push('');
  out.push(
    'machine-claimed === sum(operator categories) must hold; any ' +
      'discrepancy means a candidate was double-counted or missed.',
  );
  out.push('');
  out.push('## Provenance');
  out.push('');
  out.push(
    `- Heuristic classifier: ` +
      `\`src/falsification/inspection/heuristic-classifier.ts\` ` +
      `(real tests at ` +
      `\`test/falsification/inspection/heuristic-classifier.test.ts\`).`,
  );
  out.push(
    `- Skeleton generator: ` +
      `\`scripts/inspection/build-phase3-skeleton.ts\`.`,
  );
  out.push(
    `- Source artefacts: ` +
      `\`evidence/phase3/run/config-bp/<id>/result.json\` ` +
      `(20 obligations × 3 candidates = 60).`,
  );
  out.push('');

  fs.writeFileSync(outPath, out.join('\n'));
  console.log(
    `wrote ${path.relative(REPO_ROOT, outPath)} ` +
      `(N=${totalCandidates}; likely-real=${counts['likely-real']}, ` +
      `likely-gaming=${counts['likely-gaming']}, ambiguous=${counts.ambiguous})`,
  );
}

main();

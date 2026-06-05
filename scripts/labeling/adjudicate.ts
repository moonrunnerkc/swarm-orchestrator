// Human-label adjudication CLI. Surfaces the arbiter-split findings (the
// two arbiter model families disagreed) for a human to mark, writes the
// human verdicts into labels-v2, and (in the kappa/promote verbs) gates
// promotion of those labels to the baseline the scorer reads.
//
// Verbs:
//
//   queue   Build the adjudication queue + a fill-in worksheet from the
//           dual-arbiter output, highest-information PR first.
//   apply   Validate a decisions file and append the verdicts into
//           labels-v2/<rater>/labels.jsonl (non-destructive by default).
//
// Usage:
//   node dist/scripts/labeling/adjudicate.js queue \
//     [--dual benchmarks/real-prs/arbiter-labels-dual.json] \
//     [--raw-dir benchmarks/real-corpus/raw] \
//     [--out benchmarks/real-corpus/labels-v2/adjudication-queue.json] \
//     [--worksheet benchmarks/real-corpus/labels-v2/adjudication-worksheet.md]
//
//   node dist/scripts/labeling/adjudicate.js apply \
//     --decisions decisions.json \
//     [--labels-dir benchmarks/real-corpus/labels-v2] [--replace]

import * as fs from 'fs';
import * as path from 'path';
import { loadPrCorpus } from '../../benchmarks/real-corpus/loader';
import type { DualArbiterLabel } from '../real-prs/lib/types';
import {
  buildAdjudicationQueue,
  entryFromDecision,
  mergeRaterEntries,
  validateDecision,
  type AdjudicationDecision,
  type AdjudicationQueue,
  type HumanLabelEntry,
  type IdResolver,
} from './adjudicate-core';

const DEFAULT_DUAL = path.join('benchmarks', 'real-prs', 'arbiter-labels-dual.json');
const DEFAULT_RAW = path.join('benchmarks', 'real-corpus', 'raw');
const DEFAULT_LABELS = path.join('benchmarks', 'real-corpus', 'labels-v2');

function readArg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}

function loadDualLabels(file: string): DualArbiterLabel[] {
  if (!fs.existsSync(file)) {
    throw new Error(
      `adjudicate: dual-arbiter file not found at ${file}. Run ` +
        `'node dist/scripts/real-prs/run-arbiter-dual.js' first, or pass --dual <path>.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DualArbiterLabel[];
}

/** Build an id resolver from the raw corpus, or a null resolver when the
 * corpus is not on disk (the queue still builds, ids stay unresolved). */
async function buildIdResolver(rawDir: string): Promise<IdResolver> {
  const abs = path.resolve(rawDir);
  if (!fs.existsSync(abs)) return () => null;
  const entries = await loadPrCorpus(abs);
  const byRepoPr = new Map<string, string>();
  for (const e of entries) byRepoPr.set(`${e.pr.repository}#${e.pr.number}`, e.id);
  return (repo, prNumber) => byRepoPr.get(`${repo}#${prNumber}`) ?? null;
}

function renderWorksheet(queue: AdjudicationQueue): string {
  const lines: string[] = [];
  lines.push('# Adjudication worksheet (arbiter-split findings)');
  lines.push('');
  lines.push(
    `${queue.rows.length} PRs, ${queue.totalSplitFindings} split findings. ` +
      'Mark each PR clean / broken / ambiguous. Copy your verdicts into a ' +
      'decisions.json array and run `adjudicate apply`.',
  );
  if (queue.unresolvedPrKeys.length > 0) {
    lines.push('');
    lines.push(
      `> ${queue.unresolvedPrKeys.length} PR(s) had no corpus id (raw corpus absent); ` +
        'their `id` is blank below and must be filled before apply.',
    );
  }
  for (const row of queue.rows) {
    lines.push('');
    lines.push(`## ${row.prKey} (info ${row.infoScore}, sharp splits ${row.sharpSplitCount})`);
    lines.push(`- id: ${row.id ?? '(unresolved — fill in)'}`);
    for (const f of row.splitFindings) {
      lines.push(
        `- split [${f.category}/${f.judgePath}] primary=${f.primaryVerdict} ` +
          `secondary=${f.secondaryVerdict}`,
      );
    }
    lines.push('- verdict: ');
    lines.push('- confidence: ');
    lines.push('- brokenCategories: ');
    lines.push('- rationale: ');
  }
  return lines.join('\n') + '\n';
}

async function runQueue(argv: string[]): Promise<number> {
  const dualFile = readArg(argv, '--dual') ?? DEFAULT_DUAL;
  const rawDir = readArg(argv, '--raw-dir') ?? DEFAULT_RAW;
  const labelsDir = readArg(argv, '--labels-dir') ?? DEFAULT_LABELS;
  const outFile = readArg(argv, '--out') ?? path.join(labelsDir, 'adjudication-queue.json');
  const worksheetFile =
    readArg(argv, '--worksheet') ?? path.join(labelsDir, 'adjudication-worksheet.md');

  const dual = loadDualLabels(dualFile);
  const resolveId = await buildIdResolver(rawDir);
  const queue = buildAdjudicationQueue(dual, resolveId);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(queue, null, 2) + '\n');
  fs.writeFileSync(worksheetFile, renderWorksheet(queue));
  process.stdout.write(
    `adjudicate queue: ${queue.rows.length} PRs, ${queue.totalSplitFindings} split findings, ` +
      `${queue.unresolvedPrKeys.length} unresolved; wrote ${outFile} and ${worksheetFile}\n`,
  );
  return 0;
}

function raterLabelsFile(labelsDir: string, raterId: string): string {
  return path.join(labelsDir, raterId, 'labels.jsonl');
}

function readRaterEntries(file: string): HumanLabelEntry[] {
  if (!fs.existsSync(file)) return [];
  const out: HumanLabelEntry[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as HumanLabelEntry);
  }
  return out;
}

async function runApply(argv: string[]): Promise<number> {
  const decisionsFile = readArg(argv, '--decisions');
  const labelsDir = readArg(argv, '--labels-dir') ?? DEFAULT_LABELS;
  const replace = argv.includes('--replace');
  if (decisionsFile === undefined) {
    process.stderr.write('adjudicate apply: --decisions <file.json> is required\n');
    return 2;
  }
  const decisions = JSON.parse(fs.readFileSync(decisionsFile, 'utf8')) as AdjudicationDecision[];

  const invalid: { id: string; issues: string[] }[] = [];
  const byRater = new Map<string, HumanLabelEntry[]>();
  for (const decision of decisions) {
    const issues = validateDecision(decision);
    if (issues.length > 0) {
      invalid.push({ id: decision.id ?? '(no id)', issues });
      continue;
    }
    const bucket = byRater.get(decision.raterId) ?? [];
    bucket.push(entryFromDecision(decision));
    byRater.set(decision.raterId, bucket);
  }
  if (invalid.length > 0) {
    for (const row of invalid) {
      process.stderr.write(`adjudicate apply: rejected ${row.id}: ${row.issues.join('; ')}\n`);
    }
    process.stderr.write(`adjudicate apply: ${invalid.length} invalid decision(s); nothing written\n`);
    return 1;
  }

  let totalAdded = 0;
  let totalSkipped = 0;
  let totalReplaced = 0;
  for (const [raterId, incoming] of byRater) {
    const file = raterLabelsFile(labelsDir, raterId);
    const existing = readRaterEntries(file);
    const result = mergeRaterEntries(existing, incoming, replace);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, result.merged.map((e) => JSON.stringify(e)).join('\n') + '\n');
    totalAdded += result.added.length;
    totalSkipped += result.skipped.length;
    totalReplaced += result.replaced.length;
    process.stdout.write(
      `adjudicate apply: ${raterId} +${result.added.length} added, ` +
        `${result.replaced.length} replaced, ${result.skipped.length} skipped (${file})\n`,
    );
  }
  process.stdout.write(
    `adjudicate apply: total +${totalAdded} added, ${totalReplaced} replaced, ` +
      `${totalSkipped} skipped${replace ? '' : ' (re-run with --replace to overwrite)'}\n`,
  );
  return 0;
}

async function main(): Promise<void> {
  const [verb, ...rest] = process.argv.slice(2);
  let code: number;
  switch (verb) {
    case 'queue':
      code = await runQueue(rest);
      break;
    case 'apply':
      code = await runApply(rest);
      break;
    default:
      process.stderr.write(
        'adjudicate: unknown verb. Use one of: queue, apply.\n' +
          '  queue  build the arbiter-split adjudication queue + worksheet\n' +
          '  apply  write a decisions.json into labels-v2/<rater>/labels.jsonl\n',
      );
      code = 2;
  }
  process.exitCode = code;
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`adjudicate: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}

export { renderWorksheet };

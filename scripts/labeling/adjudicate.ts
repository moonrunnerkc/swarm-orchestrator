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
import { writeLabel } from '../../benchmarks/falsification-corpus/label-store';
import type { DualArbiterLabel } from '../real-prs/lib/types';
import {
  buildAdjudicationQueue,
  entryFromDecision,
  mergeRaterEntries,
  renderWorksheet,
  validateDecision,
  type AdjudicationDecision,
  type HumanLabelEntry,
  type IdResolver,
} from './adjudicate-core';
import { compute as computeKappa } from './compute-kappa';
import { buildPromotionPlan, humanVsAiKappa } from './promote-core';

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

function readAllRaterEntries(labelsDir: string): Map<string, HumanLabelEntry[]> {
  const out = new Map<string, HumanLabelEntry[]>();
  if (!fs.existsSync(labelsDir)) return out;
  for (const name of fs.readdirSync(labelsDir)) {
    if (!/^rater-\d+/.test(name)) continue;
    const entries = readRaterEntries(raterLabelsFile(labelsDir, name));
    if (entries.length > 0) out.set(name, entries);
  }
  return out;
}

async function buildIdByPrKey(rawDir: string): Promise<Map<string, string>> {
  const abs = path.resolve(rawDir);
  const out = new Map<string, string>();
  if (!fs.existsSync(abs)) return out;
  for (const e of await loadPrCorpus(abs)) out.set(`${e.pr.repository}#${e.pr.number}`, e.id);
  return out;
}

async function runKappa(argv: string[]): Promise<number> {
  const labelsDir = readArg(argv, '--labels-dir') ?? DEFAULT_LABELS;
  const dualFile = readArg(argv, '--dual') ?? DEFAULT_DUAL;
  const rawDir = readArg(argv, '--raw-dir') ?? DEFAULT_RAW;
  const threshold = Number(readArg(argv, '--threshold') ?? '0.6');

  const agreement = computeKappa({ labelsDir, threshold });
  process.stdout.write(
    `adjudicate kappa: raters=${agreement.ratersIncluded.length} pairs=${agreement.pairs.length} ` +
      `min-kappa=${agreement.minimumKappa ?? 'n/a'} passes-gate=${agreement.passesGate ?? 'n/a'} ` +
      `(threshold ${threshold})\n`,
  );

  if (fs.existsSync(dualFile)) {
    const dual = JSON.parse(fs.readFileSync(dualFile, 'utf8')) as DualArbiterLabel[];
    const idByPrKey = await buildIdByPrKey(rawDir);
    const flat = [...readAllRaterEntries(labelsDir).values()].flat();
    const ha = humanVsAiKappa(flat, dual, idByPrKey);
    process.stdout.write(
      `adjudicate kappa: human-vs-AI overlap=${ha.comparisons} kappa=${ha.kappa ?? 'n/a'} ` +
        `human-broken-share=${ha.humanBrokenShare.toFixed(2)} ai-broken-share=${ha.aiBrokenShare.toFixed(2)}\n`,
    );
  }
  return agreement.passesGate === false ? 1 : 0;
}

async function runPromote(argv: string[]): Promise<number> {
  const labelsDir = readArg(argv, '--labels-dir') ?? DEFAULT_LABELS;
  const finalDir = readArg(argv, '--final-dir') ?? path.join(labelsDir, 'final');
  const threshold = Number(readArg(argv, '--threshold') ?? '0.6');
  const minRaters = Number(readArg(argv, '--min-raters') ?? '3');
  const allowSingle = argv.includes('--allow-single-rater');
  const write = argv.includes('--write');
  const replace = argv.includes('--replace');

  const agreement = computeKappa({ labelsDir, threshold });
  if (agreement.passesGate === false) {
    process.stderr.write(
      `adjudicate promote: refused. Minimum pairwise kappa ${agreement.minimumKappa ?? 'n/a'} ` +
        `is below the ${threshold} gate. Resolve the disputed PRs before promoting.\n`,
    );
    return 1;
  }
  if (agreement.passesGate === null && !allowSingle) {
    process.stderr.write(
      'adjudicate promote: refused. Fewer than two raters with overlap, so the agreement ' +
        'gate cannot be cleared. Recruit raters, or pass --allow-single-rater to write a ' +
        'non-final bootstrap baseline (flagged as such in every rationale).\n',
    );
    return 1;
  }

  const labeledAt = new Date().toISOString();
  const plan = buildPromotionPlan(readAllRaterEntries(labelsDir), {
    minRaters,
    kappa: agreement.minimumKappa,
    labeledAt,
  });
  process.stdout.write(
    `adjudicate promote: ${plan.promote.length} promotable, ${plan.dropped.length} dropped, ` +
      `${plan.insufficient.length} insufficient (min-raters ${minRaters})\n`,
  );
  for (const d of plan.dropped) process.stdout.write(`  drop ${d.id}: ${d.reason}\n`);
  if (!write) {
    process.stdout.write('adjudicate promote: dry run; pass --write to publish final/ labels\n');
    return 0;
  }
  let written = 0;
  for (const { id, label } of plan.promote) {
    await writeLabel(finalDir, id, label, { replace });
    written += 1;
  }
  process.stdout.write(`adjudicate promote: wrote ${written} label(s) to ${finalDir}\n`);
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
    case 'kappa':
      code = await runKappa(rest);
      break;
    case 'promote':
      code = await runPromote(rest);
      break;
    default:
      process.stderr.write(
        'adjudicate: unknown verb. Use one of: queue, apply, kappa, promote.\n' +
          '  queue    build the arbiter-split adjudication queue + worksheet\n' +
          '  apply    write a decisions.json into labels-v2/<rater>/labels.jsonl\n' +
          '  kappa    report pairwise and human-vs-AI agreement\n' +
          '  promote  gate on kappa, then publish final/ labels for the scorer\n',
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

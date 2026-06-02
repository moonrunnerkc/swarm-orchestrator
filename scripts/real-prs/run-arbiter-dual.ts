// Classify every audit finding with two independent arbiters: the local
// model (free) and the Anthropic Opus model (paid). A finding is
// high-confidence labeled only when both arbiters return the same verdict;
// a disagreement is tagged arbiter-split and excluded from the headline
// false-positive / true-positive counts (reported separately as an
// uncertainty bucket). On the regression corpus the attached revert /
// fix-PR is the ground truth; the arbiters there only characterize the
// finding, they do not override the retrospective label. Resumable: a
// finding already dual-labeled is not re-paid.
//
// Usage:
//   node dist/scripts/real-prs/run-arbiter-dual.js \
//     [--corpus regression|clean|both] [--max-cost-usd 40] [--limit N]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { CostLedger } from './lib/cost';
import { createArbiter, type Arbiter } from './lib/arbiter';
import { sliceDiffForFinding } from './lib/slice';
import {
  auditResultsV2Dir,
  costLedgerFile,
  dualArbiterLabelsFile,
  realPrsDir,
  regressionAuditResultsDir,
  regressionDir,
  regressionSourcesFile,
  repoSlug,
  sourcesV2File,
} from './lib/paths';
import type {
  AuditResultRecord,
  DualArbiterLabel,
  HarnessFinding,
  RegressionSourcesFile,
  SourcesFile,
} from './lib/types';

const log = getLogger('real-prs:arbiter-dual');

type Corpus = 'regression' | 'clean';

interface Args {
  corpus: Corpus | 'both';
  maxCostUsd: number;
  limit: number | null;
  perCategory: number | null;
  primaryProvider: 'anthropic' | 'local' | 'ollama';
  secondaryProvider: 'anthropic' | 'local' | 'ollama';
  primaryPrompt: string;
  secondaryPrompt: string;
}

function parseArgs(argv: string[]): Args {
  let corpus: Args['corpus'] = 'both';
  let maxCostUsd = 40;
  let limit: number | null = null;
  let perCategory: number | null = null;
  let primaryProvider: 'anthropic' | 'local' | 'ollama' = 'local';
  let secondaryProvider: 'anthropic' | 'local' | 'ollama' = 'anthropic';
  let primaryPrompt = 'v2';
  let secondaryPrompt = 'v1';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--corpus' && (next === 'regression' || next === 'clean' || next === 'both')) (corpus = next), (i += 1);
    else if (a === '--max-cost-usd' && next !== undefined) (maxCostUsd = Number(next)), (i += 1);
    else if (a === '--limit' && next !== undefined) (limit = Number(next)), (i += 1);
    else if (a === '--per-category' && next !== undefined) (perCategory = Number(next)), (i += 1);
    else if (a === '--primary-provider' && (next === 'anthropic' || next === 'local' || next === 'ollama')) (primaryProvider = next), (i += 1);
    else if (a === '--secondary-provider' && (next === 'anthropic' || next === 'local' || next === 'ollama')) (secondaryProvider = next), (i += 1);
    else if (a === '--primary-prompt' && next !== undefined) (primaryPrompt = next), (i += 1);
    else if (a === '--secondary-prompt' && next !== undefined) (secondaryPrompt = next), (i += 1);
  }
  return { corpus, maxCostUsd, limit, perCategory, primaryProvider, secondaryProvider, primaryPrompt, secondaryPrompt };
}

interface PrMeta {
  title: string;
  bodyExcerpt: string;
  diffAbsPath: string;
}

function loadPrIndex(): Map<string, PrMeta> {
  const idx = new Map<string, PrMeta>();
  if (fs.existsSync(regressionSourcesFile())) {
    const s = JSON.parse(fs.readFileSync(regressionSourcesFile(), 'utf8')) as RegressionSourcesFile;
    for (const p of s.prs) {
      idx.set(`regression:${p.repo}#${p.prNumber}`, {
        title: p.title,
        bodyExcerpt: p.bodyExcerpt,
        diffAbsPath: path.join(regressionDir(), p.diffPath),
      });
    }
  }
  if (fs.existsSync(sourcesV2File())) {
    const s = JSON.parse(fs.readFileSync(sourcesV2File(), 'utf8')) as SourcesFile;
    for (const p of s.prs) {
      idx.set(`clean:${p.repo}#${p.prNumber}`, {
        title: p.title,
        bodyExcerpt: p.bodyExcerpt,
        diffAbsPath: path.join(realPrsDir(), p.diffPath),
      });
    }
  }
  return idx;
}

function auditDir(corpus: Corpus): string {
  return corpus === 'regression' ? regressionAuditResultsDir() : auditResultsV2Dir();
}

function loadRecords(corpus: Corpus): AuditResultRecord[] {
  const dir = auditDir(corpus);
  if (!fs.existsSync(dir)) return [];
  const out: AuditResultRecord[] = [];
  for (const repoDir of fs.readdirSync(dir)) {
    const full = path.join(dir, repoDir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (file.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as AuditResultRecord);
    }
  }
  return out;
}

function dedupeFindings(record: AuditResultRecord): HarnessFinding[] {
  const seen = new Map<string, HarnessFinding>();
  for (const f of [...(record.pre ?? []), ...record.post]) if (!seen.has(f.key)) seen.set(f.key, f);
  return [...seen.values()];
}

// The two whole-PR detectors fire in high volume at low precision; the
// other detectors are the sharp ones whose findings carry the defensible
// unique-class claim. Classify the sharp findings first so the paid Opus
// arbiter's budget covers them before the noisy bulk, regardless of where
// the ceiling lands.
const LOW_PRIORITY_CATEGORIES = new Set(['coverage-erosion', 'no-op-fix']);

function arbiterPriority(f: HarnessFinding): number {
  return LOW_PRIORITY_CATEGORIES.has(f.category) ? 1 : 0;
}

async function classify(arbiter: Arbiter, f: HarnessFinding, meta: PrMeta, diff: string) {
  const line = f.lineRange?.start ?? 1;
  return arbiter.classify({
    prTitle: meta.title,
    prBodyExcerpt: meta.bodyExcerpt,
    category: f.category,
    findingMessage: f.message,
    findingEvidence: f.evidence,
    findingRationale: f.judgeRationale ?? '(deterministic detector; no rationale)',
    diffSlice: sliceDiffForFinding(diff, f.subjectPath, line),
  });
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const prIndex = loadPrIndex();

  const ledger = new CostLedger(args.maxCostUsd);
  // Two independent arbiters. By default the local model (free) is the
  // primary and Anthropic Opus the paid second opinion; when no paid
  // credits are available, --secondary-provider local runs the same local
  // model under a second, independently-worded prompt, a prompt-robustness
  // cross-check rather than a model-diversity one. The report discloses
  // which configuration ran.
  const localArbiter = await createArbiter({ provider: args.primaryProvider, ledger, promptVersion: args.primaryPrompt });
  const opusArbiter = await createArbiter({
    provider: args.secondaryProvider,
    ledger,
    promptVersion: args.secondaryPrompt,
  });
  log.info(
    `arbiters: primary=${localArbiter.modelId}/${args.primaryPrompt}, ` +
      `secondary=${opusArbiter.modelId}/${args.secondaryPrompt}; ceiling $${args.maxCostUsd}`,
  );

  const existing: DualArbiterLabel[] = fs.existsSync(dualArbiterLabelsFile())
    ? (JSON.parse(fs.readFileSync(dualArbiterLabelsFile(), 'utf8')) as DualArbiterLabel[])
    : [];
  const labels = new Map<string, DualArbiterLabel>(existing.map((l) => [`${l.repo}#${l.prNumber}:${l.key}`, l]));

  // Flatten every finding across both corpora, then sort sharp-detector
  // findings ahead of the high-volume coverage-erosion / no-op-fix bulk so
  // the paid Opus budget covers the defensible class first.
  const corpora: Corpus[] = args.corpus === 'both' ? ['regression', 'clean'] : [args.corpus];
  interface Pending {
    finding: HarnessFinding;
    meta: PrMeta;
    labelKey: string;
    corpus: Corpus;
  }
  const diffCache = new Map<string, string>();
  let pending: Pending[] = [];
  for (const corpus of corpora) {
    for (const record of loadRecords(corpus)) {
      const meta = prIndex.get(`${corpus}:${record.repo}#${record.prNumber}`);
      if (meta === undefined || !fs.existsSync(meta.diffAbsPath)) continue;
      for (const f of dedupeFindings(record)) {
        const labelKey = `${f.repo}#${f.prNumber}:${f.key}`;
        if (labels.has(labelKey)) continue;
        pending.push({ finding: f, meta, labelKey, corpus });
      }
    }
  }
  pending.sort((a, b) => arbiterPriority(a.finding) - arbiterPriority(b.finding));

  // Stratified cap: at most --per-category findings per (corpus, category)
  // so the paid arbiter measures a representative precision for every
  // detector on both corpora instead of spending the whole budget on the
  // highest-volume detector. What gets dropped is logged, never silent.
  if (args.perCategory !== null) {
    const counts = new Map<string, number>();
    const kept: Pending[] = [];
    let dropped = 0;
    for (const p of pending) {
      const stratum = `${p.corpus}:${p.finding.category}`;
      const n = counts.get(stratum) ?? 0;
      if (n >= args.perCategory) {
        dropped += 1;
        continue;
      }
      counts.set(stratum, n + 1);
      kept.push(p);
    }
    log.info(`stratified cap --per-category ${args.perCategory}: kept ${kept.length}, dropped ${dropped} over-cap findings`);
    pending = kept;
  }

  let classified = 0;
  let agreed = 0;
  for (const { finding: f, meta, labelKey } of pending) {
    if (args.limit !== null && classified >= args.limit) break;
    try {
      ledger.guardBeforeCall();
    } catch (err) {
      log.warn((err as Error).message);
      break;
    }
    let diff = diffCache.get(meta.diffAbsPath);
    if (diff === undefined) {
      diff = fs.readFileSync(meta.diffAbsPath, 'utf8');
      diffCache.set(meta.diffAbsPath, diff);
    }
    const primary = await classify(localArbiter, f, meta, diff);
    const secondary = await classify(opusArbiter, f, meta, diff);
    const isAgreed = primary.verdict === secondary.verdict;
    if (isAgreed) agreed += 1;
    labels.set(labelKey, {
      key: f.key,
      repo: f.repo,
      prNumber: f.prNumber,
      category: f.category,
      judgePath: f.judgePath,
      primary: { model: localArbiter.modelId, verdict: primary.verdict, confidence: primary.confidence },
      secondary: { model: opusArbiter.modelId, verdict: secondary.verdict, confidence: secondary.confidence },
      agreed: isAgreed,
      verdict: isAgreed ? primary.verdict : null,
    });
    classified += 1;
    if (classified % 10 === 0) log.info(`dual-classified ${classified}/${pending.length}; agreed ${agreed}; Opus spend $${ledger.spentUsd().toFixed(2)}`);
  }

  const arr = [...labels.values()];
  fs.mkdirSync(realPrsDir(), { recursive: true });
  fs.writeFileSync(dualArbiterLabelsFile(), JSON.stringify(arr, null, 2) + '\n');

  // Fold the Opus spend into the central cost ledger sidecar so the
  // report's cost footer aggregates every paid call.
  const arbiterCost = ledger.summary();
  fs.writeFileSync(path.join(realPrsDir(), 'arbiter-dual-cost.json'), JSON.stringify(arbiterCost, null, 2) + '\n');
  log.info(`dual labels: ${arr.length} total, ${classified} new, ${agreed} agreed this run; Opus spend $${ledger.spentUsd().toFixed(2)}`);
  // Touch the ledger file path early so downstream tooling can find it.
  if (!fs.existsSync(costLedgerFile())) fs.writeFileSync(costLedgerFile(), JSON.stringify({ note: 'populated by build-cost-ledger' }, null, 2) + '\n');
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

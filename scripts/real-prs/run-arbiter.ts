// Classify every audit finding with the independent arbiter. For each
// finding (across the pre and post lists, deduped by key) the arbiter sees
// the PR title/body, the diff slice the finding points at, and the finding
// text, and returns true-cheat / false-alarm / debatable /
// insufficient-context plus a confidence and a reasoning paragraph. The
// labels feed the report; the rationale file makes them auditable. The
// arbiter is independent second-pass signal, not ground truth.
//
// Usage:
//   node dist/scripts/real-prs/run-arbiter.js \
//     [--arbiter-provider anthropic|local] [--max-cost-usd 25] [--limit N]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { CostLedger } from './lib/cost';
import { createArbiter, type Arbiter, type ArbiterProvider } from './lib/arbiter';
import { sliceDiffForFinding } from './lib/slice';
import {
  arbiterLabelsFile,
  arbiterRationaleFile,
  auditResultsDir,
  costFile,
  realPrsDir,
  sourcesFile,
} from './lib/paths';
import type {
  ArbiterLabel,
  ArbiterRationale,
  AuditResultRecord,
  HarnessFinding,
  SourcePr,
  SourcesFile,
} from './lib/types';

const log = getLogger('real-prs:arbiter');

interface Args {
  provider: ArbiterProvider;
  maxCostUsd: number;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  let provider: ArbiterProvider = 'anthropic';
  let maxCostUsd = 25;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--arbiter-provider' && (next === 'anthropic' || next === 'local')) {
      provider = next;
      i += 1;
    } else if (a === '--max-cost-usd' && next !== undefined) {
      maxCostUsd = Number(next);
      i += 1;
    } else if (a === '--limit' && next !== undefined) {
      limit = Number(next);
      i += 1;
    }
  }
  return { provider, maxCostUsd, limit };
}

function loadAuditRecords(): AuditResultRecord[] {
  const dir = auditResultsDir();
  if (!fs.existsSync(dir)) return [];
  const out: AuditResultRecord[] = [];
  for (const repoDir of fs.readdirSync(dir)) {
    const full = path.join(dir, repoDir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.json')) continue;
      out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as AuditResultRecord);
    }
  }
  return out;
}

function dedupeFindings(record: AuditResultRecord): HarnessFinding[] {
  const seen = new Map<string, HarnessFinding>();
  for (const f of [...(record.pre ?? []), ...record.post]) {
    if (!seen.has(f.key)) seen.set(f.key, f);
  }
  return [...seen.values()];
}

async function classifyOne(
  arbiter: Arbiter,
  finding: HarnessFinding,
  pr: SourcePr,
  diff: string,
): Promise<{ label: ArbiterLabel; rationale: ArbiterRationale }> {
  const line = finding.lineRange?.start ?? 1;
  const diffSlice = sliceDiffForFinding(diff, finding.subjectPath, line);
  const out = await arbiter.classify({
    prTitle: pr.title,
    prBodyExcerpt: pr.bodyExcerpt,
    category: finding.category,
    findingMessage: finding.message,
    findingEvidence: finding.evidence,
    findingRationale: finding.judgeRationale ?? '(deterministic detector; no rationale)',
    diffSlice,
  });
  const label: ArbiterLabel = {
    key: finding.key,
    repo: finding.repo,
    prNumber: finding.prNumber,
    category: finding.category,
    judgePath: finding.judgePath,
    verdict: out.verdict,
    confidence: out.confidence,
    arbiterModel: arbiter.modelId,
  };
  const rationale: ArbiterRationale = {
    key: finding.key,
    repo: finding.repo,
    prNumber: finding.prNumber,
    verdict: out.verdict,
    confidence: out.confidence,
    reasoning: out.reasoning,
    arbiterModel: arbiter.modelId,
  };
  return { label, rationale };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));

  const srcFile = sourcesFile();
  if (!fs.existsSync(srcFile)) {
    log.error(`no sources.json; run real-prs:fetch first`);
    process.exit(1);
  }
  const sources = JSON.parse(fs.readFileSync(srcFile, 'utf8')) as SourcesFile;
  const prByKey = new Map<string, SourcePr>();
  for (const pr of sources.prs) prByKey.set(`${pr.repo}#${pr.prNumber}`, pr);

  const records = loadAuditRecords();
  if (records.length === 0) {
    log.error('no audit records; run real-prs:audit first');
    process.exit(1);
  }

  // Resume: reuse labels already on disk so a re-run does not re-pay.
  const existingLabels: ArbiterLabel[] = fs.existsSync(arbiterLabelsFile())
    ? (JSON.parse(fs.readFileSync(arbiterLabelsFile(), 'utf8')) as ArbiterLabel[])
    : [];
  const existingRationale: ArbiterRationale[] = fs.existsSync(arbiterRationaleFile())
    ? (JSON.parse(fs.readFileSync(arbiterRationaleFile(), 'utf8')) as ArbiterRationale[])
    : [];
  const labels = new Map<string, ArbiterLabel>(existingLabels.map((l) => [l.key, l]));
  const rationales = new Map<string, ArbiterRationale>(existingRationale.map((r) => [r.key, r]));

  const ledger = new CostLedger(args.maxCostUsd);
  const arbiter = await createArbiter({ provider: args.provider, ledger });
  log.info(`arbiter model: ${arbiter.modelId}; cost ceiling $${args.maxCostUsd}`);

  let classified = 0;
  let pending = 0;
  outer: for (const record of records) {
    const pr = prByKey.get(`${record.repo}#${record.prNumber}`);
    if (pr === undefined) {
      log.warn(`no source for ${record.repo}#${record.prNumber}; skipping`);
      continue;
    }
    const diff = fs.readFileSync(path.join(realPrsDir(), pr.diffPath), 'utf8');
    for (const finding of dedupeFindings(record)) {
      if (labels.has(finding.key)) continue;
      if (args.limit !== null && classified >= args.limit) break outer;
      try {
        ledger.guardBeforeCall();
      } catch (err) {
        log.warn((err as Error).message);
        pending += 1;
        break outer;
      }
      const { label, rationale } = await classifyOne(arbiter, finding, pr, diff);
      labels.set(label.key, label);
      rationales.set(rationale.key, rationale);
      classified += 1;
      if (classified % 10 === 0) {
        log.info(`classified ${classified} findings; spent $${ledger.spentUsd().toFixed(2)}`);
      }
    }
  }

  const labelArr = [...labels.values()];
  const rationaleArr = [...rationales.values()];
  fs.mkdirSync(realPrsDir(), { recursive: true });
  fs.writeFileSync(arbiterLabelsFile(), JSON.stringify(labelArr, null, 2) + '\n');
  fs.writeFileSync(arbiterRationaleFile(), JSON.stringify(rationaleArr, null, 2) + '\n');
  fs.writeFileSync(costFile(), JSON.stringify(ledger.summary(), null, 2) + '\n');
  log.info(
    `classified ${classified} new findings (${labelArr.length} total), spent ` +
      `$${ledger.spentUsd().toFixed(2)} of $${args.maxCostUsd}` +
      (pending > 0 ? `; stopped early at the cost ceiling with findings left to classify` : ''),
  );
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Dual-arbiter classification for the agent corpus, mirroring
// run-arbiter-dual: two independent model families read each finding plus
// its diff slice; a finding is labeled only when both agree, and a
// disagreement is an arbiter-split excluded from the headline counts.
// Resumable: a finding already dual-labeled is not re-paid.
//
// Usage:
//   node dist/scripts/real-prs/arbiter-agent-prs.js \
//     [--max-cost-usd 20] [--limit N] \
//     [--primary-provider ollama] [--secondary-provider anthropic]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { CostLedger } from './lib/cost';
import { createArbiter, type Arbiter, type ArbiterProvider } from './lib/arbiter';
import { sliceDiffForFinding } from './lib/slice';
import { agentAuditResultsDir, agentCorpusDir, agentLabelsFile, agentSourcesFile } from './lib/paths';
import type { AuditResultRecord, DualArbiterLabel, HarnessFinding } from './lib/types';
import type { AgentSourcesFile } from './lib/agent-types';

const log = getLogger('real-prs:arbiter-agent');

interface Args {
  maxCostUsd: number;
  limit: number | null;
  primaryProvider: ArbiterProvider;
  secondaryProvider: ArbiterProvider;
  primaryPrompt: string;
  secondaryPrompt: string;
  primaryModel: string | null;
  secondaryModel: string | null;
}

function isProvider(v: string | undefined): v is ArbiterProvider {
  return v === 'anthropic' || v === 'local' || v === 'ollama';
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    maxCostUsd: 20,
    limit: null,
    primaryProvider: 'ollama',
    secondaryProvider: 'anthropic',
    primaryPrompt: 'v2',
    secondaryPrompt: 'v1',
    primaryModel: null,
    secondaryModel: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--max-cost-usd' && next !== undefined) (args.maxCostUsd = Number(next)), (i += 1);
    else if (a === '--limit' && next !== undefined) (args.limit = Number(next)), (i += 1);
    else if (a === '--primary-provider' && isProvider(next)) (args.primaryProvider = next), (i += 1);
    else if (a === '--secondary-provider' && isProvider(next)) (args.secondaryProvider = next), (i += 1);
    else if (a === '--primary-prompt' && next !== undefined) (args.primaryPrompt = next), (i += 1);
    else if (a === '--secondary-prompt' && next !== undefined) (args.secondaryPrompt = next), (i += 1);
    else if (a === '--primary-model' && next !== undefined) (args.primaryModel = next), (i += 1);
    else if (a === '--secondary-model' && next !== undefined) (args.secondaryModel = next), (i += 1);
  }
  return args;
}

interface PrMeta {
  title: string;
  bodyExcerpt: string;
  diffAbsPath: string;
}

function loadRecords(): AuditResultRecord[] {
  const dir = agentAuditResultsDir();
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
  const sources = JSON.parse(fs.readFileSync(agentSourcesFile(), 'utf8')) as AgentSourcesFile;
  const prIndex = new Map<string, PrMeta>(
    sources.prs.map((p) => [
      `${p.repo}#${p.prNumber}`,
      { title: p.title, bodyExcerpt: p.bodyExcerpt, diffAbsPath: path.join(agentCorpusDir(), p.diffPath) },
    ]),
  );

  const ledger = new CostLedger(args.maxCostUsd);
  const primary = await createArbiter({
    provider: args.primaryProvider,
    ledger,
    promptVersion: args.primaryPrompt,
    ...(args.primaryModel !== null ? { ollamaModel: args.primaryModel, localModel: args.primaryModel, anthropicModel: args.primaryModel } : {}),
  });
  const secondary = await createArbiter({
    provider: args.secondaryProvider,
    ledger,
    promptVersion: args.secondaryPrompt,
    ...(args.secondaryModel !== null ? { ollamaModel: args.secondaryModel, localModel: args.secondaryModel, anthropicModel: args.secondaryModel } : {}),
  });
  log.info(`arbiters: primary=${primary.modelId}/${args.primaryPrompt}, secondary=${secondary.modelId}/${args.secondaryPrompt}; ceiling $${args.maxCostUsd}`);

  const existing: DualArbiterLabel[] = fs.existsSync(agentLabelsFile())
    ? (JSON.parse(fs.readFileSync(agentLabelsFile(), 'utf8')) as DualArbiterLabel[])
    : [];
  const labels = new Map<string, DualArbiterLabel>(existing.map((l) => [`${l.repo}#${l.prNumber}:${l.key}`, l]));

  const diffCache = new Map<string, string>();
  let classified = 0;
  let agreed = 0;
  for (const record of loadRecords()) {
    const meta = prIndex.get(`${record.repo}#${record.prNumber}`);
    if (meta === undefined || !fs.existsSync(meta.diffAbsPath)) continue;
    for (const f of record.post) {
      const labelKey = `${f.repo}#${f.prNumber}:${f.key}`;
      if (labels.has(labelKey)) continue;
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
      const p = await classify(primary, f, meta, diff);
      const s = await classify(secondary, f, meta, diff);
      const isAgreed = p.verdict === s.verdict;
      if (isAgreed) agreed += 1;
      labels.set(labelKey, {
        key: f.key,
        repo: f.repo,
        prNumber: f.prNumber,
        category: f.category,
        judgePath: f.judgePath,
        primary: { model: primary.modelId, verdict: p.verdict, confidence: p.confidence },
        secondary: { model: secondary.modelId, verdict: s.verdict, confidence: s.confidence },
        agreed: isAgreed,
        verdict: isAgreed ? p.verdict : null,
      });
      classified += 1;
      if (classified % 10 === 0) {
        log.info(`dual-classified ${classified}; agreed ${agreed}; paid spend $${ledger.spentUsd().toFixed(2)}`);
        // Incremental save: local-model runs take hours and a crash must not
        // lose paid-for or computed verdicts; the run is resumable from here.
        fs.mkdirSync(agentCorpusDir(), { recursive: true });
        fs.writeFileSync(agentLabelsFile(), JSON.stringify([...labels.values()], null, 2) + '\n');
      }
    }
  }

  const arr = [...labels.values()];
  fs.mkdirSync(agentCorpusDir(), { recursive: true });
  fs.writeFileSync(agentLabelsFile(), JSON.stringify(arr, null, 2) + '\n');
  fs.writeFileSync(
    path.join(agentCorpusDir(), 'arbiter-cost.json'),
    JSON.stringify(ledger.summary(), null, 2) + '\n',
  );
  log.info(`agent dual labels: ${arr.length} total, ${classified} new, ${agreed} agreed this run; paid spend $${ledger.spentUsd().toFixed(2)}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

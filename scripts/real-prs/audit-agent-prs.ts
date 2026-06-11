// Audit every agent-corpus PR with the post-upgrade pipeline (the shipped
// product configuration: default detector set, judge confirm + judge
// primary when enabled). Writes one AuditResultRecord per PR, the same
// shape the clean corpus uses, so the dual arbiter runs unchanged.
// Resumable: a PR whose record exists is skipped unless --force.
//
// Usage:
//   node dist/scripts/real-prs/audit-agent-prs.js [--no-judge] [--limit N] [--force]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import type { AuditInput, JudgeLedgerEntry, JudgeLedgerSink } from '../../src/audit/types';
import { normalizeFindings } from './lib/findings';
import { agentAuditResultsDir, agentCorpusDir, agentSourcesFile, repoSlug } from './lib/paths';
import type { AuditResultRecord } from './lib/types';
import type { AgentSourcesFile } from './lib/agent-types';

const log = getLogger('real-prs:audit-agent');

class JudgeCounter implements JudgeLedgerSink {
  liveCalls = 0;
  cacheHits = 0;
  // Asks that produced no verdict (server down, timeout, unparseable
  // reply). Counted separately: in the finding output a judge that
  // silently answered nothing is indistinguishable from one that
  // answered NO, and that hides false negatives.
  unavailable = 0;
  appendJudgeEntry(entry: JudgeLedgerEntry): void {
    if (entry.cacheHit) this.cacheHits += 1;
    else if (entry.answer !== 'unavailable') this.liveCalls += 1;
    else this.unavailable += 1;
  }
}

interface Args {
  noJudge: boolean;
  limit: number | null;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { noJudge: false, limit: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--no-judge') args.noJudge = true;
    else if (a === '--limit' && next !== undefined) (args.limit = Number(next)), (i += 1);
    else if (a === '--force') args.force = true;
  }
  return args;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(agentSourcesFile())) {
    log.error(`no agent corpus at ${agentSourcesFile()}; run fetch-agent-prs first`);
    process.exit(1);
  }
  const sources = JSON.parse(fs.readFileSync(agentSourcesFile(), 'utf8')) as AgentSourcesFile;
  const counter = new JudgeCounter();
  let done = 0;
  for (const pr of sources.prs) {
    if (args.limit !== null && done >= args.limit) break;
    const repoOut = path.join(agentAuditResultsDir(), repoSlug(pr.repo));
    const recFile = path.join(repoOut, `${pr.prNumber}.json`);
    if (!args.force && fs.existsSync(recFile)) {
      done += 1;
      continue;
    }
    const absDiff = path.join(agentCorpusDir(), pr.diffPath);
    if (!fs.existsSync(absDiff)) {
      log.warn(`missing diff for ${pr.repo}#${pr.prNumber} at ${absDiff}; skipping`);
      continue;
    }
    const input: AuditInput = {
      unifiedDiff: fs.readFileSync(absDiff, 'utf8'),
      repoRoot: agentCorpusDir(),
      judgeEnabled: !args.noJudge,
      judgeLedger: counter,
      pr: {
        number: pr.prNumber,
        headSha: pr.headSha,
        baseSha: '',
        title: pr.title,
        body: pr.bodyExcerpt,
        author: '',
        headRef: '',
        repository: pr.repo,
      },
    };
    const result = await runCheatDetectors(input);
    const post = normalizeFindings(pr.repo, pr.prNumber, result.findings);
    const record: AuditResultRecord = { repo: pr.repo, prNumber: pr.prNumber, headSha: pr.headSha, pre: null, post };
    fs.mkdirSync(repoOut, { recursive: true });
    fs.writeFileSync(recFile, JSON.stringify(record, null, 2) + '\n');
    done += 1;
    log.info(
      `${pr.repo}#${pr.prNumber} (${pr.agent.vendor}): ${post.length} findings ` +
        `(${done}/${sources.prs.length}) judge live=${counter.liveCalls} cache=${counter.cacheHits} unavailable=${counter.unavailable}`,
    );
  }
  log.info(
    `agent audit complete: ${done} PRs; billable judge calls=${counter.liveCalls}, ` +
      `cache hits=${counter.cacheHits}, unavailable=${counter.unavailable}`,
  );
  if (counter.unavailable > 0) {
    log.warn(
      `${counter.unavailable} judge asks produced no verdict; the affected categories ` +
        `degraded to deterministic-only for those PRs. Check the judge server and re-run with --force.`,
    );
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

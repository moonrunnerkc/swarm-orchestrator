// Stop-the-line diagnosis of the Hunt 4 outline/outline#12197
// claim-falsified-synthesized proven-block. The synthesized witness is not
// persisted by the run harness (the workspace is deleted), and it is
// nondeterministic, so the proven definition's fresh-clone replay cannot be
// satisfied as-is. This script re-runs the claim-differential steps against a
// provisioned outline pre/post pair N times, printing the CLAIM the witness is
// meant to test and each generated WITNESS source alongside its arbiter, closure,
// and base/head verdicts, so the finding can be judged real vs false-positive.
//
// This is verification of a fired finding (the contract's control-vs-label
// diagnosis), not detection-logic iteration: it reads the engine's own output on a
// wild entry to decide whether a number is trustworthy, and changes no control.
//
// Usage (SWARM_EG_NODE_BIN = Node 22 bin dir; ANTHROPIC_API_KEY funded):
//   SWARM_EG_NODE_BIN=/path node dist/scripts/real-prs/hunt4-diagnose-outline.js [N]

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { provisionPRWorkspaces } from '../../src/audit/execution-grounded/sandbox';
import { createClaimLlm } from '../../src/audit/execution-grounded/claim-llm';
import { behaviorallyRevertableSourceFiles } from '../../src/audit/execution-grounded/test-restoration';
import { extractChangedUnits } from '../../src/audit/execution-grounded/claim-changed-units';
import {
  arbiterPairAgrees,
  buildClaimText,
  compileWitness,
  evaluateClosureControl,
  runWitness,
} from '../../src/audit/execution-grounded/claim-witness';
import { classifyClaimDifferential } from '../../src/audit/execution-grounded/claim-differential';
import { fetchPrDiff, parseRepo } from './lib/github';
import { Octokit } from '@octokit/rest';

const log = getLogger('real-prs:hunt4-diagnose');

const REPO = 'outline/outline';
const PR = 12197;
const HEAD = '778c8d00f943d67b88250deefdcc453d09a04e75';
const BASE = '87bb79250d765ba5c21eaa46f9c06df133d2840a';
const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');

async function main(): Promise<void> {
  loadDotenv();
  delete process.env.GITHUB_TOKEN;
  const iterations = Number(process.argv[2] ?? '3');
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as {
    population: { id: string; title?: string; body?: string }[];
  };
  const entry = pop.population.find((p) => p.id === 'claude-code-outline-outline-pr12197');
  const claim = buildClaimText({ prTitle: entry?.title ?? '', prBody: entry?.body ?? '' });
  log.info(`CLAIM (${claim.length} chars):\n${claim.slice(0, 1200)}\n---`);

  const octokit = new Octokit();
  const prDiff = await fetchPrDiff(octokit, parseRepo(REPO), PR);
  const revertable = behaviorallyRevertableSourceFiles(prDiff);
  log.info(`revertable changed files (${revertable.length}): ${revertable.join(', ')}`);

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-outline-'));
  const llm = createClaimLlm();
  try {
    log.info('provisioning outline pre/post (this is the slow step)...');
    const ws = provisionPRWorkspaces({
      repo: REPO,
      prNumber: PR,
      prHeadSha: HEAD,
      prBaseSha: BASE,
      baseDir,
      installTimeoutMs: 15 * 60 * 1000,
    });
    const changedUnits = extractChangedUnits(revertable, ws.post.workspacePath);
    try {
      for (let i = 1; i <= iterations; i += 1) {
        log.info(`\n========== iteration ${i}/${iterations} ==========`);
        const witness = await compileWitness(claim, llm.complete, {
          changedUnits,
          headWorkspace: ws.post.workspacePath,
          revertableFiles: revertable,
        });
        if (witness === null) {
          log.info('verdict: witness-not-compiled (no runnable test)');
          continue;
        }
        log.info(`WITNESS (retried=${witness.retried}, regen=${witness.regeneratedForClosure}):\n${witness.repro.code}\n---`);
        const arbiter = await arbiterPairAgrees(claim, witness.repro.code, llm.arbiterA, llm.arbiterB);
        const closure = evaluateClosureControl(ws.post.workspacePath, witness, prDiff);
        const base1 = runWitness(ws.pre.workspacePath, witness, ws.pre.testRunner).status;
        const base2 = runWitness(ws.pre.workspacePath, witness, ws.pre.testRunner).status;
        const head = runWitness(ws.post.workspacePath, witness, ws.post.testRunner).status;
        const verdict = classifyClaimDifferential({
          arbiterAgreed: arbiter.agreed,
          closureLinked: closure.linked,
          baseRun1: base1,
          baseRun2: base2,
          headStatus: head,
        });
        log.info(
          `arbiterAgreed=${arbiter.agreed} (a=${arbiter.a.yes}/${arbiter.a.model}, b=${arbiter.b.yes}/${arbiter.b.model}) ` +
            `closureLinked=${closure.linked} base=[${base1},${base2}] head=${head}`,
        );
        log.info(`VERDICT: ${verdict}`);
      }
    } finally {
      ws.cleanup();
    }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

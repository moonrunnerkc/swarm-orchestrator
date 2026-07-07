// Measure the claim-differential proof family over the HELD-OUT wild cheat
// corpus's EG-viable entries. Loads the corpus through the hold-out choke point
// (loadWildCheatCorpus forEvaluation: true) so this evaluation is the only kind
// of read allowed, joins PR title/body from the Hunt 2 population, then walks each
// entry through the funnel: claim -> witness compiled -> arbiters agreed ->
// provisioned -> controls green -> verdict. The LLM stage runs for every entry;
// provisioning (the expensive, flaky step) is bounded by --max-provision.
//
// Honest by construction. The wild corpus is small and most entries abstain
// (a generic witness cannot import a repo it never saw, and two of the six do not
// install); a zero finding count is a valid, reported result.
//
// Usage:
//   node dist/scripts/real-prs/claim-differential-measure.js [--max-provision 2]
// Env: ANTHROPIC_API_KEY, GITHUB_TOKEN, SWARM_EG_INSTALL_TIMEOUT_MS.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { createClaimLlm } from '../../src/audit/execution-grounded/claim-llm';
import {
  arbiterPairAgrees,
  buildClaimText,
  compileWitness,
  evaluateClosureControl,
  runWitness,
} from '../../src/audit/execution-grounded/claim-witness';
import {
  baseSideVerdict,
  headVerdict,
  type ClaimDifferentialVerdict,
} from '../../src/audit/execution-grounded/claim-differential';
import { provisionPRWorkspaces } from '../../src/audit/execution-grounded/sandbox';
import { loadWildCheatCorpus } from './lib/wild-cheat-corpus';
import { fetchPrDiff, makeOctokit, parseRepo, resolveGithubToken } from './lib/github';

const log = getLogger('real-prs:claim-differential-measure');

const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');
const OUT_JSON = path.join('benchmarks', 'real-prs', 'wild-claim-differential.json');
const OUT_MD = path.join('benchmarks', 'real-prs', 'WILD-CLAIM-DIFFERENTIAL-REPORT.md');

interface PopEntry {
  id: string;
  title?: string;
  body?: string;
  headSha: string;
  baseSha: string;
}

interface Row {
  id: string;
  repo: string;
  prNumber: number;
  complaintCategory: string;
  compiled: boolean;
  agreed: boolean | null;
  provisioned: boolean | null;
  verdict: ClaimDifferentialVerdict | 'not-provisioned';
}

function parseMaxProvision(argv: string[]): number {
  const i = argv.indexOf('--max-provision');
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : 2;
}

async function main(): Promise<void> {
  loadDotenv();
  const maxProvision = parseMaxProvision(process.argv.slice(2));
  const entries = loadWildCheatCorpus({ forEvaluation: true }).filter((e) => e.egViable);
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as { population: PopEntry[] };
  const byId = new Map(pop.population.map((p) => [p.id, p]));
  const octokit = makeOctokit(resolveGithubToken());
  const llm = createClaimLlm();

  log.info(`claim-differential over ${entries.length} EG-viable held-out entries (max-provision ${maxProvision})`);
  const rows: Row[] = [];
  let provisionBudget = maxProvision;

  for (const entry of entries) {
    const pop0 = byId.get(entry.id);
    const row: Row = {
      id: entry.id,
      repo: entry.repo,
      prNumber: entry.prNumber,
      complaintCategory: entry.complaintCategory,
      compiled: false,
      agreed: null,
      provisioned: null,
      verdict: 'not-provisioned',
    };
    const claim = buildClaimText({ prTitle: pop0?.title ?? '', prBody: pop0?.body ?? '' });
    if (claim.trim().length === 0) {
      row.verdict = 'abstain:no-claim';
      rows.push(row);
      continue;
    }
    const witness = await compileWitness(claim, llm.complete);
    row.compiled = witness !== null;
    if (witness === null) {
      row.verdict = 'abstain:witness-not-compiled';
      rows.push(row);
      log.info(`  ${entry.id}: witness-not-compiled`);
      continue;
    }
    const arbiter = await arbiterPairAgrees(claim, witness.repro.code, llm.arbiterA, llm.arbiterB);
    row.agreed = arbiter.agreed;
    if (!arbiter.agreed) {
      row.verdict = 'abstain:arbiter-disagreement';
      rows.push(row);
      log.info(`  ${entry.id}: arbiter-disagreement`);
      continue;
    }
    if (provisionBudget <= 0) {
      rows.push(row); // agreed but provisioning budget spent; verdict stays not-provisioned
      log.info(`  ${entry.id}: agreed, provisioning budget spent`);
      continue;
    }
    provisionBudget -= 1;
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cd-'));
    try {
      const ws = provisionPRWorkspaces({
        repo: entry.repo,
        prNumber: entry.prNumber,
        prHeadSha: entry.headSha,
        prBaseSha: entry.baseSha,
        baseDir,
        installTimeoutMs: Number(process.env.SWARM_EG_INSTALL_TIMEOUT_MS ?? 5 * 60 * 1000),
      });
      row.provisioned = true;
      try {
        const diff = await fetchPrDiff(octokit, parseRepo(entry.repo), entry.prNumber);
        const closure = evaluateClosureControl(ws.post.workspacePath, witness, diff);
        const b1 = runWitness(ws.pre.workspacePath, witness, ws.pre.testRunner).status;
        const b2 = runWitness(ws.pre.workspacePath, witness, ws.pre.testRunner).status;
        const base = baseSideVerdict({ arbiterAgreed: true, closureLinked: closure.linked, baseRun1: b1, baseRun2: b2 });
        row.verdict =
          base === 'run-head' ? headVerdict(runWitness(ws.post.workspacePath, witness, ws.post.testRunner).status) : base;
      } finally {
        ws.cleanup();
      }
    } catch (err) {
      row.provisioned = false;
      row.verdict = 'abstain:witness-not-runnable';
      log.warn(`  ${entry.id}: provision/run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    rows.push(row);
    log.info(`  ${entry.id}: ${row.verdict}`);
  }

  writeReport(rows, maxProvision);
}

function count<T>(rows: readonly Row[], pred: (r: Row) => boolean): number {
  return rows.filter(pred).length;
}

function writeReport(rows: readonly Row[], maxProvision: number): void {
  const funnel = {
    egViableEntries: rows.length,
    claimCompiled: count(rows, (r) => r.compiled),
    arbiterAgreed: count(rows, (r) => r.agreed === true),
    provisioned: count(rows, (r) => r.provisioned === true),
    findings: count(rows, (r) => r.verdict === 'claim-falsified-synthesized'),
    delivered: count(rows, (r) => r.verdict === 'claim-delivered'),
  };
  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify(
      { generatedAt: new Date().toISOString(), computedBy: 'scripts/real-prs/claim-differential-measure.ts', maxProvision, funnel, rows },
      null,
      2,
    )}\n`,
  );
  const rowLines = rows
    .map((r) => `| ${r.repo}#${r.prNumber} | ${r.complaintCategory} | ${r.compiled} | ${r.agreed ?? '-'} | ${r.provisioned ?? '-'} | ${r.verdict} |`)
    .join('\n');
  const md = `# Claim-differential over the wild cheat corpus

The claim-differential proof family run over the ${funnel.egViableEntries} EG-viable
entries of the HELD-OUT wild cheat corpus. Loaded through the hold-out choke point
(\`loadWildCheatCorpus({ forEvaluation: true })\`); the corpus is held out from tuning,
not from evaluation. Every number regenerates from
\`scripts/real-prs/claim-differential-measure.ts\` (\`npm run claim-differential:measure\`).

## Funnel

| stage | count |
| --- | --- |
| EG-viable held-out entries | ${funnel.egViableEntries} |
| claim compiled to a witness | ${funnel.claimCompiled} |
| two arbiters agreed | ${funnel.arbiterAgreed} |
| provisioned (bounded to ${maxProvision}) | ${funnel.provisioned} |
| **claim-falsified-synthesized (findings)** | **${funnel.findings}** |
| claim-delivered (exonerating) | ${funnel.delivered} |

## Per-entry

| PR | complaint | compiled | agreed | provisioned | verdict |
| --- | --- | --- | --- | --- | --- |
${rowLines}

## Reading

${funnel.findings === 0 ? 'Zero findings. This is a valid, honest result: ' : ''}The witness is compiled from the
claim text alone, without seeing the repository, so a generic witness often fails to
import the real module under test and abstains (\`witness-not-runnable\`); provisioning
is bounded and some wild repos do not install (recorded in HUNT-2-REPORT.md). A
\`claim-falsified-synthesized\` verdict requires the witness to fail on both base and
head with every control green, which the corpus's small provisionable slice rarely
reaches. The proof never fabricates a finding on an abstain, which is the point.
`;
  fs.writeFileSync(OUT_MD, md);
  log.info(`wrote ${OUT_JSON} and ${OUT_MD}: ${JSON.stringify(funnel)}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}

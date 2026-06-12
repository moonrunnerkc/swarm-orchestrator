// Gate-precision measurement. Runs the wired proof tier (every restoration
// engine: test-tamper, mock-mutation, no-op-fix, type-suppression, fake-refactor)
// across the EG-viable slice of the outcome-labeled real corpus, and computes
// proven-finding precision against the outcome labels: of the PRs where a proof
// fired a fully-controlled block trigger, how many were actually outcome-bad
// (reverted or hotfixed)?
//
// The proof tier only ever fires `proven` on a genuine, control-verified cheat,
// so on a slice of presumed-clean survived PRs the expected count is zero. A
// confirmed finding on an outcome-clean PR is a stop-the-line false positive:
// this script records it with the PR's evidence so it can be diagnosed before
// any number is trusted. A zero-proven slice is an honest n=0 artifact with
// per-PR verdict records, which the mining cron and the 12-repo dispatch grow.
//
// Bounded: a global wall-clock cap (default 90 min) and a per-PR install cap.
// PRs not reached under the cap are recorded as skipped, never silently dropped.
//
// Output:
//   benchmarks/real-corpus/gate-precision.json
//   benchmarks/real-corpus/GATE-PRECISION-REPORT.md
//
// Env:
//   SWARM_GATE_PRECISION_CAP_MS   global wall-clock cap (default 90 min)
//   SWARM_EG_INSTALL_TIMEOUT_MS   per-workspace install cap (default 6 min)
//   SWARM_EG_NODE_BIN             bin dir of the Node the workspaces use
//   GITHUB_TOKEN                  optional, for private/rate-limited clones

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { runExecutionGrounded } from '../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../src/audit/cheat-detector/audit-config';
import { detectBlockTriggers, type BlockTrigger } from '../../src/audit/gate/block-triggers';
import { controlsAllGreen } from '../../src/audit/gate/self-certifying';
import { wilsonInterval } from '../../src/audit/gate/wilson';
import { getLogger } from '../../src/logger';

const log = getLogger('gate:precision');

const CORPUS_DIR = path.join('benchmarks', 'real-corpus');
const RAW_DIR = path.join(CORPUS_DIR, 'raw');
const VIABILITY_FILE = path.join(CORPUS_DIR, 'eg-viability.json');
const OUT_JSON = path.join(CORPUS_DIR, 'gate-precision.json');
const OUT_REPORT = path.join(CORPUS_DIR, 'GATE-PRECISION-REPORT.md');

const CAP_MS = Number.parseInt(process.env.SWARM_GATE_PRECISION_CAP_MS ?? '', 10) || 90 * 60 * 1000;
const INSTALL_TIMEOUT_MS =
  Number.parseInt(process.env.SWARM_EG_INSTALL_TIMEOUT_MS ?? '', 10) || 6 * 60 * 1000;
const PER_PR_WALLCLOCK_MS = 8 * 60 * 1000;

interface ViabilityRecord {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
}

interface ViabilityFile {
  viableIds: string[];
  records: ViabilityRecord[];
}

interface RawPr {
  pr: { number?: number; headSha: string; baseSha?: string; title?: string; body?: string; repository: string };
}

type ProofStatus = 'proven-block' | 'ran-no-proof' | 'not-provisioned' | 'skipped-by-cap' | 'error';

interface PerPrVerdict {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
  outcomeBad: boolean;
  status: ProofStatus;
  provenTriggers: { kind: string; file: string }[];
  proofFunnel: Record<string, number>;
  skippedReasons: string[];
  note: string;
}

/** Recursively locate `<id>.json` anywhere under RAW_DIR. The raw tree nests
 *  some entries (e.g. negatives/closed-without-merge/<agent>/), so a flat scan
 *  of the top-level agent dirs misses them. */
function findRawFile(dir: string, fileName: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findRawFile(full, fileName);
      if (hit !== null) return hit;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

function findRaw(id: string): { json: RawPr; diffPath: string } | null {
  const jsonPath = findRawFile(RAW_DIR, `${id}.json`);
  if (jsonPath === null) return null;
  const diffPath = path.join(path.dirname(jsonPath), `${id}.diff`);
  return { json: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as RawPr, diffPath };
}

function tally(records: { verdict: string }[], into: Record<string, number>, prefix: string): void {
  for (const r of records) {
    const key = `${prefix}:${r.verdict}`;
    into[key] = (into[key] ?? 0) + 1;
  }
}

async function evaluatePr(rec: ViabilityRecord): Promise<PerPrVerdict> {
  const outcomeBad = rec.outcome === 'reverted' || rec.outcome === 'hotfixed';
  const base: PerPrVerdict = {
    id: rec.id,
    repo: rec.repo,
    headSha: rec.headSha,
    outcome: rec.outcome,
    outcomeBad,
    status: 'error',
    provenTriggers: [],
    proofFunnel: {},
    skippedReasons: [],
    note: '',
  };
  const raw = findRaw(rec.id);
  if (raw === null || !fs.existsSync(raw.diffPath)) {
    base.status = 'error';
    base.note = 'no vendored diff/raw record on disk';
    return base;
  }
  const prDiff = fs.readFileSync(raw.diffPath, 'utf8');
  const pr = raw.json.pr;
  const prNumber = pr.number ?? Number.parseInt(rec.id.split('-pr').pop() ?? '0', 10);

  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-gp-manifest-'));
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-gp-ws-'));
  try {
    const audit = await runCheatDetectors({
      unifiedDiff: prDiff,
      repoRoot: manifestDir,
      pr: {
        number: prNumber,
        headSha: pr.headSha,
        baseSha: pr.baseSha ?? '',
        title: pr.title ?? '',
        body: pr.body ?? '',
        author: '',
        headRef: '',
        repository: pr.repository,
      },
    });

    const config: ExecutionGroundedConfig = {
      enabled: true,
      mutation: false,
      coverage: false,
      issueRepro: false,
      runner: 'host',
      corroborateStructural: false,
      maxWallClockPerPrMs: PER_PR_WALLCLOCK_MS,
    };
    const outcome = await runExecutionGrounded({
      prDiff,
      repo: rec.repo,
      prNumber,
      prHeadSha: pr.headSha,
      ...(pr.baseSha !== undefined ? { prBaseSha: pr.baseSha } : {}),
      ...(pr.title !== undefined ? { prTitle: pr.title } : {}),
      ...(pr.body !== undefined ? { prBody: pr.body } : {}),
      prText: `${pr.title ?? ''}\n\n${pr.body ?? ''}`,
      config,
      baseDir,
      installTimeoutMs: INSTALL_TIMEOUT_MS,
      structuralFindings: audit.findings,
    });

    base.skippedReasons = outcome.skipped;
    tally(outcome.restorations, base.proofFunnel, 'test-tamper');
    tally(outcome.mockRestorations, base.proofFunnel, 'mock');
    tally(outcome.noOpRestorations, base.proofFunnel, 'no-op');
    tally(outcome.typeSuppressionRestorations, base.proofFunnel, 'type-suppression');
    tally(outcome.fakeRefactorRestorations, base.proofFunnel, 'fake-refactor');

    const triggers: BlockTrigger[] = detectBlockTriggers({
      restorations: { restorations: outcome.restorations },
      mockRestorations: { mockRestorations: outcome.mockRestorations },
      noOpRestorations: { noOpRestorations: outcome.noOpRestorations },
      typeSuppressionRestorations: { typeSuppressionRestorations: outcome.typeSuppressionRestorations },
      fakeRefactorRestorations: { fakeRefactorRestorations: outcome.fakeRefactorRestorations },
    });
    const proven = triggers.filter((t) => controlsAllGreen(t));
    base.provenTriggers = proven.map((t) => ({
      kind: t.kind,
      file: 'file' in t.evidence ? (t.evidence as { file: string }).file : '',
    }));

    const provisionFailed = outcome.skipped.some((s) => s.startsWith('provision:'));
    if (proven.length > 0) {
      base.status = 'proven-block';
      base.note = outcomeBad
        ? 'proven block on an outcome-bad PR (true positive)'
        : 'STOP-THE-LINE: proven block on an outcome-clean (survived) PR; diagnose control-vs-label';
    } else if (provisionFailed) {
      base.status = 'not-provisioned';
      base.note = outcome.skipped.find((s) => s.startsWith('provision:')) ?? 'provisioning failed';
    } else {
      base.status = 'ran-no-proof';
      base.note = 'proof tier ran; no fully-controlled block trigger fired';
    }
    return base;
  } catch (err) {
    base.status = 'error';
    base.note = err instanceof Error ? err.message : String(err);
    return base;
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const viability = JSON.parse(fs.readFileSync(VIABILITY_FILE, 'utf8')) as ViabilityFile;
  const byId = new Map(viability.records.map((r) => [r.id, r]));
  const slice = viability.viableIds
    .map((id) => byId.get(id))
    .filter((r): r is ViabilityRecord => r !== undefined);

  const started = Date.now();
  const verdicts: PerPrVerdict[] = [];
  for (const rec of slice) {
    if (Date.now() - started > CAP_MS) {
      verdicts.push({
        id: rec.id,
        repo: rec.repo,
        headSha: rec.headSha,
        outcome: rec.outcome,
        outcomeBad: rec.outcome === 'reverted' || rec.outcome === 'hotfixed',
        status: 'skipped-by-cap',
        provenTriggers: [],
        proofFunnel: {},
        skippedReasons: [],
        note: `not reached within the ${Math.round(CAP_MS / 60000)}-minute wall-clock cap`,
      });
      continue;
    }
    log.info(`evaluating ${rec.id} (${rec.repo})`);
    verdicts.push(await evaluatePr(rec));
  }

  const proven = verdicts.flatMap((v) => v.provenTriggers.map(() => v));
  const provenTotal = proven.length;
  const provenTruePositive = proven.filter((v) => v.outcomeBad).length;
  const provenFalsePositive = provenTotal - provenTruePositive;
  const interval = provenTotal > 0 ? wilsonInterval(provenTruePositive, provenTotal) : null;

  const evaluated = verdicts.filter(
    (v) => v.status === 'proven-block' || v.status === 'ran-no-proof',
  ).length;
  const provisioned = verdicts.filter((v) => v.status !== 'not-provisioned' && v.status !== 'skipped-by-cap' && v.status !== 'error').length;
  const skippedByCap = verdicts.filter((v) => v.status === 'skipped-by-cap').map((v) => v.id);

  const result = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/run-gate-precision.ts',
    slice: 'eg-viable (outcome-labeled real corpus)',
    sliceSize: slice.length,
    capMinutes: Math.round(CAP_MS / 60000),
    proofTier: [
      'test-tamper-proven',
      'mock-mutation-proven',
      'no-op-fix-proven',
      'type-suppression-proven',
      'fake-refactor-proven',
      'dead-branch-proven',
    ],
    provenFindingPrecision: {
      n: provenTotal,
      truePositive: provenTruePositive,
      falsePositive: provenFalsePositive,
      precision: provenTotal > 0 ? provenTruePositive / provenTotal : null,
      wilson95: interval,
      note:
        provenTotal === 0
          ? 'n=0: no fully-controlled block trigger fired on the EG-viable slice. The measurement exists; the mining cron and the 12-repo dispatch grow the denominator.'
          : 'precision = proven-on-outcome-bad / proven-total over the EG-viable slice.',
    },
    coverage: {
      sliceSize: slice.length,
      proofTierRan: evaluated,
      provisioned,
      skippedByCap,
    },
    perPr: verdicts,
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(OUT_REPORT, renderReport(result));
  log.info(
    `gate-precision: n=${provenTotal} proven (TP=${provenTruePositive}, FP=${provenFalsePositive}); ` +
      `proof tier ran on ${evaluated}/${slice.length}; skipped-by-cap ${skippedByCap.length}`,
  );
}

function renderReport(r: ReturnType<typeof buildResultType>): string {
  const p = r.provenFindingPrecision;
  const lines: string[] = [
    '# Gate precision (proven-finding precision on the EG-viable slice)',
    '',
    'The wired proof tier (test-tamper, mock-mutation, no-op-fix, type-suppression,',
    'fake-refactor) run across the EG-viable slice of the outcome-labeled real',
    'corpus, scored against the outcome labels. A proof fires a block only when its',
    'per-instance controls are all green, so a firing is a self-certifying claim',
    'about one PR, not a detector opinion.',
    '',
    '## Headline',
    '',
    `- Slice: ${r.coverage.sliceSize} EG-viable PRs (\`benchmarks/real-corpus/eg-viability.json\`).`,
    `- Proof tier ran on ${r.coverage.proofTierRan}/${r.coverage.sliceSize}; provisioned ${r.coverage.provisioned}.`,
    `- Proven block triggers (n): **${p.n}** (TP ${p.truePositive}, FP ${p.falsePositive}).`,
    p.precision === null
      ? `- Proven-finding precision: **n=0, undefined**. ${p.note}`
      : `- Proven-finding precision: **${p.precision.toFixed(3)}**` +
        (p.wilson95 !== null
          ? ` (Wilson 95% [${p.wilson95.lower.toFixed(3)}, ${p.wilson95.upper.toFixed(3)}], n=${p.n}).`
          : `, n=${p.n}.`),
    '',
  ];
  if (r.coverage.skippedByCap.length > 0) {
    lines.push(
      `## Skipped by the ${r.capMinutes}-minute cap`,
      '',
      ...r.coverage.skippedByCap.map((id: string) => `- ${id}`),
      '',
    );
  }
  lines.push(
    '## Per-PR verdicts',
    '',
    '| PR | outcome | status | proven | note |',
    '| --- | --- | --- | --- | --- |',
    ...r.perPr.map(
      (v) =>
        `| ${v.id} | ${v.outcome} | ${v.status} | ${v.provenTriggers.length} | ${v.note.replace(/\|/g, '/').slice(0, 120)} |`,
    ),
    '',
    '## How to reproduce',
    '',
    '```sh',
    'npm run build && node dist/scripts/gate/run-gate-precision.js',
    '```',
    '',
    'A confirmed finding on an outcome-clean PR is a stop-the-line defect: its per-PR',
    'row carries the head SHA and the proof funnel so the control-vs-label diagnosis',
    'can run before the number is trusted.',
    '',
  );
  return lines.join('\n');
}

// Type helper so renderReport's parameter is inferred from the literal above.
function buildResultType() {
  return null as unknown as {
    capMinutes: number;
    provenFindingPrecision: {
      n: number;
      truePositive: number;
      falsePositive: number;
      precision: number | null;
      wilson95: { lower: number; upper: number } | null;
      note: string;
    };
    coverage: { sliceSize: number; proofTierRan: number; provisioned: number; skippedByCap: string[] };
    perPr: PerPrVerdict[];
  };
}

main().catch((err) => {
  log.error(`gate-precision run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});

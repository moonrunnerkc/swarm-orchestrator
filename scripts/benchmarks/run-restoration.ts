// Restoration benchmark. Two layers, kept strictly separate because they
// measure different things:
//
//   Deterministic layer (static, no execution): how often the proof
//   engine's identification step, extractTestHunkPatch, lifts the tampered
//   test hunks out of a labeled corpus diff. This is patch-extraction
//   recall, NOT proof-engine recall: a restoration proof additionally
//   requires four executed test runs and three green controls, none of
//   which happen here. A clean case that produces a non-null patch here is
//   NOT a false positive; it only means the case would reach execution,
//   where the restored test passing refutes the finding. A static clean
//   case cannot produce a false proof by construction: 'proven' requires
//   two executed failing restored runs plus two passing executed controls,
//   and the static layer executes nothing. Run through the record path
//   without a sandbox, every static case lands in not-proven:no-workspace.
//
//   Executed layer (live, real workspaces): the full proof engine driven
//   through runExecutionGrounded against the regression corpus (merged PRs
//   later proven bad by a revert or fix-PR) and the clean v2 corpus (merged
//   PRs with no such proof). The funnel is computed from committed data
//   first and printed before anything executes; only funnel-surviving PRs
//   are run. Each run persists its restoration-proof.json envelope next to
//   the PR's committed execution-grounded result.json. The exit bar is
//   exactly zero 'proven' verdicts on clean-corpus PRs.
//
// Outputs:
//   benchmarks/results/restoration-results.json
//   benchmarks/results/RESTORATION-REPORT.md
//   benchmarks/regression-corpus/execution-grounded/<slug>/<pr>/restoration-proof.json
//   benchmarks/real-prs/execution-grounded-clean/<slug>/<pr>/restoration-proof.json
//
// Usage: node dist/scripts/benchmarks/run-restoration.js [--no-live] [--no-static]
//
// Env (live layer only):
//   SWARM_EG_NODE_BIN            required: bin dir of the Node 22 the
//                                workspace suites run under
//   SWARM_EG_INSTALL_TIMEOUT_MS  per-workspace install cap (default 12 min)
//   SWARM_EG_WALLCLOCK_MS        per-PR wall-clock cap (default 30 min)

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { isTestFile } from '../../src/audit/cheat-detector/diff-walker';
import { runExecutionGrounded } from '../../src/audit/execution-grounded';
import {
  extractTestHunkPatch,
  RESTORATION_CATEGORIES,
  type RestorationProofRecord,
} from '../../src/audit/execution-grounded/test-restoration';
import type { MutationRecipe } from '../../src/audit/execution-grounded/mutation-check';
import type { CheatCategory, Finding, Severity } from '../../src/audit/types';
import { getLogger } from '../../src/logger';
import { realPrsDir, regressionDir, repoSlug } from '../real-prs/lib/paths';
import { loadOracleCorpus, loadSyntheticCorpus, repoRoot } from './lib/corpora';

const log = getLogger('benchmarks:restoration');

const CATEGORIES = new Set<CheatCategory>(RESTORATION_CATEGORIES);

// ---------------------------------------------------------------------------
// Deterministic layer: oracle corpus.
//
// "Targets the labeled hunk" means all three of: the extracted patch is
// non-null, parsing it yields a chunk at the label's hunkIndex, and that
// chunk's new-side start line equals the label's startLine. The injector
// records hunkIndex as the injected hunk's 0-based index among the file's
// hunks and startLine as its new-side start (a 100000+ line number for
// appended hunks, so a collision with a real hunk is implausible); the
// equality therefore pins the exact injected hunk, not just the file.
// ---------------------------------------------------------------------------

type OracleFailure = 'null-patch' | 'hunk-index-out-of-range' | 'hunk-start-mismatch';

interface OracleMiss {
  id: string;
  file: string;
  hunkIndex: number;
  failure: OracleFailure;
  classification: string;
}

interface OracleRow {
  category: string;
  cases: number;
  extractedAndTargeted: number;
  recall: number;
}

interface OracleLayerResult {
  definitionOfTargets: string;
  rows: OracleRow[];
  misses: OracleMiss[];
  unexplainedMisses: number;
}

const NOT_A_TEST_FILE_LIMIT =
  'evidence limit, correct behavior: the injected hunk lives in a source file, not a test ' +
  'file, so there are no tampered test hunks to restore and the engine correctly extracts ' +
  'nothing (a restoration would revert production code, which is not what the proof reverts)';

function classifyOracleMiss(file: string): string {
  if (!isTestFile(file)) return NOT_A_TEST_FILE_LIMIT;
  return 'UNEXPLAINED';
}

function scoreOracle(root: string): OracleLayerResult {
  const cases = loadOracleCorpus(root).filter((c) => CATEGORIES.has(c.category as CheatCategory));
  const byCategory = new Map<string, { cases: number; ok: number }>();
  const misses: OracleMiss[] = [];
  for (const c of cases) {
    const bucket = byCategory.get(c.category) ?? { cases: 0, ok: 0 };
    bucket.cases += 1;
    const patch = extractTestHunkPatch(c.brokenDiff, c.label.file);
    let failure: OracleFailure | null = null;
    if (patch === null) {
      failure = 'null-patch';
    } else {
      const chunk = parseDiff(patch)[0]?.chunks[c.label.hunkIndex];
      if (chunk === undefined) failure = 'hunk-index-out-of-range';
      else if (chunk.newStart !== c.label.startLine) failure = 'hunk-start-mismatch';
    }
    if (failure === null) {
      bucket.ok += 1;
    } else {
      misses.push({
        id: c.prId,
        file: c.label.file,
        hunkIndex: c.label.hunkIndex,
        failure,
        classification: classifyOracleMiss(c.label.file),
      });
    }
    byCategory.set(c.category, bucket);
  }
  const rows: OracleRow[] = [...byCategory.entries()]
    .map(([category, b]) => ({
      category,
      cases: b.cases,
      extractedAndTargeted: b.ok,
      recall: b.cases > 0 ? b.ok / b.cases : 0,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    definitionOfTargets:
      'non-null patch whose parsed chunk at the label hunkIndex starts at the label startLine',
    rows,
    misses,
    unexplainedMisses: misses.filter((m) => m.classification === 'UNEXPLAINED').length,
  };
}

// ---------------------------------------------------------------------------
// Deterministic layer: synthetic corpus.
//
// The synthetic corpus labels each case with a category but not with a
// finding file, so the finding files are derived exactly the way the live
// pipeline derives them: the structural detector battery (default detector
// set, no judge) runs over the diff, and the qualifying findings are the
// block-severity ones in the case's category, the same filter
// runExecutionGrounded applies. A broken case counts as identified when at
// least one qualifying finding's file yields a non-null test-hunk patch.
// ---------------------------------------------------------------------------

interface SyntheticBrokenMiss {
  id: string;
  classification: string;
  findingFiles: string[];
}

interface SyntheticBrokenRow {
  category: string;
  cases: number;
  withAnySeverityFinding: number;
  withQualifyingBlockFinding: number;
  identified: number;
}

interface SyntheticLayerResult {
  broken: { rows: SyntheticBrokenRow[]; misses: SyntheticBrokenMiss[]; unexplainedMisses: number };
  clean: {
    totalCases: number;
    withQualifyingBlockFinding: number;
    reachingWouldExecute: number;
    anyChangedTestFileExtractable: number;
    note: string;
  };
}

function qualifying(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'block' && CATEGORIES.has(f.category));
}

/** Every real path the diff changes (new side preferred, deletions keep the
 *  old side), for the clean upper-bound probe. */
function changedPaths(diff: string): string[] {
  const out: string[] = [];
  for (const f of parseDiff(diff)) {
    const p = f.to !== undefined && f.to !== '/dev/null' ? f.to : f.from;
    if (p !== undefined && p !== '/dev/null') out.push(p);
  }
  return out;
}

async function scoreSynthetic(root: string): Promise<SyntheticLayerResult> {
  const corpus = loadSyntheticCorpus(root);
  const rowMap = new Map<string, SyntheticBrokenRow>();
  const misses: SyntheticBrokenMiss[] = [];
  let cleanQualifying = 0;
  let cleanWouldExecute = 0;
  let cleanUpperBound = 0;
  for (const c of corpus.cases) {
    if (CATEGORIES.has(c.category)) {
      const row = rowMap.get(c.category) ?? {
        category: c.category,
        cases: 0,
        withAnySeverityFinding: 0,
        withQualifyingBlockFinding: 0,
        identified: 0,
      };
      row.cases += 1;
      const result = await runCheatDetectors({ unifiedDiff: c.brokenDiff, repoRoot: root });
      const sameCategory = result.findings.filter((f) => f.category === c.category);
      if (sameCategory.length > 0) row.withAnySeverityFinding += 1;
      const qual = qualifying(sameCategory);
      const files = [...new Set(qual.map((f) => f.location.file))];
      const extracted = files.filter((f) => extractTestHunkPatch(c.brokenDiff, f) !== null);
      if (qual.length > 0) row.withQualifyingBlockFinding += 1;
      if (extracted.length > 0) {
        row.identified += 1;
      } else {
        misses.push({ id: c.id, findingFiles: files, classification: classifySyntheticMiss(sameCategory, qual, files) });
      }
      rowMap.set(c.category, row);
    }
    // Clean side: every paired clean diff, identified through the identical
    // detector-then-extract step over all three categories.
    const cleanResult = await runCheatDetectors({ unifiedDiff: c.cleanDiff, repoRoot: root });
    const cleanQual = qualifying(cleanResult.findings);
    if (cleanQual.length > 0) {
      cleanQualifying += 1;
      const files = [...new Set(cleanQual.map((f) => f.location.file))];
      if (files.some((f) => extractTestHunkPatch(c.cleanDiff, f) !== null)) cleanWouldExecute += 1;
    }
    // Upper bound: treat every changed file as a hypothetical finding file.
    // This over-counts on purpose (no detector fired on these diffs); it
    // bounds how many clean cases COULD reach execution if some future
    // detector flagged any of their test files.
    if (changedPaths(c.cleanDiff).some((p) => extractTestHunkPatch(c.cleanDiff, p) !== null)) {
      cleanUpperBound += 1;
    }
  }
  const rows = [...rowMap.values()].sort((a, b) => a.category.localeCompare(b.category));
  return {
    broken: {
      rows,
      misses,
      unexplainedMisses: misses.filter((m) => m.classification === 'UNEXPLAINED').length,
    },
    clean: {
      totalCases: corpus.cases.length,
      withQualifyingBlockFinding: cleanQualifying,
      reachingWouldExecute: cleanWouldExecute,
      anyChangedTestFileExtractable: cleanUpperBound,
      note:
        'reaching would-execute is not a false positive: execution arbitrates, and a clean ' +
        'restored test passing yields refuted. No static case can be proven by construction ' +
        '(proven requires two executed failing restored runs plus two passing executed ' +
        'controls); without a sandbox the record path reports not-proven:no-workspace.',
    },
  };
}

function classifySyntheticMiss(
  anySeverity: readonly Finding[],
  qual: readonly Finding[],
  files: readonly string[],
): string {
  if (anySeverity.length === 0) {
    return (
      'no detector finding at any severity: a detector-recall miss, measured by ' +
      'npm run benchmarks:oracle, not an extraction failure'
    );
  }
  if (qual.length === 0) {
    return (
      'evidence limit, correct behavior: the detector publishes this category at warn ' +
      'severity by default, and the qualifying gate is block-only, so the case never ' +
      'reaches restoration in the live pipeline either'
    );
  }
  if (files.every((f) => !isTestFile(f))) {
    return NOT_A_TEST_FILE_LIMIT;
  }
  return 'UNEXPLAINED';
}

// ---------------------------------------------------------------------------
// Executed layer.
// ---------------------------------------------------------------------------

interface SourcePr {
  repo: string;
  prNumber: number;
  headSha: string;
  diffPath: string;
}

interface RawStructuralFinding {
  category?: string;
  severity?: string;
  subjectPath?: string;
  lineRange?: { start: number; end: number };
  evidence?: string;
  message?: string;
}

interface CorpusSpec {
  name: 'regression' | 'clean';
  baseDir: string;
  sourcesFile: string;
  auditDir: string;
  egDir: string;
}

interface FunnelPr {
  pr: SourcePr;
  slug: string;
  corpus: 'regression' | 'clean';
  findings: Finding[];
  qualifyingCount: number;
  hasEgResult: boolean;
  workspaceViable: boolean;
  provisionSkips: string[];
}

interface FunnelCounts {
  totalPrs: number;
  hasEgResult: number;
  workspaceViable: number;
  hasQualifyingBlockFinding: number;
  surviving: number;
  qualifyingButNotViable: string[];
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toSeverity(raw: string | undefined): Severity {
  return raw === 'block' || raw === 'info' ? raw : 'warn';
}

/** Reconstruct Finding objects from a committed audit-result file (the same
 *  persisted `post` shape scripts/gate/run-trigger-calibration.ts replays). */
function loadStructural(file: string): Finding[] {
  const raw = readJson<{ post?: RawStructuralFinding[] }>(file);
  if (raw === null || !Array.isArray(raw.post)) return [];
  const out: Finding[] = [];
  for (const f of raw.post) {
    if (f.category === undefined || f.subjectPath === undefined) continue;
    const line = f.lineRange?.start ?? 1;
    out.push({
      category: f.category as CheatCategory,
      severity: toSeverity(f.severity),
      message: f.message ?? '',
      location: { file: f.subjectPath, line, endLine: f.lineRange?.end ?? line },
      evidence: f.evidence ?? '',
    });
  }
  return out;
}

function buildFunnel(spec: CorpusSpec): { counts: FunnelCounts; prs: FunnelPr[] } {
  const parsed = readJson<{ prs?: SourcePr[] }>(spec.sourcesFile);
  const prs = parsed?.prs ?? [];
  const rows: FunnelPr[] = [];
  for (const pr of prs) {
    const slug = repoSlug(pr.repo);
    const eg = readJson<{ skipped?: string[] }>(
      path.join(spec.egDir, slug, String(pr.prNumber), 'result.json'),
    );
    const provisionSkips = (eg?.skipped ?? []).filter((s) => s.startsWith('provision'));
    const findings = loadStructural(path.join(spec.auditDir, slug, `${pr.prNumber}.json`));
    rows.push({
      pr,
      slug,
      corpus: spec.name,
      findings,
      qualifyingCount: qualifying(findings).length,
      hasEgResult: eg !== null,
      workspaceViable: eg !== null && provisionSkips.length === 0,
      provisionSkips,
    });
  }
  const survivors = rows.filter((r) => r.workspaceViable && r.qualifyingCount > 0);
  const counts: FunnelCounts = {
    totalPrs: rows.length,
    hasEgResult: rows.filter((r) => r.hasEgResult).length,
    workspaceViable: rows.filter((r) => r.workspaceViable).length,
    hasQualifyingBlockFinding: rows.filter((r) => r.qualifyingCount > 0).length,
    surviving: survivors.length,
    qualifyingButNotViable: rows
      .filter((r) => r.qualifyingCount > 0 && !r.workspaceViable)
      .map((r) => `${r.pr.repo}#${r.pr.prNumber}`),
  };
  return { counts, prs: rows };
}

/** A proof record trimmed for the results file; the full record (including
 *  the reverted hunk patch) lives in the PR's committed envelope. */
type TrimmedRecord = Omit<RestorationProofRecord, 'revertedHunkPatch' | 'schemaVersion'>;

interface ExecutedPrResult {
  corpus: 'regression' | 'clean';
  pr: string;
  headSha: string;
  qualifyingFindings: number;
  wallClockMs: number;
  skipped: string[];
  records: TrimmedRecord[];
  harnessError?: string;
}

function trimRecord(r: RestorationProofRecord): TrimmedRecord {
  const { schemaVersion: _schemaVersion, revertedHunkPatch: _patch, ...rest } = r;
  return rest;
}

function loadRecipe(root: string, slug: string): MutationRecipe | undefined {
  const f = path.join(regressionDir(root), 'mutation-recipes', `${slug}.json`);
  if (!fs.existsSync(f)) return undefined;
  return JSON.parse(fs.readFileSync(f, 'utf8')) as MutationRecipe;
}

async function executeFunnelPr(
  root: string,
  spec: CorpusSpec,
  row: FunnelPr,
  scratch: string,
): Promise<ExecutedPrResult> {
  const prRef = `${row.pr.repo}#${row.pr.prNumber}`;
  const diffFile = path.join(spec.baseDir, row.pr.diffPath);
  const outDir = path.join(spec.egDir, row.slug, String(row.pr.prNumber));
  const base: ExecutedPrResult = {
    corpus: spec.name,
    pr: prRef,
    headSha: row.pr.headSha,
    qualifyingFindings: row.qualifyingCount,
    wallClockMs: 0,
    skipped: [],
    records: [],
  };
  if (!fs.existsSync(diffFile)) {
    base.harnessError = `stored diff missing: ${diffFile}`;
    return base;
  }
  const recipe = loadRecipe(root, row.slug);
  const installTimeoutMs = Number(process.env.SWARM_EG_INSTALL_TIMEOUT_MS ?? 12 * 60 * 1000);
  const wallClockMs = Number(process.env.SWARM_EG_WALLCLOCK_MS ?? 30 * 60 * 1000);
  log.info(`live: ${spec.name} ${prRef} (${row.qualifyingCount} qualifying finding(s))`);
  const started = Date.now();
  try {
    // Only the restoration phase runs: mutation, coverage, and issue-repro
    // are disabled so the run is provisioning plus roughly four test runs
    // per qualifying finding.
    const outcome = await runExecutionGrounded({
      prDiff: fs.readFileSync(diffFile, 'utf8'),
      repo: row.pr.repo,
      prNumber: row.pr.prNumber,
      prHeadSha: row.pr.headSha,
      config: {
        enabled: true,
        mutation: false,
        issueRepro: false,
        coverage: false,
        maxWallClockPerPrMs: wallClockMs,
        runner: 'host',
        corroborateStructural: false,
      },
      baseDir: scratch,
      cacheDir: path.join(scratch, '.pm-cache'),
      evidenceDir: outDir,
      installTimeoutMs,
      runBuild: true,
      structuralFindings: row.findings,
      ...(recipe !== undefined ? { mutationRecipe: recipe } : {}),
    });
    base.wallClockMs = Date.now() - started;
    base.skipped = outcome.skipped;
    base.records = outcome.restorations.map(trimRecord);
  } catch (err) {
    // runExecutionGrounded treats provisioning and per-check failures as
    // skips, so anything that still lands here is a harness bug to
    // root-cause, never silently absorbed into a verdict count.
    base.wallClockMs = Date.now() - started;
    base.harnessError = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(`live run failed for ${prRef}: ${base.harnessError}`);
  }
  for (const r of base.records) {
    log.info(`  ${prRef} ${r.category} ${r.findingFile}: ${r.verdict}`);
  }
  return base;
}

interface ExecutedLayerResult {
  funnel: { regression: FunnelCounts; clean: FunnelCounts };
  perPr: ExecutedPrResult[];
  verdictCounts: Record<string, number>;
  executedFalseProofsOnClean: number;
  provenOnRegression: number;
  harnessErrors: number;
}

async function runExecutedLayer(root: string): Promise<ExecutedLayerResult> {
  const specs: CorpusSpec[] = [
    {
      name: 'regression',
      baseDir: regressionDir(root),
      sourcesFile: path.join(regressionDir(root), 'sources.json'),
      auditDir: path.join(regressionDir(root), 'audit-results'),
      egDir: path.join(regressionDir(root), 'execution-grounded'),
    },
    {
      name: 'clean',
      baseDir: realPrsDir(root),
      sourcesFile: path.join(realPrsDir(root), 'sources-v2.json'),
      auditDir: path.join(realPrsDir(root), 'audit-results-v2'),
      egDir: path.join(realPrsDir(root), 'execution-grounded-clean'),
    },
  ];
  const funnels = specs.map((s) => ({ spec: s, ...buildFunnel(s) }));
  for (const f of funnels) {
    const c = f.counts;
    log.info(
      `funnel[${f.spec.name}]: ${c.totalPrs} PRs -> ${c.hasEgResult} with EG result -> ` +
        `${c.workspaceViable} workspace-viable -> ${c.hasQualifyingBlockFinding} with a ` +
        `qualifying block finding -> ${c.surviving} surviving (executed live)`,
    );
    if (c.qualifyingButNotViable.length > 0) {
      log.info(
        `funnel[${f.spec.name}]: qualifying but not workspace-viable (not executed): ` +
          c.qualifyingButNotViable.join(', '),
      );
    }
  }

  const scratch = path.join(os.tmpdir(), 'swarm-restoration-bench');
  fs.mkdirSync(scratch, { recursive: true });
  const perPr: ExecutedPrResult[] = [];
  for (const f of funnels) {
    for (const row of f.prs) {
      if (!(row.workspaceViable && row.qualifyingCount > 0)) continue;
      perPr.push(await executeFunnelPr(root, f.spec, row, scratch));
    }
  }

  const verdictCounts: Record<string, number> = {};
  let falseProofs = 0;
  let provenOnRegression = 0;
  for (const pr of perPr) {
    for (const r of pr.records) {
      verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
      if (r.verdict === 'proven') {
        if (pr.corpus === 'clean') {
          falseProofs += 1;
          log.error(
            `EXECUTED FALSE PROOF on clean PR ${pr.pr} (${r.category} ${r.findingFile}); ` +
              'the exit bar is exactly zero of these',
          );
        } else {
          provenOnRegression += 1;
        }
      }
    }
  }
  const regressionFunnel = funnels.find((f) => f.spec.name === 'regression');
  const cleanFunnel = funnels.find((f) => f.spec.name === 'clean');
  if (regressionFunnel === undefined || cleanFunnel === undefined) {
    throw new Error('run-restoration: corpus specs must include regression and clean');
  }
  return {
    funnel: { regression: regressionFunnel.counts, clean: cleanFunnel.counts },
    perPr,
    verdictCounts,
    executedFalseProofsOnClean: falseProofs,
    provenOnRegression,
    harnessErrors: perPr.filter((p) => p.harnessError !== undefined).length,
  };
}

// ---------------------------------------------------------------------------
// Results file and report.
// ---------------------------------------------------------------------------

interface RestorationResults {
  header: { tool: string; generatedAt: string; note: string };
  deterministic: {
    oracle: OracleLayerResult;
    synthetic: SyntheticLayerResult;
  } | null;
  executed: ExecutedLayerResult | null;
}

function renderReport(results: RestorationResults): string {
  const lines: string[] = [];
  const det = results.deterministic;
  const exec = results.executed;
  lines.push('# Restoration benchmark');
  lines.push('');
  lines.push(
    'Validation evidence for the differential test-restoration proof engine ' +
      '(`src/audit/execution-grounded/test-restoration.ts`). Two layers, measuring different ' +
      'things; do not read either number as the other.',
  );
  lines.push('');
  lines.push(`Generated ${results.header.generatedAt} by \`scripts/benchmarks/run-restoration.ts\`.`);
  lines.push('');
  lines.push('## Layer 1: deterministic identification (static, nothing executes)');
  lines.push('');
  lines.push(
    'This layer measures one step only: how often `extractTestHunkPatch` lifts the tampered ' +
      'test hunks out of a labeled diff. It is patch-extraction recall, not proof-engine ' +
      'recall. A restoration proof additionally requires four executed test runs (the ' +
      'tampered-suite control, two restored runs, the base-checkout control) that this layer ' +
      'never performs.',
  );
  lines.push('');
  if (det !== null) {
    lines.push('### Oracle corpus (sha256-pinned injected defects)');
    lines.push('');
    lines.push(
      '"Targets the labeled hunk" means: ' +
        det.oracle.definitionOfTargets +
        '. The injector pins `hunkIndex` (0-based, within the file) and `startLine` ' +
        '(new side), so the equality identifies the exact injected hunk.',
    );
    lines.push('');
    lines.push('| category | cases | extracted and targeted | recall |');
    lines.push('|---|---|---|---|');
    for (const r of det.oracle.rows) {
      lines.push(
        `| ${r.category} | ${r.cases} | ${r.extractedAndTargeted} | ${r.recall.toFixed(3)} |`,
      );
    }
    lines.push('');
    const missGroups = new Map<string, OracleMiss[]>();
    for (const m of det.oracle.misses) {
      const list = missGroups.get(m.classification) ?? [];
      list.push(m);
      missGroups.set(m.classification, list);
    }
    if (det.oracle.misses.length > 0) {
      lines.push('Every miss root-caused:');
      lines.push('');
      for (const [classification, group] of missGroups) {
        lines.push(
          `- ${group.length} case(s): ${classification}. ` +
            `Cases: ${group.map((m) => `\`${m.id}\` (${m.file})`).join(', ')}.`,
        );
      }
      lines.push('');
    }
    lines.push('### Synthetic corpus, broken side');
    lines.push('');
    lines.push(
      'Synthetic cases carry a category label but no finding file, so finding files are ' +
        'derived the way the live pipeline derives them: the structural detector battery ' +
        '(default set, no judge) runs over the diff and the qualifying findings are the ' +
        'block-severity ones in the labeled category, the same filter `runExecutionGrounded` ' +
        'applies. A case is identified when at least one qualifying finding file yields a ' +
        'non-null test-hunk patch.',
    );
    lines.push('');
    lines.push(
      '| category | cases | any-severity finding | qualifying block finding | identified |',
    );
    lines.push('|---|---|---|---|---|');
    for (const r of det.synthetic.broken.rows) {
      lines.push(
        `| ${r.category} | ${r.cases} | ${r.withAnySeverityFinding} | ` +
          `${r.withQualifyingBlockFinding} | ${r.identified} |`,
      );
    }
    lines.push('');
    const synMissGroups = new Map<string, number>();
    for (const m of det.synthetic.broken.misses) {
      synMissGroups.set(m.classification, (synMissGroups.get(m.classification) ?? 0) + 1);
    }
    if (det.synthetic.broken.misses.length > 0) {
      lines.push('Every miss root-caused:');
      lines.push('');
      for (const [classification, count] of synMissGroups) {
        lines.push(`- ${count} case(s): ${classification}.`);
      }
      lines.push('');
    }
    lines.push('### Clean cases (static)');
    lines.push('');
    lines.push(
      `Of ${det.synthetic.clean.totalCases} synthetic clean cases, ` +
        `${det.synthetic.clean.withQualifyingBlockFinding} produced a qualifying block ` +
        `finding in the three restoration categories and ` +
        `${det.synthetic.clean.reachingWouldExecute} reached the would-execute stage (a ` +
        'non-null test-hunk patch for a finding-shaped input). The oracle corpus has no ' +
        'committed clean side; the synthetic clean side covers this measurement.',
    );
    lines.push('');
    lines.push(
      `As an upper bound, ${det.synthetic.clean.anyChangedTestFileExtractable} of the ` +
        `${det.synthetic.clean.totalCases} clean diffs touch at least one test file whose ` +
        'hunks extract to a non-null patch. That number deliberately over-counts: it treats ' +
        'every changed file as a hypothetical finding file with no detector involved. It ' +
        'bounds how many clean cases could reach execution if a future detector flagged any ' +
        'of their test files.',
    );
    lines.push('');
    lines.push(
      'A clean case reaching would-execute is not a false positive. Execution arbitrates: ' +
        'restoring an honestly-changed test and watching it pass yields `refuted`, which ' +
        'demotes the finding. A static clean case cannot produce a false proof by ' +
        'construction, because `proven` requires two executed failing restored runs plus two ' +
        'passing executed controls and the static layer executes nothing. Run through the ' +
        'record path without a sandbox, every static case lands in `not-proven:no-workspace`.',
    );
    lines.push('');
  } else {
    lines.push('Not run in this invocation (`--no-static`).');
    lines.push('');
  }

  lines.push('## Layer 2: executed proofs (live workspaces, real test runs)');
  lines.push('');
  if (exec !== null) {
    lines.push(
      'The full proof engine, driven through `runExecutionGrounded` with mutation, coverage, ' +
        'and issue-repro disabled, against every funnel-surviving PR. The funnel is computed ' +
        'from committed data before anything executes.',
    );
    lines.push('');
    lines.push('### Funnel');
    lines.push('');
    lines.push(
      '| corpus | PRs | has EG result | workspace viable | qualifying block finding | executed live |',
    );
    lines.push('|---|---|---|---|---|---|');
    for (const [name, c] of [
      ['regression', exec.funnel.regression],
      ['clean', exec.funnel.clean],
    ] as const) {
      lines.push(
        `| ${name} | ${c.totalPrs} | ${c.hasEgResult} | ${c.workspaceViable} | ` +
          `${c.hasQualifyingBlockFinding} | ${c.surviving} |`,
      );
    }
    lines.push('');
    for (const [name, c] of [
      ['regression', exec.funnel.regression],
      ['clean', exec.funnel.clean],
    ] as const) {
      if (c.qualifyingButNotViable.length > 0) {
        lines.push(
          `Qualifying but not workspace-viable in the ${name} corpus (provisioning failed in ` +
            `the committed EG run, so restoration cannot execute there): ` +
            c.qualifyingButNotViable.map((p) => `\`${p}\``).join(', ') +
            '.',
        );
        lines.push('');
      }
    }
    lines.push(
      '"Workspace viable" means the PR\'s committed execution-grounded `result.json` exists ' +
        'and records no provisioning skip. "Qualifying block finding" means the committed ' +
        'audit result carries at least one block-severity structural finding in ' +
        '`assertion-strip`, `test-relaxation`, or `coverage-erosion`, the exact filter the ' +
        'live layer applies.',
    );
    lines.push('');
    lines.push('### Executed verdicts');
    lines.push('');
    lines.push('| verdict | count |');
    lines.push('|---|---|');
    for (const [verdict, count] of Object.entries(exec.verdictCounts).sort()) {
      lines.push(`| ${verdict} | ${count} |`);
    }
    lines.push('');
    lines.push('### Per-PR outcomes');
    lines.push('');
    lines.push('| corpus | PR | qualifying findings | verdicts | wall clock |');
    lines.push('|---|---|---|---|---|');
    for (const pr of exec.perPr) {
      const verdicts = new Map<string, number>();
      for (const r of pr.records) verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + 1);
      const summary =
        pr.harnessError !== undefined
          ? 'harness error (see restoration-results.json)'
          : [...verdicts.entries()].map(([v, n]) => `${v} x${n}`).join(', ');
      lines.push(
        `| ${pr.corpus} | ${pr.pr} | ${pr.qualifyingFindings} | ${summary} | ` +
          `${(pr.wallClockMs / 1000).toFixed(0)}s |`,
      );
    }
    lines.push('');
    lines.push('### Executed false proofs on clean PRs');
    lines.push('');
    lines.push(
      `Count: ${exec.executedFalseProofsOnClean}. This is an executed number from the live ` +
        'runs above, not an assumption. The exit bar for this engine is exactly zero; a ' +
        'single `proven` verdict on a clean-corpus PR blocks the engine from gating until ' +
        'root-caused.',
    );
    lines.push('');
  } else {
    lines.push('Not run in this invocation (`--no-live`).');
    lines.push('');
  }
  lines.push('## Reproduce');
  lines.push('');
  lines.push('```bash');
  lines.push('# both layers (live layer provisions real workspaces; takes a while)');
  lines.push('SWARM_EG_NODE_BIN=/opt/homebrew/opt/node@22/bin npm run benchmarks:restoration');
  lines.push('');
  lines.push('# deterministic layer only (no network, no execution, byte-identical numbers)');
  lines.push('npm run benchmarks:restoration -- --no-live');
  lines.push('```');
  lines.push('');
  lines.push(
    'The deterministic layer replays from `benchmarks/oracle-corpus/` and ' +
      '`benchmarks/falsification-corpus/v10-synthetic-corpus/`. The executed layer replays ' +
      'its funnel from the committed audit results and execution-grounded results; the live ' +
      'verdicts re-execute real test suites and land in the per-PR ' +
      '`restoration-proof.json` envelopes under ' +
      '`benchmarks/regression-corpus/execution-grounded/` and ' +
      '`benchmarks/real-prs/execution-grounded-clean/`.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const runStatic = !argv.includes('--no-static');
  const runLive = !argv.includes('--no-live');
  const root = repoRoot();

  if (runLive && (process.env.SWARM_EG_NODE_BIN ?? '').length === 0) {
    process.stderr.write(
      'run-restoration: SWARM_EG_NODE_BIN must point at a Node 22 bin directory for the live ' +
        'layer (the sandboxed suites misbehave on newer Nodes). Set it, or pass --no-live.\n',
    );
    process.exitCode = 1;
    return;
  }

  let deterministic: RestorationResults['deterministic'] = null;
  if (runStatic) {
    log.info('deterministic layer: oracle corpus');
    const oracle = scoreOracle(root);
    log.info('deterministic layer: synthetic corpus (detector battery over every case)');
    const synthetic = await scoreSynthetic(root);
    deterministic = { oracle, synthetic };
    const unexplained = oracle.unexplainedMisses + synthetic.broken.unexplainedMisses;
    if (unexplained > 0) {
      // An unexplained miss is either an engine bug (fix it, with a failing
      // test first) or a gap in this scorer's classifier; neither may ship
      // inside a green benchmark run.
      log.error(`deterministic layer: ${unexplained} UNEXPLAINED miss(es); failing the run`);
      process.exitCode = 1;
    }
  }

  let executed: ExecutedLayerResult | null = null;
  if (runLive) {
    executed = await runExecutedLayer(root);
    if (executed.executedFalseProofsOnClean > 0 || executed.harnessErrors > 0) {
      process.exitCode = 1;
    }
  }

  const results: RestorationResults = {
    header: {
      tool: 'run-restoration',
      generatedAt: new Date().toISOString(),
      note:
        'Layer 1 (deterministic) is patch-extraction recall and replays byte-identical from ' +
        'the committed corpora. Layer 2 (executed) re-runs real test suites in provisioned ' +
        'workspaces; its per-PR proof envelopes are committed next to each result.json.',
    },
    deterministic,
    executed,
  };
  const outDir = path.join(root, 'benchmarks', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'restoration-results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(outDir, 'RESTORATION-REPORT.md'), renderReport(results));

  const oracleSummary = deterministic?.oracle.rows
    .map((r) => `${r.category}:${r.extractedAndTargeted}/${r.cases}`)
    .join(' ');
  const liveSummary =
    executed !== null
      ? `live-verdicts=${JSON.stringify(executed.verdictCounts)} ` +
        `false-proofs-on-clean=${executed.executedFalseProofsOnClean}`
      : 'live-skipped';
  process.stdout.write(`run-restoration: ${oracleSummary ?? 'static-skipped'} ${liveSummary}\n`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-restoration: ${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  });
}

export { main };

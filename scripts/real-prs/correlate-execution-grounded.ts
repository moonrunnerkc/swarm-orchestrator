// Correlation analysis for the execution-grounded evidence run. Reads the
// per-PR result.json files, fetches each regression PR's proof (the revert or
// fix-PR diff), and computes the headline numbers:
//
//   M  regression PRs with a surviving mutation on a line the revert/hotfix
//      later changed (within a documented line-drift tolerance)
//   R  regression PRs whose linked issue repro still fails after the fix
//   C  regression PRs with a changed line no test covers
//   U  regression PRs with at least one correlated execution-grounded finding
//      that the cheat detectors and Semgrep/ESLint did not catch
//   F_clean  mean execution-grounded findings per clean-corpus PR
//
// Cross-commit line numbers drift (the fix PR is a later checkout), so the
// proof correlation allows +/- LINE_TOLERANCE lines and is reported with that
// caveat. The output is benchmarks/regression-corpus/execution-grounded/
// correlation.json.

import * as fs from 'fs';
import * as path from 'path';
import type { ChangedLineRanges } from '../../src/audit/cheat-detector/diff-walker';
import { expandRanges, findingWithinRanges } from '../../src/audit/execution-grounded/corroborate';
import { parseProofUrl, proofChangedRanges, type Proof } from '../../src/audit/gate/revert-proof';
import type { Finding } from '../../src/audit/types';
import { getLogger } from '../../src/logger';
import { repoRoot, regressionDir, differentialDir, repoSlug } from './lib/paths';
import { fetchPrDiff, makeOctokit, parseRepo, resolveGithubToken } from './lib/github';

const log = getLogger('eg-correlate');
const LINE_TOLERANCE = 10;

interface RegressionSource { repo: string; prNumber: number; diffPath: string; proofs?: Proof[] }
interface EgResult {
  corpus: string;
  repo: string;
  prNumber: number;
  findings: Finding[];
  mutationRuns: Array<{ ran: boolean; summary: { survived: number; noCoverage: number } }>;
  coverageRuns: Array<{ ran: boolean; uncoveredCount: number }>;
  repros: Array<{ verdict: string }>;
  skipped: string[];
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function collectResults(base: string): EgResult[] {
  const out: EgResult[] = [];
  if (!fs.existsSync(base)) return out;
  for (const slug of fs.readdirSync(base)) {
    const slugDir = path.join(base, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    for (const prDir of fs.readdirSync(slugDir)) {
      const r = readJson<EgResult>(path.join(slugDir, prDir, 'result.json'));
      if (r !== null) out.push(r);
    }
  }
  return out;
}

/** Other-tool findings (cheat detectors + Semgrep/ESLint) as a per-file set of
 *  lines, so an execution-grounded finding can be deduped against them. */
function otherFindingLines(repo: string, prNumber: number): ChangedLineRanges {
  const slug = repoSlug(repo);
  const ranges: ChangedLineRanges = {};
  const add = (file: string, line: number): void => {
    (ranges[file] ??= []).push({ start: line - LINE_TOLERANCE, end: line + LINE_TOLERANCE });
  };
  // Cheat-detector findings (post-PR side of the audit result).
  const audit = readJson<{ post?: { findings?: Finding[] } }>(
    path.join(regressionDir(), 'audit-results', slug, `${prNumber}.json`),
  );
  for (const f of audit?.post?.findings ?? []) add(f.location.file, f.location.line);
  // Differential: Semgrep + ESLint.
  for (const tool of ['semgrep', 'eslint-security']) {
    const diff = readJson<{ findings?: Array<{ file: string; line: number }> }>(
      path.join(differentialDir(), tool, slug, `${prNumber}.json`),
    );
    for (const f of diff?.findings ?? []) add(f.file, f.line);
  }
  return ranges;
}

interface Octokit { /* opaque */ }

async function proofRanges(
  octokit: Octokit | null,
  src: RegressionSource,
  auditedFiles: Set<string>,
  cacheDir: string,
): Promise<ChangedLineRanges> {
  if (octokit === null) return {};
  const diffs: string[] = [];
  for (const proof of src.proofs ?? []) {
    const ref = parseProofUrl(proof.url);
    if (ref === null) continue;
    const cacheFile = path.join(cacheDir, `${ref.owner}-${ref.repo}-${ref.ref}.diff`);
    if (fs.existsSync(cacheFile)) {
      diffs.push(fs.readFileSync(cacheFile, 'utf8'));
      continue;
    }
    const prNum = Number(ref.ref);
    if (!Number.isFinite(prNum)) continue; // a commit sha, not a pull: skip
    try {
      const diff = await fetchPrDiff(octokit as never, parseRepo(`${ref.owner}/${ref.repo}`), prNum);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, diff);
      diffs.push(diff);
    } catch (err) {
      log.debug(`proof diff fetch failed for ${proof.url}: ${String(err)}`);
    }
  }
  // Only files the audited PR also touched, the same restriction as before.
  return proofChangedRanges(diffs, auditedFiles);
}

async function main(): Promise<void> {
  const root = repoRoot();
  let token: string | null = null;
  try {
    token = resolveGithubToken();
  } catch {
    log.warn('no GitHub token; proof correlation will be empty (cannot fetch fix/revert diffs)');
  }
  const octokit = (token !== null ? makeOctokit(token) : null) as Octokit | null;

  const regression = collectResults(path.join(regressionDir(), 'execution-grounded'));
  const clean = collectResults(path.join(root, 'benchmarks', 'real-prs', 'execution-grounded-clean'));
  const sources = readJson<{ prs: RegressionSource[] }>(path.join(regressionDir(), 'sources.json'))?.prs ?? [];
  const sourceByKey = new Map(sources.map((s) => [`${s.repo}#${s.prNumber}`, s]));
  const proofCache = path.join(regressionDir(), 'proof-diff-cache');

  const perPr: Array<Record<string, unknown>> = [];
  let M = 0;
  let R = 0;
  let C = 0;
  let U = 0;

  for (const result of regression) {
    const src = sourceByKey.get(`${result.repo}#${result.prNumber}`);
    const auditedFiles = new Set(result.findings.map((f) => f.location.file));
    const proof = src !== undefined ? await proofRanges(octokit, src, auditedFiles, proofCache) : {};
    const proofExpanded = expandRanges(proof, LINE_TOLERANCE);

    // Two grades of mutation signal, kept separate for honesty. The strong one
    // (covered-survivor on a discriminating suite) is what no diff-reader and no
    // coverage tool can produce; the weaker one (an uncovered changed line,
    // surfaced via a trivially-surviving mutant) is a coverage-grade fact. M
    // counts only the strong grade on a proof-changed line.
    const coveredSurvivors = result.findings.filter((f) => f.category === 'mutation-survives-on-changed-line');
    const uncoveredSurvivors = result.findings.filter(
      (f) => f.category === 'mutation-survives-on-uncovered-changed-line',
    );
    const coveredHighConf = coveredSurvivors.filter((f) => findingWithinRanges(f, proofExpanded));
    const uncoveredHighConf = uncoveredSurvivors.filter((f) => findingWithinRanges(f, proofExpanded));
    const reproFails = result.findings.filter((f) => f.category === 'issue-repro-still-fails');
    const uncovered = result.findings.filter((f) => f.category === 'uncovered-changed-line');

    const other = otherFindingLines(result.repo, result.prNumber);
    // U is the strong, unique catches: a covered-survivor or a still-failing
    // repro on a proof line that the cheat detectors / Semgrep / ESLint missed.
    const correlated = [...coveredHighConf, ...reproFails];
    const uniqueCorrelated = correlated.filter((f) => !findingWithinRanges(f, other));

    if (coveredHighConf.length > 0) M += 1;
    if (reproFails.length > 0) R += 1;
    if (uncovered.length > 0 || uncoveredHighConf.length > 0) C += 1;
    if (uniqueCorrelated.length > 0) U += 1;

    perPr.push({
      repo: result.repo,
      prNumber: result.prNumber,
      ran: result.mutationRuns.some((r) => r.ran) || result.coverageRuns.some((r) => r.ran),
      coveredSurvivorsOnProof: coveredHighConf.length,
      uncoveredSurvivorsOnProof: uncoveredHighConf.length,
      reproFails: reproFails.length,
      uncovered: uncovered.length,
      uniqueCorrelated: uniqueCorrelated.length,
      proofFiles: Object.keys(proof),
      skipped: result.skipped,
    });
  }

  const cleanEvaluated = clean.filter((r) => r.mutationRuns.some((m) => m.ran) || r.coverageRuns.some((c) => c.ran));
  const cleanFindings = clean.reduce((n, r) => n + r.findings.length, 0);
  // F_clean is the false-alarm burden per *evaluated* clean PR: a PR whose
  // install/provision failed never ran a check and cannot raise a false alarm,
  // so counting it in the denominator would understate the burden. Divide by
  // the PRs where a check actually ran. F_clean_attempted keeps the per-attempt
  // figure for reference.
  const fClean = cleanEvaluated.length > 0 ? cleanFindings / cleanEvaluated.length : 0;
  const fCleanAttempted = clean.length > 0 ? cleanFindings / clean.length : 0;

  const summary = {
    generatedAt: new Date().toISOString(),
    lineTolerance: LINE_TOLERANCE,
    regressionEvaluated: regression.length,
    regressionRan: regression.filter((r) => r.mutationRuns.some((m) => m.ran) || r.coverageRuns.some((c) => c.ran)).length,
    cleanEvaluated: clean.length,
    cleanRan: cleanEvaluated.length,
    cleanFindings,
    headline: { M, R, C, U, F_clean: Number(fClean.toFixed(3)), F_clean_attempted: Number(fCleanAttempted.toFixed(3)) },
    perPr,
  };
  const outFile = path.join(regressionDir(), 'execution-grounded', 'correlation.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  log.info(`correlation: M=${M} R=${R} C=${C} U=${U} F_clean=${fClean.toFixed(3)} -> ${outFile}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exitCode = 1;
});

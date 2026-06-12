// Type-suppression restoration. A counterfactual proof for the structural
// type-suppression detector, which can flag an added `@ts-ignore` /
// `@ts-expect-error` but never confirm that the directive was hiding a real
// type error rather than papering over nothing. The proof removes ONLY the
// added directive in the provisioned head workspace and runs `tsc` scoped to
// the finding's file: if a diagnostic surfaces in that file that the directive
// was suppressing, the suppression shipped a real type error -> proven. If no
// diagnostic surfaces, the directive suppressed nothing -> refuted (demote).
//
// Three per-instance controls, all green before the proof can gate (fail-closed,
// exactly like test-tamper-proven / mock-mutation-proven / no-op-fix-proven):
//   1. directiveRemoved                the added directive line(s) were located
//                                      in the workspace file and reverted
//   2. fileCleanAsSubmitted            tsc reports zero diagnostics in the
//                                      finding's file with the directive in
//                                      place (a file already red as submitted is
//                                      a case CI catches, not concealment)
//   3. diagnosticSurfacesWhenRemoved   with the directive reverted, tsc reports
//                                      at least one diagnostic in the file
//
// The discriminator vs a vacuous suppression is control 3's polarity: a
// suppression over a real error, removed, makes tsc flag the file -> proven; a
// suppression over nothing, removed, changes nothing -> refuted.
//
// Scope decisions (recorded in benchmarks/oracle-corpus/proof-protocols.md):
//   - Only `@ts-ignore` and `@ts-expect-error` are tsc-adjudicable line-scoped
//     directives. `@ts-nocheck` (whole-file) is too broad to localize and
//     `eslint-disable` / `# type: ignore` / `@SuppressWarnings` are not type
//     errors tsc can surface, so each lands on a fail-closed not-proven verdict.
//   - A `.js`/`.jsx` finding file is fail-closed (`non-typescript-file`): tsc
//     only checks it under `checkJs`, which we cannot assume.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { isTestFile } from '../cheat-detector/diff-walker';
import type { DockerContext } from './docker-runner';
import { execBin, execEnv, execFileGuarded, type GuardedRunError } from './exec-env';

const log = getLogger('audit:execution-grounded:type-suppression-restoration');

export type TypeSuppressionVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:non-typescript-file'
  | 'not-proven:not-tsc-checkable'
  | 'not-proven:no-suppression-hunks'
  | 'not-proven:no-tsconfig'
  | 'not-proven:tsc-unavailable'
  | 'not-proven:file-drifted'
  | 'not-proven:already-failing'
  | 'not-proven:patch-apply-failed'
  // Reserved for the execution-grounded caller when no sandbox workspace exists.
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface TypeSuppressionControls {
  /** Control 1: the added directive line(s) were located and reverted. */
  directiveRemoved: boolean | null;
  /** Control 2: tsc reports zero diagnostics in the file as submitted. */
  fileCleanAsSubmitted: boolean | null;
  /** Control 3: with the directive reverted, tsc reports >=1 diagnostic in the file. */
  diagnosticSurfacesWhenRemoved: boolean | null;
}

export interface TypeSuppressionProofRecord {
  schemaVersion: 1;
  verdict: TypeSuppressionVerdict;
  category: 'type-suppression';
  findingFile: string;
  /** The directive label(s) reverted, e.g. `@ts-ignore`. */
  removedDirectives: string[];
  /** The tsc diagnostics that surfaced in the file when the directive was
   *  reverted (the proof). Empty unless proven. */
  surfacedDiagnostics: string[];
  controls: TypeSuppressionControls;
  /** Exact command a human runs in a fresh checkout to see the diagnostic. */
  reproduceCommand: string;
  /** The reverse patch of ONLY the directive line(s) (what was reverted). */
  revertedHunkPatch: string;
  reason?: string;
}

export interface TypeSuppressionRestorationInput {
  finding: { category: 'type-suppression'; file: string };
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  postWorkspacePath: string;
  /** Repo root for tsconfig resolution and tsc cwd (= post workspace). */
  repoRoot: string;
  timeoutMs: number;
  docker?: DockerContext;
}

// Only the two line-scoped TypeScript directives tsc can adjudicate. Ordered
// most-specific first so `@ts-expect-error` is matched before a bare `@ts`.
const TSC_DIRECTIVES: readonly { label: string; re: RegExp }[] = [
  { label: '@ts-expect-error', re: /@ts-expect-error\b/ },
  { label: '@ts-ignore', re: /@ts-ignore\b/ },
];

const TS_EXTENSIONS = /\.(?:m|c)?tsx?$/;

const realPath = (p: string | undefined): string | null =>
  p !== undefined && p !== '/dev/null' ? p : null;

export interface AddedDirective {
  /** New-side line number of the directive in the submitted file. */
  line: number;
  /** The directive label that matched. */
  label: string;
  /** The verbatim added line content (with its `+` stripped). */
  content: string;
}

/**
 * Pure: the tsc-checkable suppression directives the PR added to `findingFile`,
 * by their new-side line number. A directive that appears verbatim
 * (whitespace-normalized) among the deleted lines was only relocated and is
 * skipped, mirroring the structural detector's relocation refuter. Returns []
 * when the PR added no `@ts-ignore` / `@ts-expect-error` to the file.
 */
export function extractAddedDirectives(prDiff: string, findingFile: string): AddedDirective[] {
  const target = parseDiff(prDiff).find(
    (f) => realPath(f.to) === findingFile || realPath(f.from) === findingFile,
  );
  if (target === undefined) return [];
  const deletedNorm = new Set<string>();
  for (const chunk of target.chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'del') deletedNorm.add(change.content.slice(1).replace(/\s+/g, ' ').trim());
    }
  }
  const out: AddedDirective[] = [];
  for (const chunk of target.chunks) {
    for (const change of chunk.changes) {
      if (change.type !== 'add') continue;
      const content = change.content.slice(1);
      const rule = TSC_DIRECTIVES.find((r) => r.re.test(content));
      if (rule === undefined) continue;
      if (deletedNorm.has(content.replace(/\s+/g, ' ').trim())) continue; // relocated
      const line = (change as { ln?: number }).ln;
      if (line === undefined) continue;
      out.push({ line, label: rule.label, content });
    }
  }
  return out;
}

/** Pure: does the file carry any added suppression directive at all (of any
 *  kind), used to distinguish "no suppression hunks" from "a suppression tsc
 *  cannot adjudicate" (eslint-disable, python, java). */
const ANY_SUPPRESSION_RE =
  /@ts-(?:ignore|expect-error|nocheck)\b|\beslint-disable(?:-next-line|-line)?\b|#\s*(?:type:\s*ignore|noqa|pyright:\s*ignore)\b|@SuppressWarnings\s*\(/;

export function fileHasAnyAddedSuppression(prDiff: string, findingFile: string): boolean {
  const target = parseDiff(prDiff).find(
    (f) => realPath(f.to) === findingFile || realPath(f.from) === findingFile,
  );
  if (target === undefined) return false;
  for (const chunk of target.chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'add' && ANY_SUPPRESSION_RE.test(change.content.slice(1))) return true;
    }
  }
  return false;
}

/** Pure: classify from the two diagnostic counts. Fail-closed: the only proven
 *  branch is "clean as submitted, dirty when the directive is gone". */
export function classifyTypeSuppression(c: {
  fileDiagnosticsAsSubmitted: number;
  fileDiagnosticsWhenRemoved: number;
}): { verdict: TypeSuppressionVerdict } {
  if (c.fileDiagnosticsAsSubmitted > 0) {
    return { verdict: 'not-proven:already-failing' };
  }
  if (c.fileDiagnosticsWhenRemoved > 0) {
    return { verdict: 'proven' };
  }
  return { verdict: 'refuted' };
}

/** Find the nearest tsconfig.json walking up from the file's directory to the
 *  repo root. Returns the absolute path, or null when none exists. */
export function findNearestTsconfig(repoRoot: string, relFile: string): string | null {
  let dir = path.dirname(path.resolve(repoRoot, relFile));
  const root = path.resolve(repoRoot);
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (path.resolve(dir) === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const TSC_DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/;

/**
 * Pure: parse `tsc --noEmit --pretty false` output for the diagnostics that
 * land on `absTargetFile`. tsc prints paths relative to its cwd (the repo
 * root here), so each path is resolved against `cwd` and compared to the
 * target's real path. Returns the human-readable diagnostic lines, in order.
 */
export function parseTscDiagnosticsForFile(
  output: string,
  cwd: string,
  absTargetFile: string,
): string[] {
  const targetReal = path.resolve(absTargetFile);
  const out: string[] = [];
  for (const raw of output.split('\n')) {
    const m = TSC_DIAGNOSTIC_RE.exec(raw.trim());
    if (m === null) continue;
    const abs = path.resolve(cwd, m[1]!);
    if (abs === targetReal) out.push(`${m[1]}(${m[2]},${m[3]}): error: ${m[4]}`);
  }
  return out;
}

interface TscRun {
  ok: boolean;
  /** tsc stdout (diagnostics live here under --pretty false). */
  output: string;
  /** Set when tsc could not be invoked at all (missing binary). */
  unavailable: boolean;
  timedOut: boolean;
  detail: string;
}

/** Run `npx tsc --noEmit --pretty false -p <tsconfig>` once. tsc exits non-zero
 *  when diagnostics exist, so a GuardedRunError with a numeric status still
 *  carries the diagnostics on stdout: that is a successful run, not a failure. */
function runTsc(opts: {
  tsconfig: string;
  cwd: string;
  timeoutMs: number;
  docker?: DockerContext;
}): TscRun {
  const args = ['tsc', '--noEmit', '--pretty', 'false', '-p', opts.tsconfig];
  try {
    const output = execFileGuarded(execBin('npx'), args, {
      cwd: opts.cwd,
      env: execEnv(),
      timeoutMs: opts.timeoutMs,
      captureStdout: true,
      maxBuffer: 16 * 1024 * 1024,
      ...(opts.docker !== undefined ? { docker: opts.docker } : {}),
    });
    return { ok: true, output, unavailable: false, timedOut: false, detail: '' };
  } catch (err) {
    const guarded = err as Partial<GuardedRunError>;
    const stdout = typeof guarded.stdout === 'string' ? guarded.stdout : '';
    const stderr = typeof guarded.stderr === 'string' ? guarded.stderr : '';
    const timedOut = guarded.timedOut === true;
    // A numeric exit status means tsc ran and reported (diagnostics on stdout);
    // a null status with no timeout means the spawn itself failed (no tsc).
    if (timedOut) {
      return { ok: false, output: stdout, unavailable: false, timedOut: true, detail: 'tsc timed out' };
    }
    if (typeof guarded.status === 'number') {
      return { ok: true, output: stdout, unavailable: false, timedOut: false, detail: '' };
    }
    const detail = stderr.length > 0 ? stderr : err instanceof Error ? err.message : String(err);
    return { ok: false, output: stdout, unavailable: true, timedOut: false, detail };
  }
}

/**
 * Pure: a minimal, valid unified diff that represents the PR adding the
 * directive line(s) to `relFile`, built from the workspace file's actual lines
 * so `git apply -R` removes exactly those lines (the counterfactual) and a
 * forward `git apply` restores them. One hunk per directive line, each carrying
 * whatever single-line context exists around it. Returns null when a directive
 * line number does not point at the expected content in the workspace (drift).
 */
export function buildDirectiveRemovalPatch(
  relFile: string,
  fileLines: readonly string[],
  directives: readonly AddedDirective[],
): string | null {
  const sorted = [...directives].sort((a, b) => a.line - b.line);
  const hunks: string[] = [];
  for (const d of sorted) {
    const idx = d.line - 1; // 0-based
    if (idx < 0 || idx >= fileLines.length) return null;
    if (fileLines[idx]!.replace(/\s+/g, ' ').trim() !== d.content.replace(/\s+/g, ' ').trim()) {
      return null; // workspace drifted from the diff
    }
    const before = idx > 0 ? fileLines[idx - 1] : undefined;
    const after = idx + 1 < fileLines.length ? fileLines[idx + 1] : undefined;
    const oldStart = before !== undefined ? d.line - 1 : d.line;
    const ctxBefore = before !== undefined ? 1 : 0;
    const ctxAfter = after !== undefined ? 1 : 0;
    const oldCount = ctxBefore + ctxAfter;
    const newCount = ctxBefore + 1 + ctxAfter;
    const body: string[] = [];
    if (before !== undefined) body.push(` ${before}`);
    body.push(`+${fileLines[idx]}`);
    if (after !== undefined) body.push(` ${after}`);
    hunks.push(`@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`);
    hunks.push(...body);
  }
  if (hunks.length === 0) return null;
  const header = [`diff --git a/${relFile} b/${relFile}`, `--- a/${relFile}`, `+++ b/${relFile}`];
  return `${[...header, ...hunks].join('\n')}\n`;
}

/** `git apply [-R]` the patch in `cwd`. Never throws. */
function gitApply(opts: { patch: string; cwd: string; reverse: boolean }): {
  ok: boolean;
  detail: string;
} {
  const args = ['apply', ...(opts.reverse ? ['-R'] : []), '--whitespace=nowarn', '-'];
  const res = spawnSync('git', args, { cwd: opts.cwd, input: opts.patch, encoding: 'utf8', timeout: 60_000 });
  if (res.error !== undefined) return { ok: false, detail: res.error.message };
  if (res.status !== 0) {
    const detail = [res.stderr, res.stdout]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join('\n')
      .trim();
    return { ok: false, detail: detail.length > 0 ? detail : `git apply status ${res.status}` };
  }
  return { ok: true, detail: '' };
}

const SAFE_HEAD_SHA = /^[0-9a-f]{7,40}$/;
const SAFE_PR_REF = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+$/;
const SAFE_PATH = /^[A-Za-z0-9._/@-]+$/;
const RESTORE_PATCH_DELIMITER = 'SWARM_RESTORE_PATCH';

/** Pure: a self-contained reproduce command that fetches the PR head, removes
 *  the directive with `git apply -R`, and runs tsc to surface the diagnostic.
 *  Throws (fail closed) when an interpolated value is not shell-safe: a command
 *  we cannot publish safely is not published as a proof. */
export function buildTscReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  tsconfigRel: string;
  revertedHunkPatch: string;
}): string {
  if (!SAFE_HEAD_SHA.test(opts.prHeadSha)) {
    throw new SwarmError(
      `PR head sha '${opts.prHeadSha}' is not a 7-40 character lowercase hex string`,
      'TYPE_SUPPRESSION_UNSAFE_HEAD_SHA',
      { remediation: 'Pass the full lowercase commit sha of the PR head as reported by git.' },
    );
  }
  if (/#\d+$/.test(opts.prRef) && !SAFE_PR_REF.test(opts.prRef)) {
    throw new SwarmError(
      `PR ref '${opts.prRef}' does not match the owner/repo#N shape`,
      'TYPE_SUPPRESSION_UNSAFE_PR_REF',
      { remediation: 'Pass the PR ref as owner/repo#N with conservative repository characters.' },
    );
  }
  const tsconfig = opts.tsconfigRel === '' ? 'tsconfig.json' : opts.tsconfigRel;
  if (!SAFE_PATH.test(tsconfig) || tsconfig.startsWith('/') || tsconfig.split('/').includes('..')) {
    throw new SwarmError(
      `tsconfig path '${tsconfig}' is not safe to publish in a reproduce command`,
      'TYPE_SUPPRESSION_UNSAFE_TSCONFIG',
      { remediation: 'Run tsc manually against the restored checkout pointing at the project tsconfig.' },
    );
  }
  const prNumber = /#(\d+)$/.exec(opts.prRef)?.[1];
  const fetch =
    prNumber !== undefined
      ? `git fetch origin pull/${prNumber}/head`
      : `git fetch origin ${opts.prHeadSha}`;
  const head =
    `${fetch} && git checkout ${opts.prHeadSha} && ` +
    `git apply -R <<'${RESTORE_PATCH_DELIMITER}' && npx tsc --noEmit --pretty false -p ${tsconfig}`;
  return `${head}\n${opts.revertedHunkPatch.replace(/\n+$/, '')}\n${RESTORE_PATCH_DELIMITER}`;
}

function record(
  base: { findingFile: string; removedDirectives: string[]; revertedHunkPatch: string },
  verdict: TypeSuppressionVerdict,
  controls: TypeSuppressionControls,
  extra: Partial<TypeSuppressionProofRecord> = {},
): TypeSuppressionProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'type-suppression',
    findingFile: base.findingFile,
    removedDirectives: base.removedDirectives,
    surfacedDiagnostics: [],
    controls,
    reproduceCommand: '',
    revertedHunkPatch: base.revertedHunkPatch,
    ...extra,
  };
}

/**
 * The orchestrator. Provisioning is the caller's job; this reverts the directive
 * against the already-provisioned head workspace, runs tsc twice, and never
 * throws. The directive is always re-applied forward before returning, so the
 * shared workspace stays valid for later consumers.
 */
export function runTypeSuppressionRestoration(
  input: TypeSuppressionRestorationInput,
): TypeSuppressionProofRecord {
  try {
    return runTypeSuppressionPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`type-suppression-restoration: orchestrator threw unexpectedly: ${message}`);
    return {
      schemaVersion: 1,
      verdict: 'not-proven:execution-error',
      category: 'type-suppression',
      findingFile: input.finding.file,
      removedDirectives: [],
      surfacedDiagnostics: [],
      controls: {
        directiveRemoved: null,
        fileCleanAsSubmitted: null,
        diagnosticSurfacesWhenRemoved: null,
      },
      reproduceCommand: '',
      revertedHunkPatch: '',
      reason: `type-suppression-restoration orchestrator threw unexpectedly: ${message}`,
    };
  }
}

function runTypeSuppressionPipeline(
  input: TypeSuppressionRestorationInput,
): TypeSuppressionProofRecord {
  const controls: TypeSuppressionControls = {
    directiveRemoved: null,
    fileCleanAsSubmitted: null,
    diagnosticSurfacesWhenRemoved: null,
  };
  const relFile = input.finding.file;
  const base = { findingFile: relFile, removedDirectives: [] as string[], revertedHunkPatch: '' };

  if (isTestFile(relFile) || !TS_EXTENSIONS.test(relFile)) {
    return record(base, 'not-proven:non-typescript-file', controls, {
      reason: `the finding file '${relFile}' is not a TypeScript source file tsc checks by default`,
    });
  }

  const directives = extractAddedDirectives(input.prDiff, relFile);
  if (directives.length === 0) {
    const verdict: TypeSuppressionVerdict = fileHasAnyAddedSuppression(input.prDiff, relFile)
      ? 'not-proven:not-tsc-checkable'
      : 'not-proven:no-suppression-hunks';
    return record(base, verdict, controls, {
      reason:
        verdict === 'not-proven:not-tsc-checkable'
          ? 'the only added suppression is one tsc cannot adjudicate (eslint-disable, @ts-nocheck, # type: ignore, @SuppressWarnings)'
          : 'the PR added no @ts-ignore / @ts-expect-error to this file',
    });
  }
  base.removedDirectives = [...new Set(directives.map((d) => d.label))].sort();

  const tsconfig = findNearestTsconfig(input.repoRoot, relFile);
  if (tsconfig === null) {
    return record(base, 'not-proven:no-tsconfig', controls, {
      reason: `no tsconfig.json found from ${relFile} up to the repo root, so tsc cannot be scoped`,
    });
  }
  const tsconfigRel = path.relative(input.repoRoot, tsconfig);
  const absTarget = path.resolve(input.repoRoot, relFile);

  // Control 2: the file must be clean as submitted. A file already red is a
  // case CI catches, not a concealed error.
  const submitted = runTsc({
    tsconfig,
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  });
  if (submitted.unavailable) {
    return record(base, 'not-proven:tsc-unavailable', controls, {
      reason: `tsc could not be invoked in the workspace: ${submitted.detail}`,
    });
  }
  if (submitted.timedOut || !submitted.ok) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `the as-submitted tsc run did not complete: ${submitted.detail}`,
    });
  }
  const submittedDiagnostics = parseTscDiagnosticsForFile(submitted.output, input.repoRoot, absTarget);
  controls.fileCleanAsSubmitted = submittedDiagnostics.length === 0;
  if (submittedDiagnostics.length > 0) {
    return record(base, 'not-proven:already-failing', controls, {
      reason: `tsc already reports ${submittedDiagnostics.length} diagnostic(s) in ${relFile} as submitted; CI would have caught it`,
    });
  }

  // Build the directive-removal patch from the actual workspace file lines.
  let fileLines: string[];
  try {
    fileLines = fs.readFileSync(absTarget, 'utf8').split('\n');
  } catch (err) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `could not read ${relFile} from the workspace: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  const patch = buildDirectiveRemovalPatch(relFile, fileLines, directives);
  if (patch === null) {
    return record(base, 'not-proven:file-drifted', controls, {
      reason: 'the added directive line(s) no longer match the workspace file content, so the revert cannot be localized (fail closed)',
    });
  }
  base.revertedHunkPatch = patch;

  // Revert the directive, run tsc, then always re-apply forward.
  const revert = gitApply({ patch, cwd: input.repoRoot, reverse: true });
  if (!revert.ok) {
    return record(base, 'not-proven:patch-apply-failed', controls, {
      reason: `reverse-applying the directive patch failed: ${revert.detail}`,
    });
  }
  controls.directiveRemoved = true;
  let removed: TscRun;
  let restoreFailure: string | null = null;
  try {
    removed = runTsc({
      tsconfig,
      cwd: input.repoRoot,
      timeoutMs: input.timeoutMs,
      ...(input.docker !== undefined ? { docker: input.docker } : {}),
    });
  } finally {
    const forward = gitApply({ patch, cwd: input.repoRoot, reverse: false });
    if (!forward.ok) {
      restoreFailure = `forward re-apply failed, the post workspace is corrupted (harness bug): ${forward.detail}`;
      log.error(`type-suppression-restoration: ${restoreFailure} (cwd=${input.repoRoot})`);
    }
  }
  if (removed.unavailable || removed.timedOut || !removed.ok) {
    return record(base, 'not-proven:execution-error', controls, {
      reason: `the directive-removed tsc run did not complete: ${removed.detail}${restoreFailure !== null ? `; ${restoreFailure}` : ''}`,
    });
  }
  const removedDiagnostics = parseTscDiagnosticsForFile(removed.output, input.repoRoot, absTarget);
  controls.diagnosticSurfacesWhenRemoved = removedDiagnostics.length > 0;

  const classified = classifyTypeSuppression({
    fileDiagnosticsAsSubmitted: submittedDiagnostics.length,
    fileDiagnosticsWhenRemoved: removedDiagnostics.length,
  });
  if (classified.verdict !== 'proven') {
    const reason =
      classified.verdict === 'refuted'
        ? 'removing the directive surfaced no tsc diagnostic in the file, so the suppression silenced nothing'
        : classified.verdict;
    return record(base, classified.verdict, controls, {
      reason: restoreFailure !== null ? `${reason}; ${restoreFailure}` : reason,
    });
  }

  let reproduceCommand: string;
  try {
    reproduceCommand = buildTscReproduceCommand({
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      tsconfigRel,
      revertedHunkPatch: patch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`type-suppression-restoration: proven proof cannot render its reproduce command: ${message}`);
    return record(base, 'not-proven:execution-error', controls, {
      reason: `proven type-suppression proof could not render its reproduce command: ${message}`,
    });
  }
  return record(base, 'proven', controls, {
    surfacedDiagnostics: removedDiagnostics,
    reproduceCommand,
    ...(restoreFailure !== null ? { reason: restoreFailure } : {}),
  });
}

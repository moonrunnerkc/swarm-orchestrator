// Fake-refactor restoration. A counterfactual proof for the structural
// fake-refactor detector, which flags a rename whose old name still appears in
// the PR's own diff-visible lines but cannot see the rest of the repository. The
// proof is static against the provisioned head checkout: it determines the
// renamed-away (old) symbol from the diff, confirms that symbol has no remaining
// declaration anywhere in the checkout (the rename really removed it), and scans
// the whole checkout for surviving identifier references to it. References that
// survive a removed declaration are dangling: the "refactor" left the old name
// referenced against a symbol that no longer exists. No references means the
// rename is complete (refuted).
//
// Three per-instance controls, all green before the proof can gate (fail-closed,
// like the restoration proofs):
//   1. oldSymbolResolved            exactly one old symbol name is determined
//                                   unambiguously from the diff for the finding
//   2. oldSymbolDeclarationRemoved  no file in the checkout still declares the
//                                   old name (so a surviving reference is
//                                   dangling, not a coincidental live symbol)
//   3. oldSymbolStillReferenced     at least one identifier reference to the old
//                                   name survives in the checkout
//
// The whole pipeline is pure-with-fs-reads: no child process, no test run. It
// reuses the same TypeScript-AST identifier matching the structural detector
// uses, so the two cannot disagree on what counts as a reference.

import * as fs from 'fs';
import * as path from 'path';
import parseDiff from 'parse-diff';
import * as ts from 'typescript';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';

const log = getLogger('audit:execution-grounded:fake-refactor-restoration');

export type FakeRefactorVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:non-source-file'
  | 'not-proven:no-rename'
  | 'not-proven:ambiguous-old-symbol'
  | 'not-proven:old-symbol-still-declared'
  | 'not-proven:scan-capped'
  // Reserved for the execution-grounded caller when no sandbox workspace exists.
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface FakeRefactorControls {
  /** Control 1: exactly one old symbol name was resolved from the diff. */
  oldSymbolResolved: boolean | null;
  /** Control 2: the old name has no remaining declaration in the checkout. */
  oldSymbolDeclarationRemoved: boolean | null;
  /** Control 3: at least one reference to the old name survives in the checkout. */
  oldSymbolStillReferenced: boolean | null;
}

export interface FakeRefactorProofRecord {
  schemaVersion: 1;
  verdict: FakeRefactorVerdict;
  category: 'fake-refactor';
  findingFile: string;
  /** The renamed-away symbol (empty unless resolved). */
  oldName: string;
  /** The symbol it was renamed to (for the message; empty unless resolved). */
  newName: string;
  /** `file:line` references to the old name in the head checkout (the proof). */
  references: string[];
  controls: FakeRefactorControls;
  /** Exact command a human runs in a fresh checkout to see the references. */
  reproduceCommand: string;
  reason?: string;
}

export interface FakeRefactorRestorationInput {
  finding: { category: 'fake-refactor'; file: string; line: number };
  prDiff: string;
  prRef: string;
  prHeadSha: string;
  /** Repo root for the checkout scan (= post workspace). */
  repoRoot: string;
  /** Cap on source files scanned, so a giant monorepo cannot blow the budget. */
  maxFilesExamined?: number;
}

export const DEFAULT_MAX_FILES_EXAMINED = 2000;

const EXPORT_DECL_RE =
  /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const SOURCE_EXT = /\.(?:m|c)?[jt]sx?$/;
const SAFE_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const realPath = (p: string | undefined): string | null =>
  p !== undefined && p !== '/dev/null' ? p : null;

export interface RenamePair {
  oldName: string;
  newName: string;
  addedLine: number;
}

/**
 * Pure: the export rename pairs the PR's diff carries for `findingFile`. A pair
 * is a deleted `export function|class|const|... NAME` matched with a same-hunk
 * added export of a different name, exactly the shape the structural detector
 * keys on. Returns every pair so the caller can localize to the finding's line.
 */
export function extractRenamePairs(prDiff: string, findingFile: string): RenamePair[] {
  const target = parseDiff(prDiff).find(
    (f) => realPath(f.to) === findingFile || realPath(f.from) === findingFile,
  );
  if (target === undefined) return [];
  const out: RenamePair[] = [];
  for (const chunk of target.chunks) {
    const deleted = chunk.changes.filter((c) => c.type === 'del');
    const added = chunk.changes.filter((c) => c.type === 'add');
    for (const del of deleted) {
      const oldName = del.content.slice(1).match(EXPORT_DECL_RE)?.[1];
      if (oldName === undefined) continue;
      for (const add of added) {
        const newName = add.content.slice(1).match(EXPORT_DECL_RE)?.[1];
        if (newName === undefined || newName === oldName) continue;
        out.push({ oldName, newName, addedLine: (add as { ln?: number }).ln ?? 0 });
      }
    }
  }
  return out;
}

/**
 * Pure: resolve the single old symbol the finding points at. The finding's line
 * is the rename's added-side line, so a pair whose addedLine matches it is the
 * one. When the line does not disambiguate (no match, or more than one distinct
 * old name across the file's pairs), this returns null so the proof fails closed
 * rather than guess.
 */
export function resolveOldSymbol(pairs: readonly RenamePair[], findingLine: number): RenamePair | null {
  const onLine = pairs.filter((p) => p.addedLine === findingLine);
  const candidates = onLine.length > 0 ? onLine : pairs;
  const distinctOld = new Set(candidates.map((p) => p.oldName));
  if (distinctOld.size !== 1) return null;
  return candidates[0] ?? null;
}

/** True when `node` is the declared name of a declaration (so it is a binding,
 *  not a reference to an existing symbol). */
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  // A named import of the old name (`import { oldTotal }` or the `oldTotal` in
  // `import { oldTotal as x }`) is NOT a declaration of it: it imports the
  // now-missing export, which is exactly a dangling reference. Default and
  // namespace imports bind a fresh local name, so they stay declarations.
  if (ts.isImportClause(parent) && parent.name === node) return true;
  if (ts.isNamespaceImport(parent) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isEnumDeclaration(parent) && parent.name === node) return true;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return true;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return true;
  return false;
}

/** True when `node` is the property name in `obj.node` or `{ node: ... }`, i.e.
 *  a member access unrelated to a top-level symbol of the same name. */
function isMemberName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

interface ScanResult {
  /** Repo-relative `file:line` reference locations, sorted, deduped. */
  references: string[];
  /** True when the old name still has a declaration somewhere in the checkout. */
  declared: boolean;
  /** True when the file cap was hit (scan is partial). */
  capped: boolean;
}

/**
 * Scan the checkout for the old symbol: surviving identifier references (not
 * declarations, not `.member` accesses) and any remaining declaration of the
 * name. Reads files; never throws on a single unreadable/unparseable file (it is
 * skipped). The declaration site of the rename's NEW name is irrelevant here;
 * what matters is whether the OLD name is still declared anywhere.
 */
export function scanCheckoutForOldSymbol(
  repoRoot: string,
  oldName: string,
  maxFilesExamined: number = DEFAULT_MAX_FILES_EXAMINED,
): ScanResult {
  const files = enumerateRepoSourceFiles(repoRoot, maxFilesExamined + 1);
  const capped = files.length > maxFilesExamined;
  const examined = capped ? files.slice(0, maxFilesExamined) : files;
  const references = new Set<string>();
  let declared = false;
  for (const abs of examined) {
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(oldName)) continue; // cheap pre-filter before parsing
    let source: ts.SourceFile;
    try {
      source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    } catch (err) {
      log.debug(`could not parse ${abs}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const rel = path.relative(repoRoot, abs);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === oldName) {
        if (isDeclarationName(node)) {
          declared = true;
        } else if (!isMemberName(node)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          references.add(`${rel}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {
    references: [...references].sort((a, b) => a.localeCompare(b)),
    declared,
    capped,
  };
}

const SAFE_HEAD_SHA = /^[0-9a-f]{7,40}$/;
const SAFE_PR_REF = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+$/;
const SAFE_PATH = /^[A-Za-z0-9._/@:-]+$/;

/** Pure: a self-contained reproduce command that fetches the PR head and greps
 *  the surviving references. Throws (fail closed) on any unsafe interpolation. */
export function buildGrepReproduceCommand(opts: {
  prRef: string;
  prHeadSha: string;
  oldName: string;
  referenceFiles: string[];
}): string {
  if (!SAFE_HEAD_SHA.test(opts.prHeadSha)) {
    throw new SwarmError(
      `PR head sha '${opts.prHeadSha}' is not a 7-40 character lowercase hex string`,
      'FAKE_REFACTOR_UNSAFE_HEAD_SHA',
      { remediation: 'Pass the full lowercase commit sha of the PR head as reported by git.' },
    );
  }
  if (/#\d+$/.test(opts.prRef) && !SAFE_PR_REF.test(opts.prRef)) {
    throw new SwarmError(
      `PR ref '${opts.prRef}' does not match the owner/repo#N shape`,
      'FAKE_REFACTOR_UNSAFE_PR_REF',
      { remediation: 'Pass the PR ref as owner/repo#N with conservative repository characters.' },
    );
  }
  if (!SAFE_IDENT.test(opts.oldName)) {
    throw new SwarmError(
      `old symbol '${opts.oldName}' is not a bare identifier`,
      'FAKE_REFACTOR_UNSAFE_SYMBOL',
      { remediation: 'The renamed-away symbol must be a plain identifier; grep for it manually.' },
    );
  }
  for (const f of opts.referenceFiles) {
    if (!SAFE_PATH.test(f) || f.startsWith('/') || f.split('/').includes('..')) {
      throw new SwarmError(
        `reference path '${f}' is not safe to publish in a reproduce command`,
        'FAKE_REFACTOR_UNSAFE_PATH',
        { remediation: 'Grep the restored checkout for the old symbol manually.' },
      );
    }
  }
  const prNumber = /#(\d+)$/.exec(opts.prRef)?.[1];
  const fetch =
    prNumber !== undefined
      ? `git fetch origin pull/${prNumber}/head`
      : `git fetch origin ${opts.prHeadSha}`;
  const files = opts.referenceFiles.length > 0 ? opts.referenceFiles.join(' ') : '.';
  return `${fetch} && git checkout ${opts.prHeadSha} && grep -rnw '${opts.oldName}' ${files}`;
}

/** Enumerate JS/TS source files under `repoRoot`, depth-capped and skipping
 *  node_modules/dist/.git. Stops once `cap` files are collected. */
export function enumerateRepoSourceFiles(repoRoot: string, cap: number): string[] {
  if (!fs.existsSync(repoRoot)) return [];
  const out: string[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: repoRoot, depth: 0 }];
  while (stack.length > 0 && out.length < cap) {
    const { dir, depth } = stack.pop()!;
    if (depth > 8) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= cap) break;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function record(
  base: { findingFile: string; oldName: string; newName: string; references: string[] },
  verdict: FakeRefactorVerdict,
  controls: FakeRefactorControls,
  extra: Partial<FakeRefactorProofRecord> = {},
): FakeRefactorProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'fake-refactor',
    findingFile: base.findingFile,
    oldName: base.oldName,
    newName: base.newName,
    references: base.references,
    controls,
    reproduceCommand: '',
    ...extra,
  };
}

/**
 * The orchestrator. Static: it reads the provisioned head checkout but spawns
 * nothing and never throws. Provisioning is the caller's job.
 */
export function runFakeRefactorRestoration(
  input: FakeRefactorRestorationInput,
): FakeRefactorProofRecord {
  try {
    return runFakeRefactorPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`fake-refactor-restoration: orchestrator threw unexpectedly: ${message}`);
    return {
      schemaVersion: 1,
      verdict: 'not-proven:execution-error',
      category: 'fake-refactor',
      findingFile: input.finding.file,
      oldName: '',
      newName: '',
      references: [],
      controls: {
        oldSymbolResolved: null,
        oldSymbolDeclarationRemoved: null,
        oldSymbolStillReferenced: null,
      },
      reproduceCommand: '',
      reason: `fake-refactor-restoration orchestrator threw unexpectedly: ${message}`,
    };
  }
}

function runFakeRefactorPipeline(input: FakeRefactorRestorationInput): FakeRefactorProofRecord {
  const controls: FakeRefactorControls = {
    oldSymbolResolved: null,
    oldSymbolDeclarationRemoved: null,
    oldSymbolStillReferenced: null,
  };
  const base = { findingFile: input.finding.file, oldName: '', newName: '', references: [] as string[] };

  if (!SOURCE_EXT.test(input.finding.file)) {
    return record(base, 'not-proven:non-source-file', controls, {
      reason: `the finding file '${input.finding.file}' is not a JS/TS source file`,
    });
  }

  const pairs = extractRenamePairs(input.prDiff, input.finding.file);
  if (pairs.length === 0) {
    return record(base, 'not-proven:no-rename', controls, {
      reason: 'the PR diff carries no export rename pair for this file',
    });
  }
  const resolved = resolveOldSymbol(pairs, input.finding.line);
  if (resolved === null) {
    return record(base, 'not-proven:ambiguous-old-symbol', controls, {
      reason: 'the renamed-away symbol could not be determined unambiguously from the diff (fail closed)',
    });
  }
  controls.oldSymbolResolved = true;
  base.oldName = resolved.oldName;
  base.newName = resolved.newName;

  const scan = scanCheckoutForOldSymbol(
    input.repoRoot,
    resolved.oldName,
    input.maxFilesExamined ?? DEFAULT_MAX_FILES_EXAMINED,
  );
  base.references = scan.references;
  if (scan.capped) {
    return record(base, 'not-proven:scan-capped', controls, {
      reason: `the source-file scan hit its ${input.maxFilesExamined ?? DEFAULT_MAX_FILES_EXAMINED}-file cap, so the declaration check is not trustworthy (fail closed)`,
    });
  }
  controls.oldSymbolDeclarationRemoved = !scan.declared;
  if (scan.declared) {
    return record(base, 'not-proven:old-symbol-still-declared', controls, {
      reason: `the old name '${resolved.oldName}' still has a declaration in the checkout, so a surviving reference is not dangling`,
    });
  }

  controls.oldSymbolStillReferenced = scan.references.length > 0;
  if (scan.references.length === 0) {
    return record(base, 'refuted', controls, {
      reason: `no surviving reference to '${resolved.oldName}' remains in the checkout, so the rename is complete`,
    });
  }

  const referenceFiles = [...new Set(scan.references.map((r) => r.split(':')[0]!))].sort();
  let reproduceCommand: string;
  try {
    reproduceCommand = buildGrepReproduceCommand({
      prRef: input.prRef,
      prHeadSha: input.prHeadSha,
      oldName: resolved.oldName,
      referenceFiles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`fake-refactor-restoration: proven proof cannot render its reproduce command: ${message}`);
    return record(base, 'not-proven:execution-error', controls, {
      reason: `proven fake-refactor proof could not render its reproduce command: ${message}`,
    });
  }
  return record(base, 'proven', controls, { reproduceCommand });
}

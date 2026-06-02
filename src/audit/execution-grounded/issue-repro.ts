// Issue-linked repro execution. When a PR says "fixes #123" and that issue
// carries a runnable repro (a script or a test snippet), the sharpest check
// of the fix is to run the repro against the post-PR code: if it still fails,
// the PR did not deliver its claim. This module extracts issue references
// from a PR, pulls the linked issues, lifts runnable repros out of their
// bodies, executes them against the pre- and post-PR workspaces, and
// classifies the pre/post pair.
//
// The reality is that most issues have no runnable repro; the extractability
// rate is tracked and reported alongside the conditional catch rate, never
// hidden inside an unconditional one.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { execBin, execEnv } from './exec-env';
import type { TestRunner } from './sandbox';

const log = getLogger('audit:execution-grounded:issue-repro');

export interface IssueRef {
  /** Absent when the reference is a bare `#123` (same repo as the PR). */
  owner?: string;
  repo?: string;
  number: number;
}

// `fixes #1`, `Closes owner/repo#2`, and full issue/PR URLs. The verb set is
// the GitHub-recognized closing-keyword list; we additionally accept a bare
// `#N` only when preceded by a closing verb to avoid sweeping up every issue
// mention in a PR body.
const VERB = '(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)';
const BARE_RE = new RegExp(`\\b${VERB}\\b[:\\s]+#(\\d+)`, 'gi');
const SLUG_RE = new RegExp(`\\b${VERB}\\b[:\\s]+([\\w.-]+)/([\\w.-]+)#(\\d+)`, 'gi');
const URL_RE = new RegExp(`\\b${VERB}\\b[:\\s]+https?://github\\.com/([\\w.-]+)/([\\w.-]+)/(?:issues|pull)/(\\d+)`, 'gi');

/** Extract issue references closed by a PR from its body and commit messages.
 *  Deduplicated by (owner, repo, number). */
export function parseIssueReferences(text: string): IssueRef[] {
  const seen = new Set<string>();
  const refs: IssueRef[] = [];
  const push = (ref: IssueRef): void => {
    const key = `${ref.owner ?? ''}/${ref.repo ?? ''}#${ref.number}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const m of text.matchAll(URL_RE)) push({ owner: m[1], repo: m[2], number: Number(m[3]) });
  for (const m of text.matchAll(SLUG_RE)) push({ owner: m[1], repo: m[2], number: Number(m[3]) });
  for (const m of text.matchAll(BARE_RE)) push({ number: Number(m[1]) });
  return refs;
}

export interface CodeBlock {
  lang: string;
  code: string;
}

/** Pull fenced code blocks out of Markdown. The info string after the
 *  opening fence becomes `lang` (empty when omitted). */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split('\n');
  let inBlock = false;
  let lang = '';
  let buf: string[] = [];
  for (const line of lines) {
    const fence = /^\s*```+\s*([\w.+-]*)\s*$/.exec(line);
    if (fence !== null && !inBlock) {
      inBlock = true;
      lang = (fence[1] ?? '').toLowerCase();
      buf = [];
      continue;
    }
    if (/^\s*```+\s*$/.test(line) && inBlock) {
      inBlock = false;
      blocks.push({ lang, code: buf.join('\n') });
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

export type ReproKind = 'script' | 'test' | 'unknown';
export type ReproLanguage = 'js' | 'ts';

export interface Repro {
  kind: ReproKind;
  language: ReproLanguage;
  code: string;
}

const TEST_MARKER_RE = /\b(it|test|describe)\s*\(|\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(/;
const SCRIPT_MARKER_RE = /\bconsole\.(log|error)\s*\(|\brequire\s*\(|^\s*import\s|\bawait\s|\.then\s*\(/m;
const TS_MARKER_RE = /:\s*(string|number|boolean|void|unknown|any)\b|^\s*interface\s|\bas\s+[A-Z]\w*|<[A-Z]\w*>/m;

/** Classify a code block into a runnable repro, or return null when it is not
 *  plausibly runnable JS/TS (e.g. a shell snippet, a stack trace, prose). */
export function classifyRepro(block: CodeBlock): Repro | null {
  const lang = block.lang;
  const isJsTsTag = ['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'node', ''].includes(lang);
  if (!isJsTsTag) return null;
  const code = block.code.trim();
  if (code.length === 0) return null;
  const isTs = ['ts', 'typescript', 'tsx'].includes(lang) || TS_MARKER_RE.test(code);
  const language: ReproLanguage = isTs ? 'ts' : 'js';
  let kind: ReproKind = 'unknown';
  if (TEST_MARKER_RE.test(code)) kind = 'test';
  else if (SCRIPT_MARKER_RE.test(code)) kind = 'script';
  if (kind === 'unknown') return null;
  return { kind, language, code };
}

/** Lift every runnable repro out of an issue body. */
export function extractRepros(issueBody: string): Repro[] {
  const out: Repro[] = [];
  for (const block of extractCodeBlocks(issueBody)) {
    const repro = classifyRepro(block);
    if (repro !== null) out.push(repro);
  }
  return out;
}

export interface FetchIssueOptions {
  owner: string;
  repo: string;
  number: number;
  token?: string;
  cacheDir?: string;
}

interface IssuePayload {
  title?: string;
  body?: string | null;
}

/** Fetch an issue body via the GitHub REST API, caching the response on disk.
 *  Returns null when the issue cannot be fetched (404, rate limit, network). */
export async function fetchIssue(opts: FetchIssueOptions): Promise<{ title: string; body: string } | null> {
  const cacheFile =
    opts.cacheDir !== undefined
      ? path.join(opts.cacheDir, `${opts.owner}-${opts.repo}-${opts.number}.json`)
      : undefined;
  if (cacheFile !== undefined && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as IssuePayload;
      return { title: cached.title ?? '', body: cached.body ?? '' };
    } catch (err) {
      log.debug(`unreadable issue cache ${cacheFile}: ${String(err)}`);
    }
  }
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/issues/${opts.number}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'swarm-orchestrator-audit',
  };
  if (opts.token !== undefined && opts.token.length > 0) headers.Authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      log.debug(`issue fetch ${url} returned ${res.status}`);
      return null;
    }
    const payload = (await res.json()) as IssuePayload;
    if (cacheFile !== undefined) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ title: payload.title ?? '', body: payload.body ?? '' }, null, 2));
    }
    return { title: payload.title ?? '', body: payload.body ?? '' };
  } catch (err) {
    log.debug(`issue fetch ${url} failed: ${String(err)}`);
    return null;
  }
}

export type ReproStatus = 'failed' | 'passed' | 'errored' | 'timeout';

export interface ReproExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: ReproStatus;
}

const SCRIPT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;

function testCommand(runner: TestRunner, file: string): { cmd: string; args: string[] } | null {
  switch (runner) {
    case 'mocha':
      return { cmd: 'npx', args: ['mocha', file] };
    case 'jest':
      return { cmd: 'npx', args: ['jest', '--runTestsByPath', file] };
    case 'vitest':
      return { cmd: 'npx', args: ['vitest', 'run', file] };
    case 'ava':
      return { cmd: 'npx', args: ['ava', file] };
    case 'node-test':
      return { cmd: 'node', args: ['--test', file] };
    default:
      return null;
  }
}

/** A repro that cannot compile, parse, or resolve its imports never executed
 *  the code under test, so its non-zero exit is a harness/extraction artifact,
 *  not the bug reproducing. These signatures (esbuild/tsx transform errors,
 *  syntax errors, missing modules, ESM/extension mismatches) mark the run as
 *  errored (unevaluable) rather than a genuine failing repro. */
const SETUP_FAILURE = new RegExp(
  [
    'Transform failed',
    'TransformError',
    'SyntaxError',
    'Cannot find module',
    'Cannot find package',
    'ERR_MODULE_NOT_FOUND',
    'ERR_UNKNOWN_FILE_EXTENSION',
    'ERR_UNKNOWN_BUILTIN_MODULE',
    'Cannot use import statement outside a module',
    'Unexpected token',
    'Unexpected end of (input|file)',
    'Failed to (load|resolve)',
  ].join('|'),
);

function classifyExit(err: unknown): { status: ReproStatus; exitCode: number | null; stdout: string; stderr: string } {
  const e = err as { status?: number; signal?: string; stdout?: Buffer | string; stderr?: Buffer | string };
  const stdout = e.stdout !== undefined ? String(e.stdout) : '';
  const stderr = e.stderr !== undefined ? String(e.stderr) : '';
  if (e.signal === 'SIGTERM') return { status: 'timeout', exitCode: null, stdout, stderr };
  // A compile/parse/module-resolution failure means the repro never ran the
  // code under test, so it is not evidence the bug reproduces; treat it as
  // errored (unevaluable) regardless of the exit code.
  if (SETUP_FAILURE.test(stderr) || SETUP_FAILURE.test(stdout)) {
    return { status: 'errored', exitCode: typeof e.status === 'number' ? e.status : null, stdout, stderr };
  }
  if (typeof e.status === 'number') return { status: 'failed', exitCode: e.status, stdout, stderr };
  return { status: 'errored', exitCode: null, stdout, stderr };
}

export interface ExecuteReproOptions {
  workspacePath: string;
  repro: Repro;
  testRunner: TestRunner | null;
}

/**
 * Execute a repro inside a workspace. Scripts run with `node`/`tsx` and a 60s
 * timeout; test snippets are dropped into the workspace and run with the
 * detected runner under a 120s timeout. The temp file is always removed.
 *
 * Status semantics: `failed` (exit non-zero, i.e. the repro reproduced the
 * bug / a test assertion failed), `passed` (exit zero), `timeout`, or
 * `errored` (could not run at all).
 */
export function executeIssueRepro(opts: ExecuteReproOptions): ReproExecution {
  const { workspacePath, repro, testRunner } = opts;
  const isTest = repro.kind === 'test';
  const ext = repro.language === 'ts' ? (isTest ? 'test.ts' : 'ts') : isTest ? 'test.js' : 'js';
  const fileName = `__swarm_repro__.${ext}`;
  const filePath = path.join(workspacePath, fileName);
  const timeoutMs = isTest ? TEST_TIMEOUT_MS : SCRIPT_TIMEOUT_MS;
  const started = Date.now();

  let cmd: string;
  let args: string[];
  if (isTest) {
    const tc = testRunner !== null ? testCommand(testRunner, fileName) : null;
    if (tc === null) {
      return { exitCode: null, stdout: '', stderr: `no runner for test repro (runner=${testRunner ?? 'none'})`, durationMs: 0, status: 'errored' };
    }
    cmd = tc.cmd;
    args = tc.args;
  } else if (repro.language === 'ts') {
    cmd = 'npx';
    args = ['tsx', fileName];
  } else {
    cmd = 'node';
    args = [fileName];
  }

  try {
    fs.writeFileSync(filePath, repro.code, 'utf8');
    const stdout = execFileSync(execBin(cmd), args, {
      cwd: workspacePath,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      env: execEnv(),
    });
    return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - started, status: 'passed' };
  } catch (err) {
    const c = classifyExit(err);
    return { ...c, durationMs: Date.now() - started };
  } finally {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (err) {
      log.debug(`failed to remove repro temp file ${filePath}: ${String(err)}`);
    }
  }
}

export type ReproVerdict =
  | 'fix-not-delivered' // pre failed, post failed -> high-confidence catch
  | 'fix-delivered' // pre failed, post passed
  | 'not-reproducible' // pre passed, post passed
  | 'pr-broke-repro' // pre passed, post failed -> a different catch
  | 'unevaluable'; // errored/timeout on either side

/** Classify a pre/post repro pair. Errors and timeouts on either side make
 *  the pair unevaluable and contribute no signal. */
export function classifyComparison(pre: ReproStatus, post: ReproStatus): ReproVerdict {
  if (pre === 'errored' || pre === 'timeout' || post === 'errored' || post === 'timeout') return 'unevaluable';
  if (pre === 'failed' && post === 'failed') return 'fix-not-delivered';
  if (pre === 'failed' && post === 'passed') return 'fix-delivered';
  if (pre === 'passed' && post === 'passed') return 'not-reproducible';
  return 'pr-broke-repro';
}

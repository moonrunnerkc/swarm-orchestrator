// Structured evidence for a sandbox dependency-install failure. The live-wiring
// backfill showed 69 of 115 provisioning attempts dying as
// `sandbox-install-failed` with only a one-line reason in the funnel record, so
// the causes were unmeasurable. This module owns the capture (redacted stderr
// and stdout tails plus the install context) and a deterministic classifier that
// buckets the failure at record time. Measurement only: nothing here changes what the
// installer runs or how it retries.

import { SwarmError } from '../../errors';
import { isGuardedTimeout } from './exec-env';

/** Deterministic cause bucket for one install failure, derived purely from the
 *  captured evidence. `other` is the honesty bucket; the B1 acceptance target
 *  is keeping it under 10% of failures. The two `no-manifest-*` buckets are the
 *  B2 manifest-discovery outcomes: `no-manifest-found` means no package manifest
 *  exists anywhere the discovery looks (pre-discovery records with the npm
 *  ENOENT-package.json signature re-derive here too, meaning no manifest at the
 *  clone root, where their install ran); `no-manifest-for-diff` means subdir
 *  manifests exist but none owns a file the PR changed, so there is nothing
 *  meaningful to provision. */
export type InstallFailureBucket =
  | 'registry-or-network'
  | 'native-build'
  | 'engines-mismatch'
  | 'peer-dep-conflict'
  | 'lifecycle-script'
  | 'workspace-protocol'
  | 'disk-or-timeout'
  | 'no-manifest-found'
  | 'no-manifest-for-diff'
  | 'other';

/** The raw evidence captured at the failing install's throw site. */
export interface InstallFailureEvidence {
  /** The manager whose invocation failed: npm/yarn/pnpm/bun, or pip/poetry/go
   *  for the non-Node path. */
  readonly packageManager: string;
  /** Child exit code; null when the process was killed (timeout) or never ran. */
  readonly exitCode: number | null;
  /** True when the guarded runner killed the install at its wall-clock cap. */
  readonly timedOut: boolean;
  /** Last OUTPUT_TAIL_LINES lines of stderr, secret-redacted and byte-capped. */
  readonly stderrTail: string;
  /** Same treatment for stdout. Corepack yarn (berry and classic alike) prints
   *  its resolution and build errors on stdout, so a yarn failure with this
   *  field absent used to record an empty stderr tail and bucket as `other`.
   *  Absent on records written before the field existed and when stdout was
   *  empty; every reader treats it as optional. */
  readonly stdoutTail?: string;
  /** The lockfile filename found at the workspace root, or null. */
  readonly lockfile: string | null;
  /** The package.json `engines.node` range, or null when undeclared / non-Node. */
  readonly nodeEngineRange: string | null;
}

/** The evidence plus its bucket: the shape funnel records and EG sidecars carry. */
export interface InstallFailureRecord extends InstallFailureEvidence {
  readonly bucket: InstallFailureBucket;
}

export const OUTPUT_TAIL_LINES = 40;
export const OUTPUT_TAIL_MAX_BYTES = 8 * 1024;

/** Secret shapes that must never land in a committed record. The sandbox env is
 *  already deny-by-default, but stderr can still echo a registry URL with
 *  embedded auth or an .npmrc `_authToken` line, so the tail is scrubbed too. */
const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; mask: string }> = [
  // URL userinfo: https://user:token@registry.example -> https://***@registry.example
  { re: /(https?:\/\/)[^/\s@]+@/g, mask: '$1***@' },
  { re: /(_authToken\s*=\s*)\S+/gi, mask: '$1***' },
  { re: /(authorization\s*[:=]\s*)(?:bearer\s+|basic\s+)?\S+/gi, mask: '$1***' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, mask: '***' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, mask: '***' },
  { re: /\bnpm_[A-Za-z0-9]{30,}/g, mask: '***' },
  { re: /\bglpat-[A-Za-z0-9_-]{15,}/g, mask: '***' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, mask: '***' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, mask: '***' },
  // Key names ending in token/password/secret/key (NODE_AUTH_TOKEN=..., api_key: ...).
  { re: /([\w-]*(?:token|password|secret|api[_-]?key)\s*[:=]\s*)\S+/gi, mask: '$1***' },
];

/** Scrub token-shaped substrings from captured stderr before it is recorded. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, mask } of SECRET_PATTERNS) out = out.replace(re, mask);
  return out;
}

/**
 * Reduce one raw output stream (stderr or stdout) to its recordable tail: the
 * last OUTPUT_TAIL_LINES lines, secret-redacted, then byte-capped from the end
 * (the end is where package managers print their error summary).
 *
 * @param output the raw stderr or stdout of the failed install.
 * @returns the redacted, truncated tail; empty string for empty input.
 */
export function outputTail(output: string): string {
  const lines = output.split('\n');
  const tail = lines.slice(-OUTPUT_TAIL_LINES).join('\n').trimEnd();
  const redacted = redactSecrets(tail);
  if (Buffer.byteLength(redacted, 'utf8') <= OUTPUT_TAIL_MAX_BYTES) return redacted;
  const buf = Buffer.from(redacted, 'utf8');
  return buf.subarray(buf.length - OUTPUT_TAIL_MAX_BYTES).toString('utf8');
}

/** Ordered bucket matchers. First hit wins, so the more specific tells sit
 *  above the ones their stderr often also contains (a node-gyp failure runs
 *  inside a postinstall lifecycle; an engines refusal mentions the registry). */
const BUCKET_MATCHERS: ReadonlyArray<{ bucket: InstallFailureBucket; re: RegExp }> = [
  { bucket: 'disk-or-timeout', re: /ENOSPC|no space left on device|disk quota exceeded/i },
  {
    // npm ran in a directory with no package.json (the 27/27 signature the B1
    // instrumentation measured on 2026-07-26: manifest lives in a subdirectory).
    // Post-discovery this only fires on a genuinely manifest-less tree.
    bucket: 'no-manifest-found',
    re: /enoent Could not read package\.json|Could not read package\.json: Error: ENOENT/i,
  },
  {
    bucket: 'engines-mismatch',
    re: /npm (?:ERR!|error) code EBADENGINE|ERR_PNPM_UNSUPPORTED_ENGINE|The engine "node" is incompatible|Your Node version is incompatible|The current Node version [^\n]+ does not satisfy/,
  },
  {
    bucket: 'workspace-protocol',
    re: /EUNSUPPORTEDPROTOCOL|Unsupported URL Type "workspace:|Workspace not found|ERR_PNPM_[A-Z_]*WORKSPACE/,
  },
  {
    bucket: 'peer-dep-conflict',
    re: /ERESOLVE|unable to resolve dependency tree|Conflicting peer dependency|ERR_PNPM_PEER_DEP_ISSUES/,
  },
  {
    bucket: 'native-build',
    re: /gyp ERR!|node-gyp|node-pre-gyp|prebuild-install|make: \*\*\*|error: command '(?:gcc|g\+\+|cc|clang)|fatal error: [^\n]*\.h|cc1plus/,
  },
  {
    bucket: 'lifecycle-script',
    re: /ELIFECYCLE|npm (?:ERR!|error) command sh -c|(?:postinstall|preinstall|prepare) script failed|error running (?:postinstall|preinstall|prepare)|YN0009/i,
  },
  {
    bucket: 'registry-or-network',
    // YN0035 is yarn berry's remote-server failure (404/401/timeouts, printed
    // on stdout); the `registry...: Not found` shape is yarn classic's 404.
    re: /E404|E401|E403|E429|EINTEGRITY|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPROTO\b|socket hang up|getaddrinfo|ERR_PNPM_FETCH|ERR_PNPM_REGISTRIES|404 Not Found|401 Unauthorized|403 Forbidden|fetch failed|YN0035|https?:\/\/registry\.[\w.-]+\/\S*: Not found/i,
  },
];

/**
 * Bucket one install failure from its captured evidence. Pure and deterministic:
 * the same evidence always yields the same bucket, so a committed record can be
 * re-derived. A guarded-runner timeout is `disk-or-timeout` regardless of what
 * the output says (the kill truncates it mid-write); everything else is matched
 * against the stderr tail plus the stdout tail (when captured; corepack yarn
 * errors on stdout) in specificity order. Records written before `stdoutTail`
 * existed classify exactly as they did at record time.
 *
 * @param evidence the captured failure evidence.
 * @returns the first matching bucket, or `other`.
 */
export function classifyInstallFailure(evidence: InstallFailureEvidence): InstallFailureBucket {
  if (evidence.timedOut) return 'disk-or-timeout';
  const haystack =
    evidence.stdoutTail === undefined
      ? evidence.stderrTail
      : `${evidence.stderrTail}\n${evidence.stdoutTail}`;
  for (const { bucket, re } of BUCKET_MATCHERS) {
    if (re.test(haystack)) return bucket;
  }
  return 'other';
}

/** The install context the throw site knows and the failed child does not. */
export interface InstallFailureContext {
  readonly packageManager: string;
  readonly lockfile: string | null;
  readonly nodeEngineRange: string | null;
}

/**
 * Build the full failure record from a guarded-run error and the install
 * context: extract exit code, timeout flag, and the redacted stderr tail, then
 * classify. Tolerates a non-Error throw (records what it can).
 *
 * @param err the error the guarded runner (or spawn) threw.
 * @param ctx the manager, lockfile, and engine range the caller detected.
 * @returns the evidence plus its bucket, ready for the funnel record.
 */
export function captureInstallFailure(err: unknown, ctx: InstallFailureContext): InstallFailureRecord {
  const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
  const stdout = err instanceof Error && 'stdout' in err ? String((err as { stdout: unknown }).stdout) : '';
  const status = err instanceof Error && 'status' in err ? (err as { status: unknown }).status : null;
  const stdoutTail = outputTail(stdout);
  const evidence: InstallFailureEvidence = {
    packageManager: ctx.packageManager,
    exitCode: typeof status === 'number' ? status : null,
    timedOut: isGuardedTimeout(err),
    stderrTail: outputTail(stderr),
    ...(stdoutTail.length > 0 ? { stdoutTail } : {}),
    lockfile: ctx.lockfile,
    nodeEngineRange: ctx.nodeEngineRange,
  };
  return { ...evidence, bucket: classifyInstallFailure(evidence) };
}

/** The `sandbox-install-failed` error, now carrying its structured evidence so
 *  the execution-grounded layer can surface the failure into funnel records and
 *  EG sidecars instead of collapsing it to a one-line reason. Code, message,
 *  remediation, and cause are unchanged from the plain SwarmError it replaces. */
export class SandboxInstallError extends SwarmError {
  readonly installFailure: InstallFailureRecord;

  constructor(
    message: string,
    options: { remediation: string; cause: unknown; installFailure: InstallFailureRecord },
  ) {
    super(message, 'sandbox-install-failed', {
      remediation: options.remediation,
      cause: options.cause,
    });
    this.installFailure = options.installFailure;
  }
}

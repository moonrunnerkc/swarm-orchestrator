// The execution-grounded checks run real-world repo test suites, which target
// the Node versions those repos support (the corpus repos pin Node 20/22), not
// necessarily the Node the auditor itself runs under. SWARM_EG_NODE_BIN points
// at a bin directory (e.g. a Node 20 install) whose node/npm/npx the child
// processes should use; when unset, the ambient toolchain is used. Centralized
// here so every shelled-out command in this surface resolves the same way.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'child_process';
import * as path from 'path';
import { buildDockerRunArgs, type DockerContext } from './docker-runner';

/** Resolve a toolchain binary (node/npm/npx) to the pinned Node bin dir when
 *  SWARM_EG_NODE_BIN is set, otherwise to the bare name (ambient PATH). */
export function execBin(name: string): string {
  const dir = process.env.SWARM_EG_NODE_BIN;
  return dir !== undefined && dir.length > 0 ? path.join(dir, name) : name;
}

/** Headless / non-interactive forcing for every sandboxed child process.
 *  Real repo suites (tldraw, vite, next.js, ...) use vitest browser mode,
 *  Playwright, or Cypress, which pop up real browser windows when run headed.
 *
 *  CI=true is the master switch (Playwright and vitest browser default to
 *  headless under CI, dev servers do not open a browser, watch modes are off),
 *  but it is not enough: a repo whose own test code calls `chromium.launch()`
 *  with an explicit headed option (next.js integration tests do this) ignores
 *  it. So we also make the browser binaries un-launchable -- PLAYWRIGHT_BROWSERS_PATH
 *  points at a path with no browsers, and PUPPETEER_EXECUTABLE_PATH at a binary
 *  that exits immediately. Any launch attempt then fails closed (the test
 *  errors, the run is recorded as a skip) instead of opening a window on the
 *  auditor's desktop. Browser-driven tests are not the changed-line coverage
 *  signal we are after, so failing them closed costs nothing here. */
const NO_BROWSERS_PATH = '/tmp/swarm-eg-no-browsers';
const HEADLESS_ENV: NodeJS.ProcessEnv = {
  CI: 'true',
  BROWSER: 'none',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  PLAYWRIGHT_HTML_OPEN: 'never',
  PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS_PATH,
  PUPPETEER_EXECUTABLE_PATH: '/usr/bin/false',
  PUPPETEER_SKIP_DOWNLOAD: '1',
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
  CYPRESS_INSTALL_BINARY: '0',
  npm_config_yes: 'true',
};

// Deny-by-default: the sandbox runs `npm ci` (untrusted postinstall scripts)
// and the PR's own test suite. Inheriting the auditor's full environment hands
// that attacker-controlled code every host secret -- ANTHROPIC_API_KEY,
// GITHUB_TOKEN, OPENAI_API_KEY, and anything else. So the child sees only the
// variables a package manager and test runner actually need to function;
// everything else, including a secret whose name does not match any pattern
// (GH_PAT, DATABASE_URL), is dropped because it is simply not on this list.
// An operator who needs a specific host var (a registry proxy, a custom CA)
// names it in SWARM_EG_ENV_PASSTHROUGH. PATH is rebuilt separately to pin the
// toolchain, so it is intentionally absent here.
const ENV_ALLOWLIST: readonly string[] = [
  'HOME', // npm/git/corepack resolve ~/.npmrc, ~/.gitconfig, and their caches from here
  'TMPDIR',
  'TEMP',
  'TMP', // scratch dirs the toolchain writes to
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ', // locale and timezone, or some tools warn or mis-sort
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'HOSTNAME', // benign identity/tty, kept so shims that read them do not break
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR', // custom trust roots for TLS during install
];

/** Host variable names the operator has opted to pass through to the sandbox,
 *  from the comma-separated `SWARM_EG_ENV_PASSTHROUGH`. This is the only way a
 *  credential reaches the child: an operator who, for example, audits private
 *  PRs and needs `GITHUB_TOKEN` for the clone lists it explicitly and accepts
 *  the exposure. Empty when the variable is unset. */
function passthroughNames(): readonly string[] {
  const raw = process.env.SWARM_EG_ENV_PASSTHROUGH;
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** Build the child-process environment for a sandboxed command: a deny-by-default
 *  allowlist of host vars (plus any named in `SWARM_EG_ENV_PASSTHROUGH`),
 *  headless/non-interactive forcing, the pinned Node bin dir prepended to a
 *  PATH we control, and an optional package-manager cache override. The
 *  auditor's API keys and other secrets are never copied unless passed through. */
export function execEnv(cacheDir?: string): NodeJS.ProcessEnv {
  const allowed = new Set<string>(ENV_ALLOWLIST);
  for (const name of passthroughNames()) allowed.add(name);

  const env: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  // Headless/non-interactive forcing always wins over anything passed through.
  Object.assign(env, HEADLESS_ENV);

  const dir = process.env.SWARM_EG_NODE_BIN;
  const basePath = process.env.PATH ?? '';
  env.PATH = dir !== undefined && dir.length > 0 ? `${dir}${path.delimiter}${basePath}` : basePath;
  if (cacheDir !== undefined) env.npm_config_cache = cacheDir;
  return env;
}

/** Environment to inject into a docker sandbox container via `-e`. The host
 *  PATH/HOME/cache are intentionally absent: the image provides its own. Only
 *  the headless forcing and the operator's explicit passthrough vars cross the
 *  boundary, so the container's behavior matches the host run without leaking
 *  host paths or secrets. */
export function dockerInjectEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of passthroughNames()) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [key, value] of Object.entries(HEADLESS_ENV)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Fallback per-command wall-clock cap when neither the caller nor the
 *  environment names one: five minutes. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Resolve the wall-clock cap for one sandboxed command. An explicit positive
 *  budget from the caller wins (mutation and coverage deliberately allow more
 *  than the default); otherwise SWARM_EG_COMMAND_TIMEOUT_MS overrides the
 *  five-minute fallback. */
export function commandTimeoutMs(explicit?: number): number {
  if (explicit !== undefined && explicit > 0) return explicit;
  const raw = process.env.SWARM_EG_COMMAND_TIMEOUT_MS;
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COMMAND_TIMEOUT_MS;
}

export interface GuardedRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Wall-clock cap. Falls back to commandTimeoutMs() when omitted. */
  timeoutMs?: number;
  /** Capture and return stdout. Off by default: installs and test suites emit
   *  megabytes of stdout we do not read, so ignoring it avoids the buffer. */
  captureStdout?: boolean;
  maxBuffer?: number;
  /** When set, run the command inside this container instead of on the host,
   *  with `cwd` bind-mounted. The host PATH/HOME are not forwarded; only the
   *  headless and passthrough env cross into the container (dockerInjectEnv).
   *  The host-side `env` is then used only to locate the docker CLI. */
  docker?: DockerContext;
}

/** Error thrown by execFileGuarded. Mirrors the fields execFileSync attaches to
 *  its thrown error (`status`, `signal`, `stdout`, `stderr`) so existing
 *  classifiers keep working, and adds `timedOut` so callers do not have to
 *  sniff the signal. */
export interface GuardedRunError extends Error {
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  status: number | null;
  stdout: string;
  stderr: string;
}

/** True when an error from execFileGuarded was caused by the timeout. */
export function isGuardedTimeout(err: unknown): boolean {
  return err instanceof Error && (err as Partial<GuardedRunError>).timedOut === true;
}

function guardedError(
  message: string,
  fields: { timedOut: boolean; signal: NodeJS.Signals | null; status: number | null; stdout: string; stderr: string },
): GuardedRunError {
  return Object.assign(new Error(message), fields) as GuardedRunError;
}

/**
 * Run one untrusted sandbox command (install, build, mutation, coverage, test)
 * in its own process group under a wall-clock cap. spawnSync's own timeout only
 * signals the direct child; a test that forked a dev server or a build daemon
 * leaves that grandchild running, which is how a hung suite wedges CI. So we
 * spawn detached (the child leads a new process group) and, on timeout, send
 * SIGKILL to the whole group. Returns stdout (empty unless captureStdout);
 * throws a GuardedRunError carrying stderr, the exit signal, and a timedOut
 * flag on any non-zero exit, spawn failure, or timeout.
 */
export function execFileGuarded(bin: string, args: readonly string[], opts: GuardedRunOptions): string {
  if (opts.docker !== undefined) {
    const hasIds = process.platform !== 'win32' && typeof process.getuid === 'function' && typeof process.getgid === 'function';
    const user = hasIds ? `${process.getuid!()}:${process.getgid!()}` : undefined;
    const dockerArgs = buildDockerRunArgs({
      image: opts.docker.image,
      network: opts.docker.network,
      checkoutDir: opts.cwd,
      workdir: opts.cwd,
      env: dockerInjectEnv(),
      ...(user !== undefined ? { user } : {}),
      bin,
      args,
    });
    // The docker CLI runs on the host and only needs PATH to be found. The
    // sandbox env was injected into the container above, not here.
    return spawnGuarded('docker', dockerArgs, {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.captureStdout !== undefined ? { captureStdout: opts.captureStdout } : {}),
      ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}),
    });
  }
  return spawnGuarded(bin, args, opts);
}

function spawnGuarded(
  bin: string,
  args: readonly string[],
  opts: Omit<GuardedRunOptions, 'docker'>,
): string {
  const timeout = commandTimeoutMs(opts.timeoutMs);
  const ownGroup = process.platform !== 'win32';
  // `detached` puts the child in its own process group so the on-timeout
  // SIGKILL below can target the group. spawnSync honors it at runtime, but the
  // Node types only declare it on async spawn, hence the explicit widening.
  const spawnOpts: SpawnSyncOptionsWithStringEncoding & { detached?: boolean } = {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', opts.captureStdout === true ? 'pipe' : 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGTERM',
    detached: ownGroup,
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
  };
  const res = spawnSync(bin, args, spawnOpts);
  const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (timedOut && ownGroup && res.pid !== undefined) {
    try {
      process.kill(-res.pid, 'SIGKILL');
    } catch {
      // The group already exited between the timeout and this reap; nothing to do.
    }
  }
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  if (timedOut) {
    throw guardedError(`sandbox command timed out after ${timeout}ms: ${bin} ${args.join(' ')}`, {
      timedOut: true,
      signal: res.signal ?? null,
      status: null,
      stdout,
      stderr,
    });
  }
  if (res.error !== undefined) {
    throw guardedError(`failed to run ${bin}: ${res.error.message}`, {
      timedOut: false,
      signal: res.signal ?? null,
      status: res.status,
      stdout,
      stderr,
    });
  }
  if (res.status !== 0) {
    throw guardedError(`${bin} exited with status ${res.status ?? 'null'}`, {
      timedOut: false,
      signal: res.signal ?? null,
      status: res.status,
      stdout,
      stderr,
    });
  }
  return stdout;
}

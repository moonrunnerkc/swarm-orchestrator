// The execution-grounded checks run real-world repo test suites, which target
// the Node versions those repos support (the corpus repos pin Node 20/22), not
// necessarily the Node the auditor itself runs under. SWARM_EG_NODE_BIN points
// at a bin directory (e.g. a Node 20 install) whose node/npm/npx the child
// processes should use; when unset, the ambient toolchain is used. Centralized
// here so every shelled-out command in this surface resolves the same way.

import * as path from 'path';

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

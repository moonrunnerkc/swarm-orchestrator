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

/** Build the child-process environment: the pinned Node bin dir prepended to
 *  PATH, headless/non-interactive forcing, plus an optional package-manager
 *  cache override. */
export function execEnv(cacheDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...HEADLESS_ENV };
  const dir = process.env.SWARM_EG_NODE_BIN;
  if (dir !== undefined && dir.length > 0) {
    env.PATH = `${dir}${path.delimiter}${env.PATH ?? ''}`;
  }
  if (cacheDir !== undefined) env.npm_config_cache = cacheDir;
  return env;
}

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

/** Build the child-process environment: the pinned Node bin dir prepended to
 *  PATH, plus an optional package-manager cache override. */
export function execEnv(cacheDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const dir = process.env.SWARM_EG_NODE_BIN;
  if (dir !== undefined && dir.length > 0) {
    env.PATH = `${dir}${path.delimiter}${env.PATH ?? ''}`;
  }
  if (cacheDir !== undefined) env.npm_config_cache = cacheDir;
  return env;
}

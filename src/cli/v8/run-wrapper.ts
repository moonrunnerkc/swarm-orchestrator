import * as path from 'path';
import { getLogger } from '../../logger';
import { handleCompile } from './compile-handler';
import { handleRun } from './run-handler';
import { LOCAL_PROVIDER_FLAG_TOKENS } from './local-provider-flags';
import { findContractFile } from '../../contract/auto-discover';

const logger = getLogger('cli:v8:run-wrapper');

/**
 * Test seam: the wrapper delegates `compile` and `run` through this object
 * so unit tests can substitute fakes without spawning the real handlers.
 * Production callers pass nothing; the defaults wire to the real
 * `handleCompile` / `handleRun`.
 */
interface RunV8Deps {
  readonly handleCompile: (argv: string[]) => Promise<number>;
  readonly handleRun: (argv: string[]) => Promise<number>;
}

const DEFAULT_DEPS: RunV8Deps = { handleCompile, handleRun };

/**
 * Entry point for `swarm run`. v8 is now the only path; v6 was removed
 * in v9.0.0.
 *
 * The wrapper reads a `--goal "..."` flag, runs `swarm v8 compile` on it
 * (deterministic extractor by default; `--extractor` selects), writes the
 * contract to a temp directory under `.swarm/contracts/`, then runs
 * `swarm v8 run <contract>`. Other flags pass through to the run step.
 *
 * Exit codes are the union of compile and run:
 *   0 — every obligation satisfied
 *   1 — flag parsing or compile/runtime error
 *   2 — at least one obligation failed verification
 *   3 — missing API key for the default session
 *   4 — ledger chain tampered (resume only; not raised here)
 *   5 — resume preconditions not met (not raised here)
 *   6 — cost cap exceeded (--cost-cap)
 *
 * @param argv arguments AFTER the literal `run` token. The wrapper picks
 *   off `--goal`, `--extractor`, `--api-key`, `--model`, `--temperature`,
 *   `--repo-root`, `--out` for the compile pass; remaining flags go to
 *   the run pass. The convenience pass-throughs (`--session`,
 *   `--no-deterministic`, etc.) are recognized as v8-run flags.
 */
export async function handleRunV8(
  argv: string[],
  deps: RunV8Deps = DEFAULT_DEPS,
): Promise<number> {
  const split = splitArgv(argv);

  if (split.goal === null) {
    logger.error('swarm run: missing --goal "<description>".');
    return 1;
  }

  const repoRoot = split.repoRoot ?? process.cwd();
  const contractsParent = path.join(repoRoot, '.swarm', 'contracts');

  // Compile writes to <repo>/.swarm/contracts/<contract-id>/ when --out is
  // omitted (compile-handler.ts:101). Re-discover the contract dir by mtime
  // after compile so the wrapper doesn't depend on parsing the compile log.
  const compileArgv: string[] = [
    split.goal,
    '--repo-root',
    repoRoot,
    '--yes',
    '--no-editor',
  ];
  if (split.extractor !== null) compileArgv.push('--extractor', split.extractor);
  if (split.apiKey !== null) compileArgv.push('--api-key', split.apiKey);
  if (split.model !== null) compileArgv.push('--model', split.model);
  if (split.temperature !== null) compileArgv.push('--temperature', String(split.temperature));
  if (split.contractFile !== null) compileArgv.push('--contract-file', split.contractFile);
  if (split.contractModule !== null) compileArgv.push('--contract-module', split.contractModule);
  // Local-provider flags are shared by both compile (extractor) and run
  // (session). The wrapper forwards them to both passes so a single
  // `swarm run --goal "..." --extractor local --local-backend ollama
  // --local-base-url <url>` invocation configures both stages without
  // requiring env-var fallback.
  compileArgv.push(...split.compilePassthrough);

  // The compile step writes to `<out>/<contract-id>/`. We re-derive the
  // path from the manifest immediately after compile.
  const compileExit = await deps.handleCompile(compileArgv);
  if (compileExit !== 0) return compileExit;

  const contractDir = findLatestContractDir(contractsParent);
  if (contractDir === null) {
    logger.error(`expected contract directory under ${contractsParent} after compile`);
    return 1;
  }

  const runArgv: string[] = [contractDir, '--repo-root', repoRoot, ...split.runPassthrough];
  return deps.handleRun(runArgv);
}

/**
 * Test-only re-exports of the internal helpers. The names are prefixed
 * with `__` so that consumers reading public API surface skip them; the
 * runtime values are the same functions used internally.
 */
export const __testing = {
  splitArgv: (argv: string[]) => splitArgv(argv),
  findLatestContractDir: (parent: string) => findLatestContractDir(parent),
  requireValue: (argv: string[], index: number, flag: string) => requireValue(argv, index, flag),
};

interface SplitArgv {
  goal: string | null;
  repoRoot: string | null;
  extractor: string | null;
  apiKey: string | null;
  model: string | null;
  temperature: number | null;
  contractFile: string | null;
  contractModule: string | null;
  /** Flags forwarded to the compile pass (in addition to the named fields). */
  compilePassthrough: string[];
  runPassthrough: string[];
}

/**
 * Walk the wrapper's argv. Recognized compile-relevant flags are pulled
 * out; everything else passes through to the run step. Unknown flags
 * raise at the run step's parser, not here, so the user sees one
 * authoritative error message rather than two.
 */
function splitArgv(argv: string[]): SplitArgv {
  const out: SplitArgv = {
    goal: null,
    repoRoot: null,
    extractor: null,
    apiKey: null,
    model: null,
    temperature: null,
    contractFile: null,
    contractModule: null,
    compilePassthrough: [],
    runPassthrough: [],
  };
  const localTokens: ReadonlySet<string> = new Set(LOCAL_PROVIDER_FLAG_TOKENS);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--goal') {
      out.goal = requireValue(argv, ++i, '--goal');
    } else if (arg === '--repo-root') {
      out.repoRoot = requireValue(argv, ++i, '--repo-root');
      // pass through too: the run step also wants it
      out.runPassthrough.push('--repo-root', out.repoRoot);
    } else if (arg === '--extractor') {
      out.extractor = requireValue(argv, ++i, '--extractor');
    } else if (arg === '--api-key') {
      out.apiKey = requireValue(argv, ++i, '--api-key');
      // pass through to run too
      out.runPassthrough.push('--api-key', out.apiKey);
    } else if (arg === '--model') {
      out.model = requireValue(argv, ++i, '--model');
      out.runPassthrough.push('--model', out.model);
    } else if (arg === '--temperature') {
      const raw = requireValue(argv, ++i, '--temperature');
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`invalid --temperature "${raw}"; must be a number`);
      }
      out.temperature = n;
    } else if (arg === '--contract-file') {
      out.contractFile = requireValue(argv, ++i, '--contract-file');
    } else if (arg === '--contract-module') {
      out.contractModule = requireValue(argv, ++i, '--contract-module');
    } else if (arg === '--preset') {
      const value = requireValue(argv, ++i, '--preset');
      // Presets only affect the run-phase pipeline (falsifiers, streaming,
      // pre-generation, post-merge). Contract compilation is preset-agnostic.
      out.runPassthrough.push('--preset', value);
    } else if (localTokens.has(arg)) {
      // `--local-*` flags configure either the extractor (compile pass) or
      // the session (run pass). Both handlers accept the full local-flag
      // schema, so the wrapper forwards every local flag to both passes;
      // each side reads the fields relevant to it and ignores the rest.
      const value = requireValue(argv, ++i, arg);
      out.compilePassthrough.push(arg, value);
      out.runPassthrough.push(arg, value);
    } else {
      out.runPassthrough.push(arg);
    }
  }
  // Auto-detect contract file when --contract-file not provided
  if (out.contractFile === null) {
    const detected = findContractFile(process.cwd());
    if (detected !== undefined) {
      out.contractFile = detected;
    }
  }
  return out;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return v;
}

/**
 * Find the most recently created contract directory under `parent`.
 * Uses manifest.json mtime when available, falling back to directory mtime.
 * Manifest mtime is more stable because the directory mtime changes on any
 * nested file modification.
 */
function findLatestContractDir(parent: string): string | null {
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(parent)) return null;
  const entries = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parent, e.name));
  if (entries.length === 0) return null;
  let latest = entries[0] ?? '';
  let latestMtime = 0;
  for (const dir of entries) {
    const manifestPath = path.join(dir, 'manifest.json');
    let mt: number;
    try {
      mt = fs.statSync(manifestPath).mtimeMs;
    } catch {
      mt = fs.statSync(dir).mtimeMs;
    }
    if (mt > latestMtime) {
      latestMtime = mt;
      latest = dir;
    }
  }
  return latest;
}

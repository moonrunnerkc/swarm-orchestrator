#!/usr/bin/env node
/**
 * Provider-comparison benchmark harness.
 *
 * Compiles a contract for a fixture goal and runs it through the
 * orchestrator end-to-end against a chosen extractor / session
 * provider, recording a side-by-side report of the metrics that matter
 * for provider comparison:
 *
 *   - contractHash equality (proves deterministic compilation under
 *     the deterministic extractor; varies under non-deterministic
 *     extractors so the field is informational there)
 *   - satisfied / failed counts from the run result
 *   - wall-clock time
 *   - total usage (input / output / cache-read / cache-write tokens)
 *
 * The harness wires both the `--extractor` and `--session` flags
 * through the same `buildExtractor` / `buildSession` factories the v8
 * CLI handlers use; `--compare-providers` runs the same fixture
 * through all three providers sequentially and writes a Markdown table.
 *
 * The harness is intentionally script-shaped, not a library. It is
 * invoked by hand or by CI; it does not register with any test runner.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleRun } from '../../src/cli/v8/run-handler';
import { LOCAL_PROVIDER_FLAG_TOKENS } from '../../src/cli/v8/local-provider-flags';
import { readContract } from '../../src/contract/serializer';

interface ProviderResult {
  extractor: string;
  session: string;
  contractHash: string;
  satisfied: number;
  failed: number;
  wallTimeMs: number;
  tokens: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
  };
  exitCode: number;
}

const FIXTURE_GOAL = 'verify the repo test command exits zero';
const FIXTURE_CONTRACT = [
  'obligations:',
  '  - type: build-must-pass',
  '    command: npm run build',
  '  - type: test-must-pass',
  '    command: npm test',
  '',
].join('\n');

interface HarnessOptions {
  outDir: string;
  extractor: string | null;
  session: string | null;
  compareProviders: boolean;
  passthrough: string[];
}

function parseArgs(argv: string[]): HarnessOptions {
  const opts: HarnessOptions = {
    outDir: path.join(process.cwd(), 'benchmarks', 'provider-bench', 'out'),
    extractor: null,
    session: null,
    compareProviders: false,
    passthrough: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (LOCAL_PROVIDER_FLAG_TOKENS.includes(arg)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`flag ${arg} requires a value`);
      opts.passthrough.push(arg, v);
    } else if (arg === '--extractor') {
      opts.extractor = argv[++i] ?? null;
    } else if (arg === '--session') {
      opts.session = argv[++i] ?? null;
    } else if (arg === '--compare-providers') {
      opts.compareProviders = true;
    } else if (arg === '--out') {
      opts.outDir = argv[++i] ?? opts.outDir;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return opts;
}

function printUsage(): void {
  process.stdout.write(
    [
      'usage: node benchmarks/provider-bench/provider-bench.js [flags]',
      '',
      'flags:',
      '  --extractor <name>     deterministic | local | anthropic',
      '  --session <name>       deterministic | local | anthropic',
      '  --compare-providers    run all three providers sequentially',
      '  --out <dir>            output directory (default benchmarks/provider-bench/out)',
      '  --local-*              forwarded verbatim to compile + run',
      '  --help                 show this message',
      '',
    ].join('\n'),
  );
}

async function runOnce(
  extractor: string,
  session: string,
  opts: HarnessOptions,
): Promise<ProviderResult> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-bench-'));
  fs.writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify(
      {
        name: 'provider-bench-fixture',
        private: true,
        scripts: { build: 'true', test: 'true' },
      },
      null,
      2,
    ),
  );
  const contractDir = path.join(work, 'contract');
  const contractPath = path.join(work, 'contract.yaml');
  fs.writeFileSync(contractPath, FIXTURE_CONTRACT);
  const resultPath = path.join(work, 'result.json');
  const ledgerPath = path.join(work, 'ledger.jsonl');
  const queuePath = path.join(work, 'patches.jsonl');
  fs.writeFileSync(queuePath, '');

  const compileArgs = [
    FIXTURE_GOAL,
    '--repo-root', work,
    '--out', contractDir,
    '--extractor', extractor,
    '--contract-file', contractPath,
    '--yes',
    '--no-editor',
    ...opts.passthrough,
  ];
  const runArgs = [
    contractDir,
    '--repo-root', work,
    '--session', session,
    '--external-patches-queue', queuePath,
    '--ledger', ledgerPath,
    '--result', resultPath,
    '--no-streaming',
    '--no-post-merge',
    '--falsifiers', 'off',
    ...opts.passthrough,
  ];

  const t0 = Date.now();
  const compileExit = await handleCompile(compileArgs);
  if (compileExit !== 0) {
    return blankResult(extractor, session, Date.now() - t0, compileExit);
  }
  const runExit = await handleRun(runArgs);
  const wallTimeMs = Date.now() - t0;

  const contract = readContract(contractDir);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
    satisfied: number;
    failed: number;
    totalUsage: ProviderResult['tokens'];
  };

  return {
    extractor,
    session,
    contractHash: contract.manifest.contractHash,
    satisfied: result.satisfied,
    failed: result.failed,
    wallTimeMs,
    tokens: result.totalUsage,
    exitCode: runExit,
  };
}

function blankResult(
  extractor: string,
  session: string,
  wallTimeMs: number,
  exitCode: number,
): ProviderResult {
  return {
    extractor,
    session,
    contractHash: '',
    satisfied: 0,
    failed: 0,
    wallTimeMs,
    tokens: { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 },
    exitCode,
  };
}

function writeReport(outDir: string, results: ProviderResult[]): string {
  fs.mkdirSync(outDir, { recursive: true });
  const md = [
    '# Provider comparison report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Extractor | Session | Contract hash | Satisfied | Failed | Wall ms | Input | Cache-read | Cache-write | Output | Exit |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.map(
      (r) =>
        `| ${r.extractor} | ${r.session} | \`${r.contractHash.slice(0, 12)}\` | ${r.satisfied} | ${r.failed} | ${r.wallTimeMs} | ${r.tokens.inputTokens} | ${r.tokens.cacheReadTokens} | ${r.tokens.cacheCreationTokens} | ${r.tokens.outputTokens} | ${r.exitCode} |`,
    ),
    '',
  ].join('\n');
  const path1 = path.join(outDir, 'report.md');
  fs.writeFileSync(path1, md);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  return path1;
}

async function main(argv: string[]): Promise<number> {
  let opts: HarnessOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    printUsage();
    return 1;
  }
  const results: ProviderResult[] = [];
  const PROVIDERS = ['deterministic', 'local', 'anthropic'] as const;

  if (opts.compareProviders) {
    for (const p of PROVIDERS) {
      try {
        results.push(await runOnce(p, p, opts));
      } catch (err) {
        process.stderr.write(`provider ${p} failed: ${(err as Error).message}\n`);
      }
    }
  } else {
    const extractor = opts.extractor ?? 'deterministic';
    const session = opts.session ?? 'deterministic';
    results.push(await runOnce(extractor, session, opts));
  }
  const reportPath = writeReport(opts.outDir, results);
  process.stdout.write(`report written: ${reportPath}\n`);
  return 0;
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { main, parseArgs, runOnce };

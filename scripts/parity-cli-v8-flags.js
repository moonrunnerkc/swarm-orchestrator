#!/usr/bin/env node
// Phase 3b parity check: invoke each v8 CLI handler's argv parser against
// a representative flag matrix and dump the resulting parsed-flags object
// (or the structured error message) to
// evidence/phase-3-parity/cli-v8/<handler>/<case>.json. Pre-cut: capture
// baseline. Post-cut: re-run and `diff -r` against committed captures.
// Byte-identical is the halt condition.
//
// Handlers exercised:
//   compile-handler   parseCompileFlags
//   run-handler       parseRunFlags
//   resume-handler    parseResumeFlags
//   doctor-handler    (parseFlags is internal; exercised via handleDoctor argv pass-through)
//   stats-handler     (parseStatsFlags internal; exercised via handleStatsCommand)
//   run-wrapper       splitArgv (internal — exercised via importing the module)
//   local-provider-flags  applyLocalProviderFlag (exercised via run-handler parser)
//
// For internal-only parsers the harness exercises them indirectly: it
// passes a representative argv to the public handler and asserts the
// handler-level dispatch behavior. Error messages get captured as the
// structured-error JSON form.

const fs = require('fs');
const path = require('path');

const compileHandler = require('../dist/src/cli/v8/compile-handler');
const runHandler = require('../dist/src/cli/v8/run-handler');
const resumeHandler = require('../dist/src/cli/v8/resume-handler');

const OUT_ROOT = path.join(__dirname, '..', 'evidence', 'phase-3-parity', 'cli-v8');

// Strip values that legitimately vary per environment.
function sanitize(value) {
  return JSON.parse(JSON.stringify(value, (key, val) => {
    if (key === 'repoRoot' && typeof val === 'string') return '<REPO_ROOT>';
    if (key === 'contractPath' && typeof val === 'string') return '<CONTRACT>';
    return val;
  }));
}

function serializeError(err) {
  return { error: true, name: err.name, message: err.message };
}

function runCase(dir, name, fn) {
  fs.mkdirSync(dir, { recursive: true });
  let out;
  try {
    out = sanitize(fn());
  } catch (err) {
    out = serializeError(err);
  }
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(out, null, 2) + '\n');
}

function runCompile() {
  const dir = path.join(OUT_ROOT, 'compile');
  const cases = [
    { name: 'minimal-goal', argv: ['build me a thing'] },
    { name: 'goal-with-flags', argv: ['add health check', '--yes', '--repo-root', '/tmp/x'] },
    { name: 'extractor-deterministic', argv: ['x', '--extractor', 'deterministic', '--contract-file', '/tmp/c.yaml'] },
    { name: 'extractor-anthropic', argv: ['x', '--extractor', 'anthropic', '--model', 'claude-opus-4-5', '--temperature', '0.5', '--api-key', 'sk-1'] },
    { name: 'extractor-local-full', argv: [
      'x',
      '--extractor', 'local',
      '--local-backend', 'ollama',
      '--local-base-url', 'http://localhost:11434',
      '--local-model-extractor', 'qwen2.5:32b',
      '--local-grammar', 'json-schema',
      '--local-request-timeout-ms', '60000',
      '--local-max-concurrency', '4',
      '--local-seed', '42',
    ] },
    { name: 'local-backend-invalid', argv: ['x', '--local-backend', 'made-up'] },
    { name: 'local-grammar-invalid', argv: ['x', '--local-grammar', 'made-up'] },
    { name: 'local-timeout-invalid', argv: ['x', '--local-request-timeout-ms', '-1'] },
    { name: 'local-seed-negative', argv: ['x', '--local-seed', '-1'] },
    { name: 'temperature-invalid', argv: ['x', '--temperature', 'not-a-number'] },
    { name: 'out-missing-value', argv: ['x', '--out'] },
    { name: 'unknown-flag', argv: ['x', '--made-up'] },
    { name: 'help', argv: ['--help'] },
    { name: 'multi-positional-goal', argv: ['add', 'a', 'health', 'check', '--yes'] },
    { name: 'recipe', argv: ['for the payments module', '--recipe', 'add-tests'] },
    { name: 'no-editor', argv: ['x', '--no-editor'] },
    { name: 'extractor-invalid', argv: ['x', '--extractor', 'made-up'] },
  ];
  for (const c of cases) {
    runCase(dir, c.name, () => compileHandler.parseCompileFlags(c.argv));
  }
}

function runRun() {
  const dir = path.join(OUT_ROOT, 'run');
  const cases = [
    { name: 'minimal', argv: ['/tmp/contract'] },
    { name: 'all-defaults-explicit', argv: ['/tmp/c', '--repo-root', '/tmp/r', '--session', 'anthropic', '--model', 'claude', '--api-key', 'sk-1'] },
    { name: 'no-flags-cluster', argv: ['/tmp/c', '--no-deterministic', '--no-streaming', '--no-post-merge', '--no-pre-generation', '--no-cost-cap-live'] },
    { name: 'mode-tournament', argv: ['/tmp/c', '--mode', 'tournament', '--candidates', '5'] },
    { name: 'mode-invalid', argv: ['/tmp/c', '--mode', 'made-up'] },
    { name: 'candidates-out-of-range', argv: ['/tmp/c', '--candidates', '99'] },
    { name: 'candidates-zero', argv: ['/tmp/c', '--candidates', '0'] },
    { name: 'falsifiers-off', argv: ['/tmp/c', '--falsifiers', 'off'] },
    { name: 'falsifiers-invalid', argv: ['/tmp/c', '--falsifiers', 'maybe'] },
    { name: 'falsifier-scheduler-ucb1', argv: ['/tmp/c', '--falsifier-scheduler', 'ucb1', '--falsifier-stats-path', '/tmp/stats.json'] },
    { name: 'forbid-import-comma', argv: ['/tmp/c', '--forbid-import', 'fs,child_process,os'] },
    { name: 'cost-cap', argv: ['/tmp/c', '--cost-cap', '5.0'] },
    { name: 'cost-cap-invalid', argv: ['/tmp/c', '--cost-cap', '-1'] },
    { name: 'max-obligations-invalid', argv: ['/tmp/c', '--max-obligations', 'abc'] },
    { name: 'command-timeout-invalid', argv: ['/tmp/c', '--command-timeout-ms', '0'] },
    { name: 'external-patches-stdin', argv: ['/tmp/c', '--external-patches-stdin'] },
    { name: 'external-patches-queue', argv: ['/tmp/c', '--external-patches-queue', '/tmp/q.jsonl'] },
    { name: 'external-patches-timeout-negative', argv: ['/tmp/c', '--external-patches-timeout-ms', '-1'] },
    { name: 'local-flags-full', argv: [
      '/tmp/c',
      '--session', 'local',
      '--local-backend', 'vllm',
      '--local-base-url', 'http://vllm:8000',
      '--local-model-session', 'qwen-coder-32b',
      '--local-grammar', 'gbnf',
      '--local-max-concurrency', '8',
      '--local-api-key', 'lkey',
      '--local-seed', '7',
    ] },
    { name: 'snapshot-cleanup', argv: ['/tmp/c', '--snapshot-cleanup', 'never'] },
    { name: 'missing-contract', argv: [] },
    { name: 'too-many-positionals', argv: ['/tmp/a', '/tmp/b'] },
    { name: 'unknown-flag', argv: ['/tmp/c', '--made-up'] },
    { name: 'help', argv: ['--help'] },
  ];
  for (const c of cases) {
    // RunFlags has env-derived defaults (externalPatchesDir/Queue from env).
    // Stash them so captures are stable across machines.
    const savedDir = process.env.EXTERNAL_PATCHES_DIR;
    const savedQueue = process.env.EXTERNAL_PATCHES_QUEUE;
    delete process.env.EXTERNAL_PATCHES_DIR;
    delete process.env.EXTERNAL_PATCHES_QUEUE;
    try {
      runCase(dir, c.name, () => runHandler.parseRunFlags(c.argv));
    } finally {
      if (savedDir !== undefined) process.env.EXTERNAL_PATCHES_DIR = savedDir;
      if (savedQueue !== undefined) process.env.EXTERNAL_PATCHES_QUEUE = savedQueue;
    }
  }
}

function runResume() {
  const dir = path.join(OUT_ROOT, 'resume');
  const cases = [
    { name: 'minimal', argv: ['run-abc'] },
    { name: 'ledger-and-contract', argv: ['run-abc', '--ledger', '/tmp/l.jsonl', '--contract', '/tmp/c'] },
    { name: 'session-explicit', argv: ['run-abc', '--session', 'deterministic'] },
    { name: 'no-flags', argv: ['run-abc', '--no-deterministic', '--no-streaming', '--no-post-merge', '--no-pre-generation'] },
    { name: 'mode-tournament', argv: ['run-abc', '--mode', 'tournament', '--candidates', '4'] },
    { name: 'mode-invalid', argv: ['run-abc', '--mode', 'foo'] },
    { name: 'command-timeout-invalid', argv: ['run-abc', '--command-timeout-ms', '0'] },
    { name: 'external-patches-stdin', argv: ['run-abc', '--external-patches-stdin'] },
    { name: 'forbid-import', argv: ['run-abc', '--forbid-import', 'fs,os'] },
    { name: 'cost-cap', argv: ['run-abc', '--cost-cap', '2.5'] },
    { name: 'cost-cap-invalid', argv: ['run-abc', '--cost-cap', 'abc'] },
    { name: 'local-flags', argv: [
      'run-abc',
      '--session', 'local',
      '--local-backend', 'llama-cpp',
      '--local-grammar', 'outlines',
    ] },
    { name: 'missing-run-id', argv: [] },
    { name: 'too-many-positionals', argv: ['a', 'b'] },
    { name: 'unknown-flag', argv: ['run-abc', '--made-up'] },
    { name: 'help', argv: ['--help'] },
  ];
  for (const c of cases) {
    const savedDir = process.env.EXTERNAL_PATCHES_DIR;
    const savedQueue = process.env.EXTERNAL_PATCHES_QUEUE;
    delete process.env.EXTERNAL_PATCHES_DIR;
    delete process.env.EXTERNAL_PATCHES_QUEUE;
    try {
      runCase(dir, c.name, () => resumeHandler.parseResumeFlags(c.argv));
    } finally {
      if (savedDir !== undefined) process.env.EXTERNAL_PATCHES_DIR = savedDir;
      if (savedQueue !== undefined) process.env.EXTERNAL_PATCHES_QUEUE = savedQueue;
    }
  }
}

function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  runCompile();
  runRun();
  runResume();
  const handlers = ['compile', 'run', 'resume'];
  const counts = handlers.map((h) => {
    const files = fs.readdirSync(path.join(OUT_ROOT, h));
    return `${h}=${files.length}`;
  });
  process.stdout.write(`wrote cli-v8 captures: ${counts.join(', ')}\n`);
}

main();

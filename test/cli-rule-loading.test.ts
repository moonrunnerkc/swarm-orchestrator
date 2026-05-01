import { strict as assert } from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  initActiveRules,
  getActiveRules,
  resetActiveRulesForTests,
  readRuleLoaderConfig,
} from '../src/rules/loader';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'dist', 'src', 'cli.js');
const FIXTURE_BUILTIN = path.join(REPO_ROOT, 'test', 'fixtures', 'rule-packs', 'builtin-only');

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-rule-loading-'));
}

function writeProjectConfig(projectDir: string, body: string): void {
  fs.mkdirSync(path.join(projectDir, '.swarm'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.swarm', 'config.yaml'), body, 'utf8');
}

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  // Run dist/src/cli.js as a real subprocess so the startup-summary path
  // exercises the same module-loading order the user sees. Capturing both
  // streams keeps the test honest about which stream the summary lands on
  // (info logs route to stderr in pretty mode for user-facing commands;
  // gates is not user-facing, so its info logs go to stdout).
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

describe('CLI rule loading', () => {
  describe('active-rules singleton', () => {
    beforeEach(() => resetActiveRulesForTests());
    afterEach(() => resetActiveRulesForTests());

    it('initActiveRules caches the result for subsequent getActiveRules calls', () => {
      const first = initActiveRules({ builtInRulesDir: FIXTURE_BUILTIN, enabledPacks: [] });
      const second = getActiveRules();
      assert.strictEqual(first, second, 'getActiveRules should return the same object initActiveRules cached');
      assert.equal(first.rules.length, 2, 'two built-in cheat rules expected from fixture');
    });

    it('getActiveRules without prior init falls back to a default load', () => {
      // No initActiveRules call. The fallback must still return a valid result;
      // it just won't see community packs. The repo's own built-in rules at
      // config/built-in-rules/ should load (5 cheat rules).
      const result = getActiveRules();
      assert.ok(result.rules.length >= 1, 'fallback default load must surface at least the built-in rules');
      assert.equal(result.errors.length, 0);
    });
  });

  describe('startup announcement (subprocess)', () => {
    before(() => {
      // Ensure the dist build exists; the suite runs from `npm run test:ci`
      // which presupposes a prior `npm run build`, but a stale dist would
      // produce confusing failures here. Skip when dist is missing rather
      // than silently exec a non-existent file.
      if (!fs.existsSync(CLI)) {
        throw new Error(`dist CLI not built at ${CLI}; run \`npm run build\` first`);
      }
    });

    it('announces loaded rules summary on a rule-loading command (gates)', () => {
      const projectDir = tempProject();
      try {
        const result = runCli(['gates', '.'], projectDir);
        const combined = result.stdout + result.stderr;
        assert.match(combined, /Loaded \d+ rules from \d+ packs:/,
          `expected "Loaded N rules from M packs:" line; got\nstdout=${result.stdout}\nstderr=${result.stderr}`);
        assert.match(combined, /swarm-orchestrator\/cheat-defaults/,
          'built-in pack id must appear in the summary');
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('does not announce rules on a non-rule-loading command (--help)', () => {
      const projectDir = tempProject();
      try {
        const result = runCli(['--help'], projectDir);
        const combined = result.stdout + result.stderr;
        assert.doesNotMatch(combined, /Loaded \d+ rules from \d+ packs:/,
          `--help must not trigger the rule loader; got\nstdout=${result.stdout}\nstderr=${result.stderr}`);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('surfaces a clear error and continues when a configured pack is missing on disk', () => {
      const projectDir = tempProject();
      const fakeRulesDir = path.join(projectDir, 'fake-rules');
      fs.mkdirSync(fakeRulesDir, { recursive: true });
      writeProjectConfig(
        projectDir,
        `rules_dir: ${fakeRulesDir}\nrule_packs:\n  - missing-author/missing-pack\n`,
      );
      try {
        const result = runCli(['gates', '.'], projectDir);
        const combined = result.stdout + result.stderr;
        assert.match(combined, /missing-author\/missing-pack/, 'missing pack id must appear in error');
        assert.match(combined, /not found/, 'error must explain the pack was not found on disk');
        // The summary line must still print — built-in always loads.
        assert.match(combined, /Loaded \d+ rules from \d+ packs:/,
          'startup summary must still print despite the missing-pack error');
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe('readRuleLoaderConfig integration with initActiveRules', () => {
    beforeEach(() => resetActiveRulesForTests());
    afterEach(() => resetActiveRulesForTests());

    it('reads .swarm/config.yaml fields and applies them to initActiveRules', () => {
      const projectDir = tempProject();
      try {
        // Point rules_dir at a fixture pack we control. The fixture under
        // builtin-only doubles as both built-in and community for this test:
        // the loader is told to treat it as the rules_dir AND to opt in to
        // the swarm-orchestrator/cheat-defaults id within it.
        writeProjectConfig(
          projectDir,
          `rules_dir: ${FIXTURE_BUILTIN}\nrule_packs:\n  - swarm-orchestrator/cheat-defaults\n`,
        );
        const opts = readRuleLoaderConfig(projectDir);
        assert.equal(opts.rulesDir, FIXTURE_BUILTIN);
        assert.deepEqual(opts.enabledPacks, ['swarm-orchestrator/cheat-defaults']);

        // Use a separate built-in dir so we count only what the config opted
        // in to. Pointing builtInRulesDir at an empty tempdir isolates the
        // measurement.
        const emptyBuiltIn = tempProject();
        try {
          const result = initActiveRules({ ...opts, builtInRulesDir: emptyBuiltIn });
          assert.equal(result.rules.length, 2, 'opted-in pack contributes 2 rules');
          assert.equal(result.packs[0]?.author, 'swarm-orchestrator');
        } finally {
          fs.rmSync(emptyBuiltIn, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });
});

// Suppress unused-import warning for execFileSync; reserved for follow-up tests
// that may exercise the CLI via a different invocation shape (npx, direct shebang).
void execFileSync;

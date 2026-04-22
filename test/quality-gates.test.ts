import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { load_quality_gates_config, run_quality_gates } from '../src/quality-gates';

function fixture(rel: string): string {
  return path.join(process.cwd(), 'test', 'fixtures', rel);
}

describe('QualityGates', () => {
  it('passes on 3 sample templates', async () => {
    const roots = [
      fixture('generated/todo-app'),
      fixture('generated/api-server'),
      fixture('generated/saas-mvp')
    ];

    for (const root of roots) {
      const cfg = load_quality_gates_config(root);
      // Disable gates added in v3.1; these fixtures pre-date a11y and test-coverage requirements
      cfg.gates.accessibility = { ...cfg.gates.accessibility, enabled: false };
      cfg.gates.testCoverage = { ...cfg.gates.testCoverage, enabled: false };
      cfg.gates.runtimeChecks = { ...cfg.gates.runtimeChecks, enabled: false };
      const result = await run_quality_gates(root, cfg);
      assert.strictEqual(result.passed, true, `expected gates to pass for ${root}`);
    }
  });

  it('fails on a known bad scaffold fixture', async () => {
    const root = fixture('bad-scaffold');
    const cfg = load_quality_gates_config(root);
    const result = await run_quality_gates(root, cfg);

    assert.strictEqual(result.passed, false);

    const failed = result.results.filter(r => r.status === 'fail').map(r => r.id);
    // make sure our core gates trip
    assert.ok(failed.includes('scaffold-defaults'));
    assert.ok(failed.includes('hardcoded-config'));
    assert.ok(failed.includes('readme-claims'));
    assert.ok(failed.includes('test-isolation'));
  });

  describe('target-mode gate scoping (issue #27 PR 1)', () => {
    // Uses bad-scaffold fixture which is known to fail multiple gates.
    // In self-mode the fail set includes self-improvement gates
    // (scaffold-defaults, readme-claims, test-isolation) plus the
    // universal gate hardcoded-config. Target-mode must skip the
    // self-improvement ones while still running hardcoded-config and
    // test-file-protection.
    const root = fixture('bad-scaffold');

    it('self-mode (default): all enabled gates fire including self-improvement ones', async () => {
      const cfg = load_quality_gates_config(root);
      const result = await run_quality_gates(root, cfg);
      const resultById = new Map(result.results.map(r => [r.id, r]));

      // Self-improvement gates: were they executed (any status != skip)?
      for (const id of ['scaffold-defaults', 'readme-claims', 'test-isolation']) {
        const r = resultById.get(id);
        assert.ok(r, `self-mode must report ${id}`);
        assert.notStrictEqual(
          r.status, 'skip',
          `self-mode must RUN ${id}, not skip it`,
        );
      }
    });

    it('target-mode: self-improvement gates are skipped; universal gates run', async () => {
      // Import here to avoid polluting the other tests' import surface.
      const { SELF_IMPROVEMENT_GATE_KEYS } = require('../src/quality-gates/registry');
      const cfg = load_quality_gates_config(root);
      const result = await run_quality_gates(
        root, cfg, undefined, undefined, undefined, undefined,
        SELF_IMPROVEMENT_GATE_KEYS,
      );
      const resultById = new Map(result.results.map(r => [r.id, r]));

      // Self-improvement gates must be present with status=skip.
      for (const id of [
        'scaffold-defaults', 'duplicate-blocks', 'readme-claims',
        'test-isolation', 'runtime-checks', 'accessibility', 'test-coverage',
      ]) {
        const r = resultById.get(id);
        assert.ok(r, `target-mode must still REPORT ${id}, with status=skip`);
        assert.strictEqual(
          r.status, 'skip',
          `target-mode must skip ${id} (self-improvement)`,
        );
        assert.strictEqual(
          r.issues.length, 0,
          `target-mode skipped gates must have zero issues`,
        );
      }

      // Universal gates must still run (not skip).
      for (const id of ['hardcoded-config', 'test-file-protection']) {
        const r = resultById.get(id);
        assert.ok(r, `target-mode must still run universal gate ${id}`);
        assert.notStrictEqual(
          r.status, 'skip',
          `target-mode must NOT skip universal gate ${id}`,
        );
      }
    });

    it('SELF_IMPROVEMENT_GATE_KEYS has the exact expected membership', async () => {
      // Lock in the classification — any change to this set changes gate
      // behavior in target-mode runs (SWE-bench eval, bootstrap against
      // external repos). Test forces the decision to be explicit.
      const { SELF_IMPROVEMENT_GATE_KEYS } = require('../src/quality-gates/registry');
      const actual = new Set(SELF_IMPROVEMENT_GATE_KEYS);

      const expected = new Set([
        'scaffoldDefaults',
        'duplicateBlocks',
        'readmeClaims',
        'testIsolation',
        'runtimeChecks',
        'accessibility',
        'testCoverage',
      ]);

      assert.deepStrictEqual(
        [...actual].sort(), [...expected].sort(),
        'classification drift — confirm each added/removed gate is genuinely ' +
        'self-improvement (target-mode skip) vs universal (target-mode fire)',
      );
    });
  });

  it('runs explicitly registered custom project gates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-gate-run-'));
    try {
      fs.mkdirSync(path.join(root, '.swarm', 'gates'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.swarm', 'gates', 'index.cjs'),
        [
          'module.exports.registerGates = ({ registerGate }) => {',
          '  registerGate({',
          '    key: "customGate",',
          '    title: "Custom Gate",',
          '    defaultConfig: { enabled: true },',
          '    async run() {',
          '      return { id: "custom-gate", title: "Custom Gate", status: "pass", durationMs: 0, issues: [] };',
          '    }',
          '  });',
          '};',
        ].join('\n'),
        'utf8'
      );

      const cfg = load_quality_gates_config(root);
      const result = await run_quality_gates(root, cfg);
      assert.ok(result.results.some(r => r.id === 'custom-gate'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

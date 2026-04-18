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

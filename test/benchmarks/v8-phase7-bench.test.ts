import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OBLIGATION_TYPES } from '../../src/contract/types';
import { DEFAULT_PERSONA_IDS } from '../../src/persona/persona-registry';

/**
 * Phase 7 §10 milestone gates, exercised both in-process (the population
 * shape) and end-to-end (running `dist/scripts/v8-bench/run-phase7.js`).
 *
 * These tests are the CI gate for Phase 7's milestone closure: 7+
 * personas in the library, 8+ contract obligation types, every type
 * dispatched to its owning persona on a clean workspace, and every new
 * type surfacing a verifiable failure on a non-compliant workspace.
 */
describe('v8 Phase 7 milestone benchmark gate', () => {
  it('default registry exposes at least 7 personas (§10)', () => {
    assert.ok(
      DEFAULT_PERSONA_IDS.length >= 7,
      `expected >=7 personas; got ${DEFAULT_PERSONA_IDS.length}`,
    );
  });

  it('contract schema declares at least 8 obligation types (§10)', () => {
    assert.ok(
      OBLIGATION_TYPES.length >= 8,
      `expected >=8 obligation types; got ${OBLIGATION_TYPES.length}`,
    );
  });

  it('every Phase 7 obligation type is in OBLIGATION_TYPES', () => {
    const required = [
      'function-must-have-signature',
      'property-must-hold',
      'import-graph-must-satisfy',
      'coverage-must-exceed',
      'performance-must-not-regress',
    ];
    for (const r of required) {
      assert.ok(OBLIGATION_TYPES.includes(r as (typeof OBLIGATION_TYPES)[number]), `missing ${r}`);
    }
  });

  it('every Phase 7 persona id is in DEFAULT_PERSONA_IDS', () => {
    const required = [
      'security-reviewer',
      'dependency-auditor',
      'documentation-writer',
      'migration-specialist',
      'test-author',
    ];
    for (const r of required) {
      assert.ok(
        DEFAULT_PERSONA_IDS.includes(r as (typeof DEFAULT_PERSONA_IDS)[number]),
        `missing ${r}`,
      );
    }
  });

  it('the Phase 7 §10 ship gate passes end-to-end (run-phase7.js)', function () {
    this.timeout(30_000);
    const distScript = path.resolve(__dirname, '..', '..', 'scripts', 'v8-bench', 'run-phase7.js');
    if (!fs.existsSync(distScript)) {
      // The compiled bench script lives next to other compiled bench
      // entry points under `dist/scripts/v8-bench/`. The test file is
      // already under `dist/test/...` at runtime, so __dirname climbs
      // two levels to reach `dist/`, then descends into the bench dir.
      throw new Error(`bench script missing at ${distScript}; run \`npm run build\` first`);
    }
    const tmpDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-phase7-bench-'));
    const jsonl = path.join(tmpDocs, 'history.jsonl');
    const result = spawnSync(process.execPath, [
      distScript,
      '--out-dir',
      tmpDocs,
      '--jsonl',
      jsonl,
    ], { encoding: 'utf8' });
    try {
      assert.equal(
        result.status,
        0,
        `bench exited ${result.status}; stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
      );
      const reportPath = path.join(tmpDocs, 'v8-phase-7-benchmark.md');
      assert.ok(fs.existsSync(reportPath), `report not written to ${reportPath}`);
      const md = fs.readFileSync(reportPath, 'utf8');
      assert.match(md, /At least 7 personas in the library:\*\* PASS/);
      assert.match(md, /At least 8 contract obligation types:\*\* PASS/);
      assert.match(md, /Every obligation type dispatches to its owning persona:\*\* PASS/);
      assert.match(md, /Failure suite catches every new Phase 7 obligation type:\*\* PASS/);
      // History row written.
      assert.ok(fs.existsSync(jsonl));
      const lines = fs.readFileSync(jsonl, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const row = JSON.parse(lines[0] ?? '{}');
      assert.equal(row.suite, 'phase7-milestone');
      assert.ok(row.personaCount >= 7);
      assert.ok(row.obligationTypeCount >= 8);
      assert.equal(row.gates.personaCountAtLeast7, true);
      assert.equal(row.gates.obligationTypeCountAtLeast8, true);
      assert.equal(row.gates.everyTypeDispatchedToOwner, true);
      assert.equal(row.gates.failureSuiteCatchesEveryNewType, true);
    } finally {
      fs.rmSync(tmpDocs, { recursive: true, force: true });
    }
  });
});

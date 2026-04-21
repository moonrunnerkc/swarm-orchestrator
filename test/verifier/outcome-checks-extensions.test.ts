import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkCrossStepContract } from '../../src/verifier/cross-step-checks';
import {
  captureTestSnapshot,
  checkBehavioralPreservation,
} from '../../src/verifier/behavioral-checks';
import { checkSchemaEvolution } from '../../src/verifier/schema-evolution-checks';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function sqliteAvailable(): boolean {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scaffold a standalone mocha-using fixture project. Symlinks node_modules from
 * the host repo so real mocha is resolvable. Returns the project root path.
 */
function scaffoldMochaFixture(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'behavioral-fixture',
        version: '0.0.0',
        private: true,
        scripts: { test: 'mocha' },
        devDependencies: { mocha: '^11.0.0' },
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(dir, 'test'));
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
}

function writeMochaTest(dir: string, name: string, body: string): void {
  fs.writeFileSync(path.join(dir, 'test', `${name}.test.js`), body);
}

describe('Outcome check extensions', () => {
  let scratch: string[] = [];

  afterEach(() => {
    for (const d of scratch) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // scratch cleanup is best-effort
      }
    }
    scratch = [];
  });

  // ── 2.1 Cross-step contract validation ──────────────────────────

  describe('cross-step contract check', () => {
    it('passes when every declared input resolves to a real, non-trivial artifact', () => {
      const dir = tmpDir('xstep-pass');
      scratch.push(dir);
      fs.mkdirSync(path.join(dir, 'src'));
      const content = `export function authenticate(user: string): boolean {
  return user.length > 0 && user !== 'anonymous';
}

export interface AuthConfig {
  secretKey: string;
  issuer: string;
}
`;
      fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), content);

      const check = checkCrossStepContract({
        workdir: dir,
        requiredInputs: ['src/auth.ts', 'src/auth.ts:authenticate', 'src/auth.ts:AuthConfig'],
      });

      assert.strictEqual(check.passed, true, check.reason ?? 'expected pass');
      assert.match(check.evidence ?? '', /3 declared input/);
    });

    it('fails and names the missing input when a required file is absent', () => {
      const dir = tmpDir('xstep-fail');
      scratch.push(dir);
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(
        path.join(dir, 'src', 'present.ts'),
        'export const present = true;\n// padding '.padEnd(150, 'x') + '\n',
      );

      const check = checkCrossStepContract({
        workdir: dir,
        requiredInputs: ['src/present.ts', 'src/missing.ts'],
      });

      assert.strictEqual(check.passed, false);
      assert.match(check.reason ?? '', /src\/missing\.ts.*file not found/);
    });

    it('catches the adversarial case: transcript claims success but export is undefined stub', () => {
      // Agent's transcript would claim it implemented `authenticate`. Reality:
      // the file exists and has a stub that binds the export to literal undefined.
      // A file-existence-only check would pass this; the symbol resolver must
      // catch the empty binding.
      const dir = tmpDir('xstep-adv');
      scratch.push(dir);
      fs.mkdirSync(path.join(dir, 'src'));
      const stub = `// Agent said: "Implemented authenticate()"
// Reality: stub returns undefined
export const authenticate = undefined;
// Padding so the file clears the 100B size gate and would fool a naive check
${'// '.padEnd(200, 'x')}
`;
      fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), stub);

      const check = checkCrossStepContract({
        workdir: dir,
        requiredInputs: ['src/auth.ts:authenticate'],
      });

      assert.strictEqual(check.passed, false, 'adversarial stub must be caught');
      assert.match(check.reason ?? '', /literal undefined/);
    });
  });

  // ── 2.2 Behavioral preservation ─────────────────────────────────

  describe('behavioral preservation check', function () {
    this.timeout(60_000); // each case spawns mocha twice against a real fixture

    it('passes when every pre-step passing test still passes after the change', () => {
      const dir = tmpDir('behav-pass');
      scratch.push(dir);
      scaffoldMochaFixture(dir);
      writeMochaTest(
        dir,
        'addition',
        `const assert = require('assert');
describe('math', () => {
  it('adds', () => assert.strictEqual(1 + 1, 2));
  it('multiplies', () => assert.strictEqual(2 * 3, 6));
});
`,
      );

      const pre = captureTestSnapshot(dir);
      assert.strictEqual(pre.passing.length, 2, 'fixture should report 2 passing pre-snapshot');

      writeMochaTest(
        dir,
        'subtraction',
        `const assert = require('assert');
describe('math', () => {
  it('subtracts', () => assert.strictEqual(5 - 2, 3));
});
`,
      );

      const check = checkBehavioralPreservation({ workdir: dir, preSnapshot: pre });

      assert.strictEqual(check.passed, true, check.reason ?? 'expected pass');
      assert.match(check.evidence ?? '', /1 new passing/);
    });

    it('fails and names the regressed test when a previously-passing assertion now throws', () => {
      const dir = tmpDir('behav-fail');
      scratch.push(dir);
      scaffoldMochaFixture(dir);
      writeMochaTest(
        dir,
        'addition',
        `const assert = require('assert');
describe('math', () => {
  it('adds', () => assert.strictEqual(1 + 1, 2));
  it('multiplies', () => assert.strictEqual(2 * 3, 6));
});
`,
      );

      const pre = captureTestSnapshot(dir);
      assert.strictEqual(pre.passing.length, 2);

      // "Refactor" breaks the multiplies test
      writeMochaTest(
        dir,
        'addition',
        `const assert = require('assert');
describe('math', () => {
  it('adds', () => assert.strictEqual(1 + 1, 2));
  it('multiplies', () => assert.strictEqual(2 * 3, 7)); // wrong
});
`,
      );

      const check = checkBehavioralPreservation({ workdir: dir, preSnapshot: pre });

      assert.strictEqual(check.passed, false);
      assert.match(check.reason ?? '', /math multiplies/);
    });

    it('catches the adversarial case: agent deletes a test and claims all pass', () => {
      // Single-snapshot count-based checks get fooled by this: the remaining
      // tests all pass, so naive "all passing" would return pass. We compare
      // against the pre-step *set* of test names, so a removed test trips the
      // regression detector even though the post-run has zero failures.
      const dir = tmpDir('behav-adv');
      scratch.push(dir);
      scaffoldMochaFixture(dir);
      writeMochaTest(
        dir,
        'pair',
        `const assert = require('assert');
describe('pair', () => {
  it('lhs', () => assert.strictEqual('a', 'a'));
  it('rhs', () => assert.strictEqual('b', 'b'));
});
`,
      );

      const pre = captureTestSnapshot(dir);
      assert.strictEqual(pre.passing.length, 2);

      // Agent "refactors" and removes the rhs case entirely, then claims success
      writeMochaTest(
        dir,
        'pair',
        `const assert = require('assert');
describe('pair', () => {
  it('lhs', () => assert.strictEqual('a', 'a'));
});
`,
      );

      const check = checkBehavioralPreservation({ workdir: dir, preSnapshot: pre });

      assert.strictEqual(check.passed, false, 'silently-dropped test must be caught');
      assert.match(check.reason ?? '', /pair rhs/);
    });
  });

  // ── 2.3 Schema evolution ────────────────────────────────────────

  describe('schema evolution check', () => {
    before(function skipWithoutSqlite() {
      if (!sqliteAvailable()) this.skip();
    });

    it('passes when migration applies cleanly and probe query returns', () => {
      const dir = tmpDir('schema-pass');
      scratch.push(dir);
      const migrationPath = path.join(dir, 'add_email.sql');
      fs.writeFileSync(migrationPath, 'ALTER TABLE users ADD COLUMN email TEXT;\n');

      const check = checkSchemaEvolution({
        workdir: dir,
        backend: 'sqlite',
        seedSchema:
          'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n' +
          "INSERT INTO users (name) VALUES ('alice');\n",
        migrationFile: 'add_email.sql',
        probeQuery: 'SELECT email FROM users LIMIT 1;',
      });

      assert.strictEqual(check.passed, true, check.reason ?? 'expected pass');
    });

    it('fails and reports the phase when migration SQL has a syntax error', () => {
      const dir = tmpDir('schema-fail');
      scratch.push(dir);
      const migrationPath = path.join(dir, 'bad.sql');
      fs.writeFileSync(migrationPath, 'ALTRR TABLE users ADD COLUMN email TEXT;\n');

      const check = checkSchemaEvolution({
        workdir: dir,
        backend: 'sqlite',
        seedSchema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n',
        migrationFile: 'bad.sql',
        probeQuery: 'SELECT 1;',
      });

      assert.strictEqual(check.passed, false);
      assert.match(check.reason ?? '', /migration failed/);
    });

    it('catches the adversarial case: migration is a no-op comment but agent claims it added the column', () => {
      // A verifier that only checks "did the SQL run without error" passes this
      // (comments run fine). The probe query against the non-existent column is
      // the real correctness signal; only running it against a live DB catches
      // the lie.
      const dir = tmpDir('schema-adv');
      scratch.push(dir);
      const migrationPath = path.join(dir, 'pretend_add_email.sql');
      fs.writeFileSync(
        migrationPath,
        '-- Agent said: "Added email column to users"\n' +
          '-- Reality: the migration is empty; the column was never added.\n' +
          'SELECT 1;\n',
      );

      const check = checkSchemaEvolution({
        workdir: dir,
        backend: 'sqlite',
        seedSchema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n',
        migrationFile: 'pretend_add_email.sql',
        probeQuery: 'SELECT email FROM users LIMIT 1;',
      });

      assert.strictEqual(check.passed, false, 'missing-column lie must be caught');
      assert.match(check.reason ?? '', /probe failed.*email/);
    });
  });

  // ── Framework-detection error surface ───────────────────────────

  describe('captureTestSnapshot', () => {
    it('throws a descriptive error when no supported framework is detected', () => {
      const dir = tmpDir('nofw');
      scratch.push(dir);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bare' }));

      assert.throws(
        () => captureTestSnapshot(dir),
        /requires mocha.*or pytest/,
      );
    });
  });
});

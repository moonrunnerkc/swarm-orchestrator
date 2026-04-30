import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExecutionPlan } from '../src/plan-generator';
import { loadPlanFile, savePlanFile } from '../src/plan-files';

function makePlan(goal = 'demo goal'): ExecutionPlan {
  return {
    goal,
    steps: [],
  } as unknown as ExecutionPlan;
}

describe('plan-files', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-files-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadPlanFile', () => {
    it('loads a bare filename from cwd when present', () => {
      const plan = makePlan('cwd plan');
      fs.writeFileSync(path.join(tmpDir, 'plan.json'), JSON.stringify(plan), 'utf8');

      const loaded = loadPlanFile('plan.json');
      assert.strictEqual(loaded.goal, 'cwd plan');
    });

    it('falls back to the plans/ directory when the bare filename is not in cwd', () => {
      const plan = makePlan('plans dir plan');
      const planDir = path.join(tmpDir, 'plans');
      fs.mkdirSync(planDir);
      fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plan), 'utf8');

      const loaded = loadPlanFile('plan.json');
      assert.strictEqual(loaded.goal, 'plans dir plan');
    });

    it('prefers cwd over plans/ when both exist', () => {
      const cwdPlan = makePlan('cwd wins');
      const plansPlan = makePlan('plans loses');
      fs.writeFileSync(path.join(tmpDir, 'plan.json'), JSON.stringify(cwdPlan), 'utf8');
      const planDir = path.join(tmpDir, 'plans');
      fs.mkdirSync(planDir);
      fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plansPlan), 'utf8');

      const loaded = loadPlanFile('plan.json');
      assert.strictEqual(loaded.goal, 'cwd wins');
    });

    it('honors explicit ./ prefix against cwd', () => {
      const plan = makePlan('explicit cwd');
      fs.writeFileSync(path.join(tmpDir, 'plan.json'), JSON.stringify(plan), 'utf8');

      const loaded = loadPlanFile('./plan.json');
      assert.strictEqual(loaded.goal, 'explicit cwd');
    });

    it('honors absolute paths', () => {
      const plan = makePlan('absolute');
      const absolute = path.join(tmpDir, 'somewhere.json');
      fs.writeFileSync(absolute, JSON.stringify(plan), 'utf8');

      const loaded = loadPlanFile(absolute);
      assert.strictEqual(loaded.goal, 'absolute');
    });

    it('throws a hint mentioning both candidate locations for missing bare filenames', () => {
      assert.throws(
        () => loadPlanFile('missing.json'),
        (err: Error) => {
          assert.match(err.message, /Plan file not found/);
          assert.match(err.message, /cwd/);
          assert.match(err.message, /plans/);
          assert.match(err.message, /\.\/missing\.json/);
          return true;
        }
      );
    });

    it('throws a plain not-found error for explicit paths', () => {
      assert.throws(
        () => loadPlanFile('./nope.json'),
        (err: Error) => {
          assert.match(err.message, /Plan file not found/);
          assert.doesNotMatch(err.message, /looked in cwd/);
          return true;
        }
      );
    });
  });

  describe('savePlanFile', () => {
    it('writes to plans/ under cwd and returns the absolute path', () => {
      const plan = makePlan('save test');
      const written = savePlanFile(plan, 'saved.json');

      assert.strictEqual(written, path.join(tmpDir, 'plans', 'saved.json'));
      assert.ok(fs.existsSync(written));
      const reloaded = JSON.parse(fs.readFileSync(written, 'utf8'));
      assert.strictEqual(reloaded.goal, 'save test');
    });
  });
});

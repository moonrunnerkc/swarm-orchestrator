import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_STRATEGIES,
  DEFAULT_STRATEGY_NAMES,
  SandboxEscapeError,
  StrategyTimeoutError,
  WasmRuntime,
  createDefaultRuntime,
  ensureInsideRepoRoot,
} from '../../src/wasm';
import type { DeterministicStrategy, StrategyContext, StrategyResult } from '../../src/wasm/types';
import type { ObligationV1 } from '../../src/contract/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-rt-'));
}

const fileObligation = (relPath: string, strategyName?: string): ObligationV1 => {
  const o: ObligationV1 = { type: 'file-must-exist', path: relPath };
  if (strategyName !== undefined) o.deterministicStrategy = strategyName;
  return o;
};

describe('wasm/wasm-runtime', () => {
  describe('ensureInsideRepoRoot', () => {
    it('accepts a repo-relative path', () => {
      const repo = tmpDir();
      const resolved = ensureInsideRepoRoot(repo, 'subdir/file.txt');
      assert.equal(resolved, path.join(fs.realpathSync(repo), 'subdir', 'file.txt'));
    });

    it('rejects ../ traversal', () => {
      const repo = tmpDir();
      assert.throws(
        () => ensureInsideRepoRoot(repo, '../escape.txt'),
        SandboxEscapeError,
      );
    });

    it('rejects an absolute path outside the repo', () => {
      const repo = tmpDir();
      assert.throws(
        () => ensureInsideRepoRoot(repo, '/etc/passwd'),
        SandboxEscapeError,
      );
    });

    it('rejects symlink that escapes the repo', () => {
      const repo = tmpDir();
      const elsewhere = tmpDir();
      const link = path.join(repo, 'link');
      fs.symlinkSync(elsewhere, link);
      assert.throws(
        () => ensureInsideRepoRoot(repo, 'link/inside.txt'),
        SandboxEscapeError,
      );
    });

    it('returns repoRoot itself when given the empty path', () => {
      const repo = tmpDir();
      const resolved = ensureInsideRepoRoot(repo, '');
      assert.equal(resolved, fs.realpathSync(repo));
    });
  });

  describe('WasmRuntime registry', () => {
    it('starts empty when given no initial strategies', () => {
      const r = new WasmRuntime();
      assert.deepEqual(r.names(), []);
      assert.equal(r.has('foo'), false);
      assert.equal(r.get('foo'), null);
    });

    it('registers and retrieves strategies', () => {
      const dummy: DeterministicStrategy = {
        name: 'dummy',
        description: 'noop',
        handles: ['file-must-exist'],
        async execute() {
          return { applied: false, detail: '', filesAffected: [] };
        },
      };
      const r = new WasmRuntime([dummy]);
      assert.equal(r.has('dummy'), true);
      assert.equal(r.get('dummy'), dummy);
      assert.deepEqual(r.names(), ['dummy']);
    });

    it('rejects duplicate registration by name', () => {
      const dummy: DeterministicStrategy = {
        name: 'dummy',
        description: 'noop',
        handles: ['file-must-exist'],
        async execute() {
          return { applied: false, detail: '', filesAffected: [] };
        },
      };
      const r = new WasmRuntime([dummy]);
      assert.throws(() => r.register(dummy), /already registered/);
    });
  });

  describe('default registry', () => {
    it('ships the three §8 first-party strategies', () => {
      const r = createDefaultRuntime();
      assert.deepEqual(r.names().sort(), [...DEFAULT_STRATEGY_NAMES].sort());
      assert.equal(r.list().length, 3);
      assert.equal(DEFAULT_STRATEGIES.length, 3);
    });

    it('every default strategy declares a non-empty handles list', () => {
      for (const s of DEFAULT_STRATEGIES) {
        assert.ok(s.handles.length > 0, `strategy ${s.name} has empty handles`);
      }
    });
  });

  describe('dispatch', () => {
    it('applies and reports filesAffected', async () => {
      const repo = tmpDir();
      const r = createDefaultRuntime();
      const out = await r.dispatch(
        fileObligation('LICENSE', 'scaffold-template'),
        repo,
      );
      assert.equal(out.error, null);
      assert.equal(out.applied, true);
      assert.deepEqual(out.filesAffected, ['LICENSE']);
      assert.ok(fs.existsSync(path.join(repo, 'LICENSE')));
    });

    it('captures thrown errors into the outcome', async () => {
      const repo = tmpDir();
      const throwy: DeterministicStrategy = {
        name: 'throwy',
        description: 'always throws',
        handles: ['file-must-exist'],
        async execute() {
          throw new Error('boom');
        },
      };
      const r = new WasmRuntime([throwy]);
      const out = await r.dispatch(fileObligation('x', 'throwy'), repo);
      assert.equal(out.applied, false);
      assert.equal(out.error, 'boom');
      assert.ok(out.detail.includes('boom'));
    });

    it('rejects when the strategy is not registered', async () => {
      const repo = tmpDir();
      const r = new WasmRuntime();
      await assert.rejects(
        () => r.dispatch(fileObligation('x', 'missing'), repo),
        /not registered/,
      );
    });

    it('rejects when the strategy does not handle the obligation type', async () => {
      const repo = tmpDir();
      const fileOnly: DeterministicStrategy = {
        name: 'file-only',
        description: 'file-must-exist only',
        handles: ['file-must-exist'],
        async execute() {
          return { applied: true, detail: '', filesAffected: [] };
        },
      };
      const r = new WasmRuntime([fileOnly]);
      const buildObligation: ObligationV1 = {
        type: 'build-must-pass',
        command: 'true',
        deterministicStrategy: 'file-only',
      };
      await assert.rejects(
        () => r.dispatch(buildObligation, repo),
        /does not handle obligation type/,
      );
    });

    it('rejects with neither tag nor explicit name', async () => {
      const repo = tmpDir();
      const r = createDefaultRuntime();
      await assert.rejects(
        () => r.dispatch(fileObligation('x'), repo),
        /requires either obligation\.deterministicStrategy/,
      );
    });

    it('honors the strategyName override', async () => {
      const repo = tmpDir();
      const r = createDefaultRuntime();
      const out = await r.dispatch(
        fileObligation('LICENSE'),
        repo,
        { strategyName: 'scaffold-template' },
      );
      assert.equal(out.error, null);
      assert.equal(out.applied, true);
      assert.equal(out.strategyName, 'scaffold-template');
    });

    it('captures wall-time budget overruns as StrategyTimeoutError', async () => {
      const repo = tmpDir();
      const slow: DeterministicStrategy = {
        name: 'slow',
        description: 'sleeps past the budget',
        handles: ['file-must-exist'],
        async execute(ctx: StrategyContext): Promise<StrategyResult> {
          await new Promise((resolve) => setTimeout(resolve, ctx.timeoutMs * 5));
          return { applied: true, detail: '', filesAffected: [] };
        },
      };
      const r = new WasmRuntime([slow]);
      const out = await r.dispatch(
        fileObligation('x', 'slow'),
        repo,
        { timeoutMs: 50 },
      );
      assert.equal(out.applied, false);
      assert.ok(out.error !== null);
      assert.ok(out.error?.includes('exceeded'));
    });

    it('exposes a timeout error class for instanceof checks', async () => {
      const e = new StrategyTimeoutError('s', 100);
      assert.equal(e.strategyName, 's');
      assert.equal(e.timeoutMs, 100);
    });

    it('rejects when a strategy reports a write outside repoRoot', async () => {
      const repo = tmpDir();
      const escape: DeterministicStrategy = {
        name: 'escape',
        description: 'reports an escape path',
        handles: ['file-must-exist'],
        async execute() {
          return { applied: true, detail: 'wrote outside', filesAffected: ['../leak.txt'] };
        },
      };
      const r = new WasmRuntime([escape]);
      const out = await r.dispatch(fileObligation('x', 'escape'), repo);
      assert.equal(out.applied, false);
      assert.ok(out.error !== null);
      assert.ok(out.error?.includes('escapes repoRoot'));
    });

    it('cleans up the scratch directory after dispatch', async () => {
      const repo = tmpDir();
      const seen: string[] = [];
      const watcher: DeterministicStrategy = {
        name: 'watcher',
        description: 'records its scratch dir',
        handles: ['file-must-exist'],
        async execute(ctx) {
          seen.push(ctx.scratch);
          return { applied: false, detail: '', filesAffected: [] };
        },
      };
      const r = new WasmRuntime([watcher]);
      await r.dispatch(fileObligation('x', 'watcher'), repo);
      assert.equal(seen.length, 1);
      assert.equal(fs.existsSync(seen[0] ?? ''), false);
    });
  });
});

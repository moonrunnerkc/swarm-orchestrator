import { strict as assert } from 'assert';
import { StubExtractor } from '../../src/contract/extractor/stub-extractor';
import { type RepoContext } from '../../src/contract/types';

const repoContext: RepoContext = {
  repoRoot: '/tmp/example',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  language: 'typescript',
};

describe('contract/extractor/stub-extractor', () => {
  it('fromObligations returns the same fixed list for every input', async () => {
    const ext = StubExtractor.fromObligations([
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    const out1 = await ext.extract({ goal: 'goal-one', repoContext });
    const out2 = await ext.extract({ goal: 'goal-two', repoContext });
    assert.deepEqual(out1.obligations, out2.obligations);
  });

  it('fromGoalMap looks up by goal and falls back when missing', async () => {
    const ext = StubExtractor.fromGoalMap({
      mapped: [
        { type: 'file-must-exist', path: 'mapped.ts' },
        { type: 'build-must-pass', command: 'mapped-build' },
        { type: 'test-must-pass', command: 'mapped-test' },
      ],
    });
    const hit = await ext.extract({ goal: 'mapped', repoContext });
    assert.equal(
      hit.obligations.find((o) => o.type === 'file-must-exist')?.type,
      'file-must-exist',
    );
    const miss = await ext.extract({ goal: 'unmapped goal', repoContext });
    // fallback heuristic always emits build + test
    assert.ok(miss.obligations.some((o) => o.type === 'build-must-pass'));
    assert.ok(miss.obligations.some((o) => o.type === 'test-must-pass'));
  });

  it('default heuristic uses repoContext build/test commands', async () => {
    const ext = StubExtractor.fromHeuristic();
    const out = await ext.extract({ goal: 'add a thing', repoContext });
    const build = out.obligations.find((o) => o.type === 'build-must-pass');
    const test = out.obligations.find((o) => o.type === 'test-must-pass');
    assert.ok(build && build.type === 'build-must-pass' && build.command === 'npm run build');
    assert.ok(test && test.type === 'test-must-pass' && test.command === 'npm test');
  });

  it('records provenance.name = "stub"', async () => {
    const ext = StubExtractor.fromHeuristic();
    const out = await ext.extract({ goal: 'g', repoContext });
    assert.equal(out.provenance.name, 'stub');
    assert.equal(out.provenance.model, null);
    assert.equal(out.provenance.temperature, null);
    assert.equal(out.provenance.promptSha256, null);
  });
});

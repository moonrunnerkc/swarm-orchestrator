// The local judge talks to an OpenAI-compatible server so the audit's
// judge gate can run without a paid API. It must degrade to 'unavailable'
// (never throw) when the server is unreachable, so a down server falls
// back to deterministic-only auditing instead of crashing the run.

import { strict as assert } from 'assert';
import { LocalJudge, localJudgeModelId } from '../../../src/audit/cheat-detector/llm-judge/local-judge';

describe('local judge', () => {
  it('returns unavailable (does not throw) when the server is unreachable', async () => {
    const judge = new LocalJudge({ baseUrl: 'http://127.0.0.1:1' });
    const out = await judge.ask({ system: 's', user: 'u', modelId: 'local:test' });
    assert.equal(out.answer, 'unavailable');
  });

  it('folds the model id into a local: cache namespace', () => {
    const prev = process.env.SWARM_JUDGE_MODEL;
    process.env.SWARM_JUDGE_MODEL = 'some-model';
    try {
      assert.equal(localJudgeModelId(), 'local:some-model');
    } finally {
      if (prev === undefined) delete process.env.SWARM_JUDGE_MODEL;
      else process.env.SWARM_JUDGE_MODEL = prev;
    }
  });
});

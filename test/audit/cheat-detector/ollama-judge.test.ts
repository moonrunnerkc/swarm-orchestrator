// The ollama judge talks to Ollama's native /api/chat so a thinking
// model can be told not to reason (the OpenAI /v1 bridge ignores that
// toggle and returns empty content). It must degrade to 'unavailable'
// (never throw) when the server is unreachable or unconfigured, so a
// down server falls back to deterministic-only auditing instead of
// crashing the run.

import { strict as assert } from 'assert';
import { OllamaJudge, ollamaJudgeModelId } from '../../../src/audit/cheat-detector/llm-judge/ollama-judge';

describe('ollama judge', () => {
  it('returns unavailable (does not throw) when the server is unreachable', async () => {
    const judge = new OllamaJudge({ baseUrl: 'http://127.0.0.1:1', model: 'test-model', timeoutMs: 2000 });
    const out = await judge.ask({ system: 's', user: 'u', modelId: 'ollama:test' });
    assert.equal(out.answer, 'unavailable');
  });

  it('returns unavailable (does not throw) when no model is configured', async () => {
    const prev = process.env.SWARM_JUDGE_MODEL;
    delete process.env.SWARM_JUDGE_MODEL;
    try {
      const judge = new OllamaJudge({ baseUrl: 'http://127.0.0.1:1' });
      const out = await judge.ask({ system: 's', user: 'u', modelId: 'ollama:test' });
      assert.equal(out.answer, 'unavailable');
    } finally {
      if (prev !== undefined) process.env.SWARM_JUDGE_MODEL = prev;
    }
  });

  it('folds the model id into an ollama: cache namespace', () => {
    const prev = process.env.SWARM_JUDGE_MODEL;
    process.env.SWARM_JUDGE_MODEL = 'some-model';
    try {
      assert.equal(ollamaJudgeModelId(), 'ollama:some-model');
    } finally {
      if (prev === undefined) delete process.env.SWARM_JUDGE_MODEL;
      else process.env.SWARM_JUDGE_MODEL = prev;
    }
  });
});

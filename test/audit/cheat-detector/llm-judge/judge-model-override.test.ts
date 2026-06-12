import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  askJudge,
  PINNED_JUDGE_MODEL_ID,
} from '../../../../src/audit/cheat-detector/llm-judge';
import type {
  JudgeAnswer,
  JudgeClient,
} from '../../../../src/audit/cheat-detector/llm-judge/types';

function makeStubClient(): { client: JudgeClient; calls: Array<{ modelId: string }> } {
  const calls: Array<{ modelId: string }> = [];
  const client: JudgeClient = {
    async ask({ modelId }): Promise<{ raw: string; answer: JudgeAnswer; reason?: string }> {
      calls.push({ modelId });
      return { raw: 'NO never reached', answer: 'no' };
    },
  };
  return { client, calls };
}

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'judge-model-override-'));
}

describe('audit/cheat-detector/llm-judge SWARM_JUDGE_MODEL override', () => {
  let priorOverride: string | undefined;

  beforeEach(() => {
    priorOverride = process.env.SWARM_JUDGE_MODEL;
    delete process.env.SWARM_JUDGE_MODEL;
  });

  afterEach(() => {
    if (priorOverride !== undefined) {
      process.env.SWARM_JUDGE_MODEL = priorOverride;
    } else {
      delete process.env.SWARM_JUDGE_MODEL;
    }
  });

  it('uses PINNED_JUDGE_MODEL_ID by default', async () => {
    const repo = tempRepo();
    const { client, calls } = makeStubClient();
    const result = await askJudge({
      repoRoot: repo,
      request: { detector: 'no-op-fix', prTitle: 'pr title', unifiedDiff: '+++ a\n+ x' },
      client,
    });
    assert.equal(result.modelId, PINNED_JUDGE_MODEL_ID);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.modelId, PINNED_JUDGE_MODEL_ID);
  });

  it('honors SWARM_JUDGE_MODEL when set', async () => {
    process.env.SWARM_JUDGE_MODEL = 'claude-future-1-2-3';
    const repo = tempRepo();
    const { client, calls } = makeStubClient();
    const result = await askJudge({
      repoRoot: repo,
      request: { detector: 'no-op-fix', prTitle: 'pr title', unifiedDiff: '+++ a\n+ y' },
      client,
    });
    assert.equal(result.modelId, 'claude-future-1-2-3');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.modelId, 'claude-future-1-2-3');
  });

  it('ignores an empty SWARM_JUDGE_MODEL and falls back to the pinned id', async () => {
    process.env.SWARM_JUDGE_MODEL = '   ';
    const repo = tempRepo();
    const { client } = makeStubClient();
    const result = await askJudge({
      repoRoot: repo,
      request: { detector: 'no-op-fix', prTitle: 'pr title', unifiedDiff: '+++ a\n+ z' },
      client,
    });
    assert.equal(result.modelId, PINNED_JUDGE_MODEL_ID);
  });

  it('explicit modelId option wins over the env override', async () => {
    process.env.SWARM_JUDGE_MODEL = 'env-model';
    const repo = tempRepo();
    const { client, calls } = makeStubClient();
    const result = await askJudge({
      repoRoot: repo,
      request: { detector: 'no-op-fix', prTitle: 'pr title', unifiedDiff: '+++ a\n+ w' },
      modelId: 'explicit-model',
      client,
    });
    assert.equal(result.modelId, 'explicit-model');
    assert.equal(calls[0]?.modelId, 'explicit-model');
  });
});

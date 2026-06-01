import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { askJudge } from '../../../src/audit/cheat-detector/llm-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../../src/audit/cheat-detector/llm-judge';
import type { JudgeClient } from '../../../src/audit/cheat-detector/llm-judge';

function repoRootFrom(dir: string): string {
  let d = dir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    d = path.dirname(d);
  }
  throw new Error('could not locate repo root');
}

const TAIL_HUNK = fs.readFileSync(
  path.join(
    repoRootFrom(__dirname),
    'test',
    'audit',
    'fixtures',
    'tail-defect',
    'tail-hunk.diff',
  ),
  'utf8',
);

// Build a >120k-char diff whose error-swallow defect sits in the tail,
// past the head-truncation point the judge used to apply.
function bigDiffWithTailDefect(): string {
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < MAX_JUDGE_DIFF_CHARS + 5000) {
    const block = `diff --git a/src/filler-${i}.ts b/src/filler-${i}.ts\n--- a/src/filler-${i}.ts\n+++ b/src/filler-${i}.ts\n@@ -1,1 +1,2 @@\n const a${i} = ${i};\n+const b${i} = ${'0'.repeat(80)};\n`;
    parts.push(block);
    size += block.length;
    i += 1;
  }
  parts.push(TAIL_HUNK);
  return parts.join('');
}

// A stub that says YES only when it sees the empty-catch marker, so the
// verdict tracks whether the tail defect reached the judge.
function markerSeekingClient(): JudgeClient {
  return {
    ask: async (prompt) => {
      const sawMarker = prompt.user.includes('} catch {}');
      return sawMarker
        ? { raw: 'YES tail defect visible', answer: 'yes' as const, reason: 'empty catch in tail' }
        : { raw: 'NO', answer: 'no' as const };
    },
  };
}

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tail-defect-'));
}

describe('cheat-detector / tail-defect recovery', () => {
  it('head-truncation would have dropped the tail defect', () => {
    const diff = bigDiffWithTailDefect();
    assert.ok(diff.length > MAX_JUDGE_DIFF_CHARS, 'diff should exceed the judge budget');
    const headOnly = diff.slice(0, MAX_JUDGE_DIFF_CHARS);
    assert.ok(!headOnly.includes('} catch {}'), 'the tail defect should be beyond the head cut');
  });

  it('chunked judging surfaces the tail defect and returns yes', async () => {
    const diff = bigDiffWithTailDefect();
    const result = await askJudge({
      repoRoot: tempRepo(),
      request: { detector: 'confirm:error-swallow', prTitle: 'fix persistence', unifiedDiff: diff },
      client: markerSeekingClient(),
      allowLiveCall: true,
    });
    assert.equal(result.answer, 'yes', 'chunked judge should catch the tail defect');
  });
});

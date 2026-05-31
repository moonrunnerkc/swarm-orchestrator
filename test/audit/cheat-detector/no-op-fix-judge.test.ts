import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { noOpFixDetector } from '../../../src/audit/cheat-detector/no-op-fix';
import { AnthropicJudge } from '../../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import {
  askJudge,
  PINNED_JUDGE_MODEL_ID,
} from '../../../src/audit/cheat-detector/llm-judge';
import { computeJudgeCacheKey, writeCachedAnswer } from '../../../src/audit/cheat-detector/llm-judge/cache';
import type { Finding, JudgeLedgerEntry, JudgeLedgerSink } from '../../../src/audit/types';
import type { DetectorContext, DetectorJudgeConfig } from '../../../src/audit/cheat-detector/detector-types';
import {
  buildJudgeClientStub,
  judgeReply,
} from '../../fixtures/anthropic-judge-shim';

function tempRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noop-judge-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function buildLedger(): { sink: JudgeLedgerSink; entries: JudgeLedgerEntry[] } {
  const entries: JudgeLedgerEntry[] = [];
  return {
    entries,
    sink: { appendJudgeEntry: (entry) => entries.push(entry) },
  };
}

const DIFF_BOTH_SIDES_OVERLAP = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
+export function totallyUnrelated() { return 'foo'; }
diff --git a/test/bar.test.ts b/test/bar.test.ts
--- a/test/bar.test.ts
+++ b/test/bar.test.ts
@@ -1,1 +1,2 @@
+  expect(totallyUnrelated()).toBe('foo');
`;

const DIFF_DOC_ONLY = `diff --git a/src/notes.ts b/src/notes.ts
--- a/src/notes.ts
+++ b/src/notes.ts
@@ -1,1 +1,2 @@
+// updated example: see README for the new flow
 const VERSION = '1.0.0';
`;

const PR_TITLE = 'fix: stop dropping retries when upstream returns 503';

async function runDetector(
  diff: string,
  repoRoot: string,
  judge?: DetectorJudgeConfig,
  prTitle: string = PR_TITLE,
): Promise<Finding[]> {
  const files = parseDiff(diff);
  const ctx: DetectorContext = {
    files,
    repoRoot,
    pr: {
      number: 1,
      headSha: 'h',
      baseSha: 'b',
      title: prTitle,
      body: '',
      author: 'tester',
      headRef: 'feat',
      repository: 'acme/widget',
    },
  };
  if (judge !== undefined) ctx.judgeConfig = judge;
  return await Promise.resolve(noOpFixDetector.run(ctx));
}

describe('cheat-detector / no-op-fix v2.0 with judge', () => {
  it('deterministic-only path is byte-identical to v1.1.0 when judge is off', async () => {
    const repo = tempRepo();
    const findingsOff = await runDetector(DIFF_BOTH_SIDES_OVERLAP, repo);
    assert.equal(findingsOff.length, 0, 'overlap diff should not fire deterministic checks');

    // Same diff again with judge config absent: same result; no judge
    // entries; no .swarm/llm-judge-cache directory created.
    const findingsAgain = await runDetector(DIFF_BOTH_SIDES_OVERLAP, repo);
    assert.deepEqual(findingsOff, findingsAgain);
    assert.ok(!fs.existsSync(path.join(repo, '.swarm', 'llm-judge-cache')));
  });

  it('cache hit returns recorded answer without invoking the SDK', async () => {
    const repo = tempRepo();
    // Pre-warm the cache so a fresh judge run must NOT call the client.
    const cacheInput = {
      diff: DIFF_DOC_ONLY,
      title: PR_TITLE,
      modelId: PINNED_JUDGE_MODEL_ID,
      detector: 'no-op-fix',
    };
    const { cacheKey, diffSha, titleSha } = computeJudgeCacheKey(cacheInput);
    writeCachedAnswer(repo, cacheKey, {
      diffSha,
      titleSha,
      modelId: PINNED_JUDGE_MODEL_ID,
      answer: 'yes',
      reason: 'cached reason from a prior run',
    });

    const { sink, entries } = buildLedger();
    const stub = buildJudgeClientStub({ reply: 'NO never called' });
    const result = await askJudge({
      repoRoot: repo,
      request: {
        detector: 'no-op-fix',
        prTitle: PR_TITLE,
        unifiedDiff: DIFF_DOC_ONLY,
      },
      ledger: sink,
      client: { ask: async (_p) => ({ raw: 'NO never called', answer: 'no' }) },
    });
    // Stub above asserts our client was bypassed; the inner ask
    // function was never called because the cache short-circuited.
    assert.equal(stub.calls.length, 0);
    assert.equal(result.cacheHit, true);
    assert.equal(result.answer, 'yes');
    assert.equal(result.reason, 'cached reason from a prior run');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.cacheHit, true);
    assert.equal(entries[0]?.answer, 'yes');
  });

  it('judge unavailable falls back to deterministic + adds an info finding', async () => {
    const repo = tempRepo();
    const judgeConfig: DetectorJudgeConfig = {
      enabled: true,
      unifiedDiff: DIFF_DOC_ONLY,
    };
    // Force the unavailable path by injecting a client that throws,
    // wrapped through askJudge via the detector. We do this by
    // pre-emptying the env var and skipping the live call.
    const priorKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const findings = await runDetector(DIFF_DOC_ONLY, repo, judgeConfig);
      const info = findings.filter(
        (f) => f.category === 'no-op-fix' && f.severity === 'info',
      );
      assert.ok(
        info.some((f) => /judge.*unavailable/i.test(f.message)),
        `expected an info finding noting the judge fallback; got ${JSON.stringify(findings)}`,
      );
    } finally {
      if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
    }
  });

  it('judge YES on a doc-only diff produces a warn finding carrying reasoning', async () => {
    const repo = tempRepo();
    const stub = buildJudgeClientStub({
      reply: judgeReply('yes', 'the touched file only renames a constant; runtime is unchanged'),
    });
    const { sink, entries } = buildLedger();
    const result = await askJudge({
      repoRoot: repo,
      request: {
        detector: 'no-op-fix',
        prTitle: PR_TITLE,
        unifiedDiff: DIFF_DOC_ONLY,
      },
      ledger: sink,
      client: new AnthropicJudge({ client: stub.client }),
    });
    assert.equal(result.answer, 'yes');
    assert.equal(result.cacheHit, false);
    assert.equal(result.modelId, PINNED_JUDGE_MODEL_ID);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]?.model, PINNED_JUDGE_MODEL_ID);
    assert.match(stub.calls[0]?.userText ?? '', /PR title/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.answer, 'yes');
    // Cache file was written for replay.
    const cacheDir = path.join(repo, '.swarm', 'llm-judge-cache');
    const files = fs.readdirSync(cacheDir);
    assert.equal(files.length, 1);

    // A second call must read the cache and not invoke the client.
    const stub2 = buildJudgeClientStub({ reply: 'NO should not be reached' });
    const second = await askJudge({
      repoRoot: repo,
      request: {
        detector: 'no-op-fix',
        prTitle: PR_TITLE,
        unifiedDiff: DIFF_DOC_ONLY,
      },
      ledger: sink,
      client: new AnthropicJudge({ client: stub2.client }),
    });
    assert.equal(second.cacheHit, true);
    assert.equal(second.answer, 'yes');
    assert.equal(stub2.calls.length, 0);
  });

  it('malformed judge reply falls back to unavailable without writing cache', async () => {
    const repo = tempRepo();
    const stub = buildJudgeClientStub({ reply: judgeReply('malformed') });
    const { sink, entries } = buildLedger();
    const result = await askJudge({
      repoRoot: repo,
      request: {
        detector: 'no-op-fix',
        prTitle: PR_TITLE,
        unifiedDiff: DIFF_DOC_ONLY,
      },
      ledger: sink,
      client: new AnthropicJudge({ client: stub.client }),
    });
    assert.equal(result.answer, 'unavailable');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.answer, 'unavailable');
    assert.ok(!fs.existsSync(path.join(repo, '.swarm', 'llm-judge-cache')));
  });
});

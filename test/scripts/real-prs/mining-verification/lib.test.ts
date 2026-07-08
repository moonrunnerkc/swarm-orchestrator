import { strict as assert } from 'node:assert';
import {
  attributionModes,
  patternStage,
  summarizeControl,
  type ControlEntryLike,
  type PrMeta,
} from '../../../../scripts/real-prs/mining-verification/lib';
import type { ConversationEntry } from '../../../../scripts/real-prs/lib/github';

function meta(over: Partial<PrMeta> = {}): PrMeta {
  return { title: '', body: '', authorLogin: '', headRef: '', commitMessages: [], ...over };
}

function convo(body: string, source: ConversationEntry['source'] = 'issue-comment'): ConversationEntry {
  return { source, author: 'maintainer', body };
}

describe('mining-verification lib', () => {
  describe('attributionModes', () => {
    it('attributes a claude-code body-marker PR in both the miner and full modes', () => {
      const r = attributionModes(meta({ body: 'Generated with Claude Code' }));
      assert.equal(r.minerMode?.vendor, 'claude-code');
      assert.equal(r.fullMode?.vendor, 'claude-code');
    });

    it('attributes a bot-author PR only in full mode, exposing the miner narrowing', () => {
      // A copilot PR whose only signal is the bot author: the miner passes only
      // title+body to detectAgent, so it cannot see the author and misses it.
      const r = attributionModes(meta({ authorLogin: 'copilot-swe-agent[bot]' }));
      assert.equal(r.minerMode, undefined);
      assert.equal(r.fullMode?.vendor, 'copilot-workspace');
    });

    it('attributes a branch-only agent PR in full mode but not the miner mode', () => {
      const r = attributionModes(meta({ headRef: 'codex/fix-thing' }));
      assert.equal(r.minerMode, undefined);
      assert.equal(r.fullMode?.vendor, 'codex-cli');
    });

    it('attributes neither mode for a human PR with no agent signal', () => {
      const r = attributionModes(meta({ title: 'Fix bug', body: 'closes #4', authorLogin: 'alice' }));
      assert.equal(r.minerMode, undefined);
      assert.equal(r.fullMode, undefined);
    });
  });

  describe('patternStage', () => {
    it('hits and names assertion-strip when a maintainer says the test no longer asserts', () => {
      const r = patternStage([convo('This no longer asserts anything meaningful.')]);
      assert.equal(r.hit, true);
      assert.equal(r.signals[0]?.category, 'assertion-strip');
    });

    it('misses when the complaint is not a cheat complaint', () => {
      const r = patternStage([convo('CI is failing on this, please rebase onto main.')]);
      assert.equal(r.hit, false);
      assert.equal(r.signals.length, 0);
    });

    it('dedupes repeated phrasings across entries to distinct signals', () => {
      const r = patternStage([convo('no longer asserts'), convo('no longer asserts')]);
      assert.equal(r.signals.length, 1);
    });
  });

  describe('summarizeControl', () => {
    it('counts pattern, both attribution modes, and the full-only narrowing', () => {
      const entries: ControlEntryLike[] = [
        { pattern: { hit: true }, attribution: { minerAttributed: true, fullAttributed: true } },
        { pattern: { hit: true }, attribution: { minerAttributed: false, fullAttributed: true } },
        { pattern: { hit: false }, attribution: { minerAttributed: false, fullAttributed: false } },
      ];
      const s = summarizeControl(entries);
      assert.equal(s.total, 3);
      assert.equal(s.patternHit, 2);
      assert.equal(s.minerAttributed, 1);
      assert.equal(s.fullAttributed, 2);
      assert.equal(s.fullOnlyAttributed, 1);
    });

    it('buckets arbiter outcomes into confirmed, false-alarm, and split', () => {
      const entries: ControlEntryLike[] = [
        { pattern: { hit: true }, attribution: { minerAttributed: true, fullAttributed: true }, arbiter: { confirmed: true, agreed: true } },
        { pattern: { hit: true }, attribution: { minerAttributed: true, fullAttributed: true }, arbiter: { confirmed: false, agreed: true } },
        { pattern: { hit: true }, attribution: { minerAttributed: true, fullAttributed: true }, arbiter: { confirmed: null, agreed: false } },
      ];
      const s = summarizeControl(entries);
      assert.equal(s.arbiterEvaluated, 3);
      assert.equal(s.arbiterConfirmed, 1);
      assert.equal(s.arbiterFalseAlarm, 1);
      assert.equal(s.arbiterSplit, 1);
    });
  });
});

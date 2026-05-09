import { strict as assert } from 'assert';
import {
  TOURNAMENT_VERIFIER_PERSONA,
  clampScore,
  parseVerifierScore,
  renderVerifierPrompt,
  scoreCandidate,
} from '../../src/persona/verifier-persona';
import { StubSession } from '../../src/session/stub-session';
import type { ObligationV1 } from '../../src/contract/types';

describe('persona/verifier-persona', () => {
  describe('parseVerifierScore', () => {
    it('parses a strict JSON envelope', () => {
      const v = parseVerifierScore('{"score": 0.85, "rationale": "looks good"}');
      assert.equal(v.score, 0.85);
      assert.equal(v.rationale, 'looks good');
    });

    it('tolerates a ```json fence', () => {
      const v = parseVerifierScore('```json\n{"score": 0.5, "rationale": "ok"}\n```');
      assert.equal(v.score, 0.5);
      assert.equal(v.rationale, 'ok');
    });

    it('clamps out-of-range scores into [0, 1]', () => {
      assert.equal(parseVerifierScore('{"score": 1.5, "rationale": "x"}').score, 1);
      assert.equal(parseVerifierScore('{"score": -0.3, "rationale": "x"}').score, 0);
    });

    it('returns a 0 score with diagnostic rationale on no JSON', () => {
      const v = parseVerifierScore('this is just prose, no JSON anywhere');
      assert.equal(v.score, 0);
      assert.match(v.rationale, /no JSON/);
    });

    it('returns a 0 score on malformed JSON object', () => {
      // Has both braces so the regex extracts a candidate, but JSON.parse fails.
      const v = parseVerifierScore('{"score": 0.5,, "rationale": "x"}');
      assert.equal(v.score, 0);
      assert.match(v.rationale, /JSON parse error/);
    });

    it('returns a 0 score with diagnostic rationale when no JSON object closes', () => {
      const v = parseVerifierScore('{"score": 0.5, "rationale": ');
      assert.equal(v.score, 0);
      assert.match(v.rationale, /no JSON envelope/);
    });

    it('truncates excessively long rationales', () => {
      const long = 'x'.repeat(500);
      const v = parseVerifierScore(`{"score": 0.5, "rationale": "${long}"}`);
      assert.ok(v.rationale.length <= 240);
    });

    it('handles non-string rationale gracefully', () => {
      const v = parseVerifierScore('{"score": 0.7, "rationale": null}');
      assert.equal(v.score, 0.7);
      assert.equal(v.rationale, 'no rationale');
    });

    it('preserves the raw text on every verdict', () => {
      const raw = '{"score": 0.4, "rationale": "meh"}';
      const v = parseVerifierScore(raw);
      assert.equal(v.rawText, raw);
    });
  });

  describe('clampScore', () => {
    it('clamps numeric inputs', () => {
      assert.equal(clampScore(0.5), 0.5);
      assert.equal(clampScore(2), 1);
      assert.equal(clampScore(-1), 0);
    });

    it('coerces strings', () => {
      assert.equal(clampScore('0.7'), 0.7);
    });

    it('returns 0 for non-numeric and NaN', () => {
      assert.equal(clampScore('abc'), 0);
      assert.equal(clampScore(NaN), 0);
      assert.equal(clampScore(null), 0);
    });
  });

  describe('renderVerifierPrompt', () => {
    it('embeds the obligation JSON and candidate text', () => {
      const obligation: ObligationV1 = { type: 'file-must-exist', path: 'src/x.ts' };
      const prompt = renderVerifierPrompt(obligation, 'export const x = 1;', 0);
      assert.match(prompt, /file-must-exist/);
      assert.match(prompt, /src\/x\.ts/);
      assert.match(prompt, /export const x = 1;/);
      assert.match(prompt, /<<<CANDIDATE/);
      assert.match(prompt, /CANDIDATE>>>/);
    });
  });

  describe('TOURNAMENT_VERIFIER_PERSONA', () => {
    it('is a haiku-tier persona with empty handles', () => {
      assert.equal(TOURNAMENT_VERIFIER_PERSONA.tier, 'haiku');
      assert.equal(TOURNAMENT_VERIFIER_PERSONA.id, 'tournament-verifier');
      assert.equal(TOURNAMENT_VERIFIER_PERSONA.handles.length, 0);
    });

    it('has zero temperature for deterministic scoring', () => {
      assert.equal(TOURNAMENT_VERIFIER_PERSONA.sampling.temperature, 0);
    });
  });

  describe('scoreCandidate', () => {
    it('dispatches the verifier persona and returns a parsed verdict', async () => {
      const session = new StubSession({
        projectContext: 'CTX',
        responder: () => '{"score": 0.9, "rationale": "great"}',
      });
      const obligation: ObligationV1 = { type: 'file-must-exist', path: 'a.txt' };
      const result = await scoreCandidate(session, obligation, 'hello', 0);
      assert.equal(result.score, 0.9);
      assert.equal(result.rationale, 'great');
      assert.ok(result.usage.outputTokens > 0);
    });
  });
});

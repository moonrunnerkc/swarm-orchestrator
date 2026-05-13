import { strict as assert } from 'assert';
import {
  EXTRACTOR_GRAMMARS,
  SESSION_GRAMMARS,
  formatGrammarWarning,
  resolveGrammarForConsumer,
} from '../../../src/cli/v8/grammar-resolve';

/**
 * The grammar-resolve helper is the single source of truth for what
 * `--local-grammar` means to each consumer. The tests exercise the
 * resolution table and the warning-string format the prompt specified.
 */

describe('cli/v8/grammar-resolve resolution', () => {
  it('returns null/null when no grammar was requested', () => {
    const r = resolveGrammarForConsumer('extractor', null);
    assert.equal(r.effective, null);
    assert.equal(r.coercion, null);
  });

  it('honors json-schema for both consumers without coercion', () => {
    const ex = resolveGrammarForConsumer('extractor', 'json-schema');
    assert.equal(ex.effective, 'json-schema');
    assert.equal(ex.coercion, null);
    const ses = resolveGrammarForConsumer('session', 'json-schema');
    assert.equal(ses.effective, 'json-schema');
    assert.equal(ses.coercion, null);
  });

  it('coerces gbnf to auto for the extractor and records the peer-honor outcome', () => {
    const r = resolveGrammarForConsumer('extractor', 'gbnf');
    assert.equal(r.effective, 'auto');
    assert.ok(r.coercion);
    assert.equal(r.coercion?.consumer, 'extractor');
    assert.equal(r.coercion?.requested, 'gbnf');
    assert.equal(r.coercion?.peerConsumer, 'session');
    assert.equal(r.coercion?.peerConsumerOutcome, 'honored');
  });

  it('coerces outlines to auto for the extractor; session honors it', () => {
    const ex = resolveGrammarForConsumer('extractor', 'outlines');
    assert.equal(ex.effective, 'auto');
    assert.equal(ex.coercion?.peerConsumerOutcome, 'honored');
    const ses = resolveGrammarForConsumer('session', 'outlines');
    assert.equal(ses.effective, 'outlines');
    assert.equal(ses.coercion, null);
  });

  it('exports the accepted-values tables that match factory expectations', () => {
    assert.deepEqual([...EXTRACTOR_GRAMMARS], ['auto', 'json-schema', 'none']);
    assert.deepEqual([...SESSION_GRAMMARS], ['auto', 'gbnf', 'json-schema', 'outlines', 'none']);
  });
});

describe('cli/v8/grammar-resolve warning text', () => {
  it('names the flag, the value, the consumer, and the session honor when peer accepts', () => {
    const r = resolveGrammarForConsumer('extractor', 'gbnf');
    assert.ok(r.coercion);
    const msg = formatGrammarWarning(r.coercion!);
    assert.match(msg, /^warning: --local-grammar=gbnf/);
    assert.match(msg, /does not apply to the extractor/);
    assert.match(msg, /extractor accepts: auto, json-schema, none/);
    assert.match(msg, /extractor will use 'auto'/);
    assert.match(msg, /Session will use 'gbnf' as requested\./);
  });

  it('formats the both-coerced case naming both consumers', () => {
    // Synthesize a coercion record manually — no live value triggers
    // this branch today, but the formatter must still cover it for
    // forward-compat tests of new grammars.
    const msg = formatGrammarWarning({
      consumer: 'extractor',
      requested: 'gbnf',
      effective: 'auto',
      accepted: ['auto', 'json-schema', 'none'],
      peerConsumerOutcome: 'coerced',
      peerConsumer: 'session',
    });
    assert.match(msg, /does not apply to the extractor/);
    assert.match(msg, /or the session/);
    assert.match(msg, /both consumers will use 'auto'\./);
  });
});

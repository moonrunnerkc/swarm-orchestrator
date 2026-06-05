import { strict as assert } from 'assert';
import { parseToolVerdict } from '../../../../src/audit/cheat-detector/llm-judge/anthropic-judge';

/** Build a forced-tool-use response content array. */
function toolUse(name: string, input: unknown): unknown[] {
  return [{ type: 'tool_use', name, input }];
}

describe('llm-judge / anthropic-judge structured verdict', () => {
  it('reads a yes verdict and its reason from the record_verdict tool', () => {
    const v = parseToolVerdict(toolUse('record_verdict', { answer: 'yes', reason: 'the path is untouched' }));
    assert.equal(v.answer, 'yes');
    assert.equal(v.reason, 'the path is untouched');
  });

  it('reads a no verdict', () => {
    const v = parseToolVerdict(toolUse('record_verdict', { answer: 'no', reason: 'callers were updated' }));
    assert.equal(v.answer, 'no');
  });

  it('fails closed to unavailable on a plain text reply (no tool_use)', () => {
    const v = parseToolVerdict([{ type: 'text', text: 'YES this is definitely a cheat' }]);
    assert.equal(v.answer, 'unavailable', 'a text reply must never be read as a confirm');
  });

  it('fails closed when the tool answer is outside {yes, no}', () => {
    for (const bad of ['maybe', 'YES', 'true', '', undefined, null, 1]) {
      const v = parseToolVerdict(toolUse('record_verdict', { answer: bad }));
      assert.equal(v.answer, 'unavailable', `answer=${JSON.stringify(bad)} must not confirm`);
    }
  });

  it('fails closed when a different tool is called', () => {
    const v = parseToolVerdict(toolUse('something_else', { answer: 'yes' }));
    assert.equal(v.answer, 'unavailable');
  });

  it('fails closed on malformed content (non-array, empty, missing input)', () => {
    assert.equal(parseToolVerdict(null).answer, 'unavailable');
    assert.equal(parseToolVerdict('YES').answer, 'unavailable');
    assert.equal(parseToolVerdict([]).answer, 'unavailable');
    assert.equal(parseToolVerdict(toolUse('record_verdict', undefined)).answer, 'unavailable');
  });

  it('never returns a confirm for any malformed shape', () => {
    const malformed: unknown[] = [
      'YES',
      null,
      [],
      [{ type: 'text', text: 'YES' }],
      toolUse('record_verdict', { answer: 'YES' }),
      toolUse('record_verdict', {}),
      toolUse('wrong', { answer: 'yes' }),
    ];
    for (const m of malformed) {
      assert.notEqual(parseToolVerdict(m).answer, 'yes');
    }
  });
});

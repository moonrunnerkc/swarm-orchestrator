import { strict as assert } from 'assert';
import {
  parseClaudeCodeCandidates,
  parseClaudeCodeEnvelope,
} from '../../../../src/falsification/adapters/profiles/claude-code';
import { CLAUDE_CODE_CANDIDATE_COUNT } from '../../../../src/falsification/adapters/profiles/claude-code';

function makeCandidates(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `c-${i}`,
    rationale: `candidate ${i}`,
    files: [{ relPath: `c-${i}/file.ts`, bytes: 'export const x = 1;\n' }],
  }));
}

function makeEnvelope(
  result: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    stop_reason: 'end_turn',
    num_turns: 1,
    ...overrides,
  });
}

describe('parseClaudeCodeEnvelope', () => {
  it('parses a well-formed envelope', () => {
    const env = parseClaudeCodeEnvelope(makeEnvelope('hi'));
    assert.equal(env.type, 'result');
    assert.equal(env.subtype, 'success');
    assert.equal(env.isError, false);
    assert.equal(env.result, 'hi');
    assert.equal(env.totalCostUsd, 0.05);
    assert.equal(env.inputTokens, 100);
    assert.equal(env.outputTokens, 50);
  });

  it('throws on empty stdout', () => {
    assert.throws(() => parseClaudeCodeEnvelope(''), /no stdout/);
  });

  it('throws when stdout is not JSON', () => {
    assert.throws(() => parseClaudeCodeEnvelope('not json'), /did not parse/);
  });

  it('throws when required fields are missing', () => {
    assert.throws(
      () => parseClaudeCodeEnvelope(JSON.stringify({})),
      /missing string field "type"/,
    );
  });

  it('treats missing usage fields as zero', () => {
    const env = parseClaudeCodeEnvelope(makeEnvelope('hi', { usage: undefined }));
    assert.equal(env.inputTokens, 0);
    assert.equal(env.outputTokens, 0);
  });
});

describe('parseClaudeCodeCandidates', () => {
  it('parses candidates from a successful envelope', () => {
    const candidates = makeCandidates(CLAUDE_CODE_CANDIDATE_COUNT);
    const inner = ['```json', JSON.stringify({ candidates }), '```'].join('\n');
    const stdout = makeEnvelope(inner);
    const parsed = parseClaudeCodeCandidates(stdout);
    assert.equal(parsed.length, CLAUDE_CODE_CANDIDATE_COUNT);
    assert.equal(parsed[0]!.name, 'c-0');
  });

  it('throws when envelope reports is_error=true', () => {
    const stdout = makeEnvelope('Auth failed.', { is_error: true, subtype: 'error_max_budget_usd' });
    assert.throws(() => parseClaudeCodeCandidates(stdout), /reported is_error=true/);
  });

  it('throws when result is empty', () => {
    const stdout = makeEnvelope('');
    assert.throws(() => parseClaudeCodeCandidates(stdout), /empty `result`/);
  });

  it('throws when fenced JSON is missing from result', () => {
    const stdout = makeEnvelope('Here are some thoughts but no fenced JSON.');
    assert.throws(() => parseClaudeCodeCandidates(stdout), /did not contain a fenced/);
  });
});

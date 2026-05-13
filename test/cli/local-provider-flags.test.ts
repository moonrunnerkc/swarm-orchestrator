import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyLocalProviderFlag,
  emptyLocalProviderFlagValues,
  isLocalProviderFlag,
  LOCAL_GRAMMAR_MODES,
  LOCAL_PROVIDER_FLAG_TOKENS,
} from '../../src/cli/v8/local-provider-flags';

const identity = (raw: string): string => raw;

function parse(argv: string[]): ReturnType<typeof emptyLocalProviderFlagValues> {
  const out = emptyLocalProviderFlagValues();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (isLocalProviderFlag(a)) {
      i = applyLocalProviderFlag(argv, i, out, identity);
    } else {
      throw new Error(`unexpected non-local flag: ${a}`);
    }
  }
  return out;
}

describe('cli/v8/local-provider-flags', () => {
  it('LOCAL_PROVIDER_FLAG_TOKENS lists the ten documented flags', () => {
    assert.equal(LOCAL_PROVIDER_FLAG_TOKENS.length, 10);
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-backend'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-base-url'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-model-extractor'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-model-session'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-persona-model-map'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-grammar'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-request-timeout-ms'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-max-concurrency'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-api-key'));
    assert.ok(LOCAL_PROVIDER_FLAG_TOKENS.includes('--local-seed'));
  });

  it('isLocalProviderFlag recognizes every documented flag and rejects others', () => {
    for (const t of LOCAL_PROVIDER_FLAG_TOKENS) {
      assert.equal(isLocalProviderFlag(t), true, `${t} should be a local flag`);
    }
    assert.equal(isLocalProviderFlag('--extractor'), false);
    assert.equal(isLocalProviderFlag('--local-unknown'), false);
  });

  it('--local-backend stores a valid backend name', () => {
    const v = parse(['--local-backend', 'ollama']);
    assert.equal(v.backend, 'ollama');
  });

  it('--local-backend rejects an unknown backend name', () => {
    assert.throws(
      () => parse(['--local-backend', 'mlc']),
      /invalid --local-backend "mlc"; expected one of: openai-compatible, ollama, llama-cpp, vllm/,
    );
  });

  it('--local-base-url stores the raw URL', () => {
    const v = parse(['--local-base-url', 'http://example.local:11434/v1']);
    assert.equal(v.baseUrl, 'http://example.local:11434/v1');
  });

  it('--local-model-extractor and --local-model-session are independent', () => {
    const v = parse([
      '--local-model-extractor', 'qwen2.5-coder:14b',
      '--local-model-session', 'qwen2.5-coder:32b',
    ]);
    assert.equal(v.modelExtractor, 'qwen2.5-coder:14b');
    assert.equal(v.modelSession, 'qwen2.5-coder:32b');
  });

  it('--local-persona-model-map accepts an inline JSON string', () => {
    const v = parse([
      '--local-persona-model-map',
      '{"architect":"qwen2.5-coder:32b","verifier":"qwen2.5-coder:14b"}',
    ]);
    assert.deepEqual(v.personaModelMap, {
      architect: 'qwen2.5-coder:32b',
      verifier: 'qwen2.5-coder:14b',
    });
  });

  it('--local-persona-model-map reads a JSON file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-flag-'));
    try {
      const p = path.join(tmp, 'map.json');
      fs.writeFileSync(p, '{"architect":"a","builder":"b"}');
      const v = parse(['--local-persona-model-map', p]);
      assert.deepEqual(v.personaModelMap, { architect: 'a', builder: 'b' });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--local-persona-model-map reads a YAML file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-flag-'));
    try {
      const p = path.join(tmp, 'map.yaml');
      fs.writeFileSync(
        p,
        ['# comment', 'architect: qwen2.5-coder:32b', 'verifier: "qwen2.5-coder:14b"', ''].join(
          '\n',
        ),
      );
      const v = parse(['--local-persona-model-map', p]);
      assert.deepEqual(v.personaModelMap, {
        architect: 'qwen2.5-coder:32b',
        verifier: 'qwen2.5-coder:14b',
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--local-persona-model-map rejects unsupported extensions', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-flag-'));
    try {
      const p = path.join(tmp, 'map.toml');
      fs.writeFileSync(p, 'whatever');
      assert.throws(
        () => parse(['--local-persona-model-map', p]),
        /unsupported extension/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--local-persona-model-map rejects non-string values', () => {
    assert.throws(
      () => parse(['--local-persona-model-map', '{"architect": 5}']),
      /must be a string/,
    );
  });

  it('--local-grammar accepts every documented mode', () => {
    for (const m of LOCAL_GRAMMAR_MODES) {
      const v = parse(['--local-grammar', m]);
      assert.equal(v.grammar, m);
    }
  });

  it('--local-grammar rejects unknown modes', () => {
    assert.throws(
      () => parse(['--local-grammar', 'cfg']),
      /invalid --local-grammar "cfg"; expected one of: auto, gbnf, json-schema, outlines, none/,
    );
  });

  it('--local-request-timeout-ms requires a positive integer', () => {
    const v = parse(['--local-request-timeout-ms', '60000']);
    assert.equal(v.requestTimeoutMs, 60000);
    assert.throws(
      () => parse(['--local-request-timeout-ms', '0']),
      /must be a positive integer/,
    );
    assert.throws(
      () => parse(['--local-request-timeout-ms', '-1']),
      /must be a positive integer/,
    );
    assert.throws(
      () => parse(['--local-request-timeout-ms', 'abc']),
      /must be a positive integer/,
    );
  });

  it('--local-max-concurrency requires a positive integer', () => {
    const v = parse(['--local-max-concurrency', '4']);
    assert.equal(v.maxConcurrency, 4);
    assert.throws(
      () => parse(['--local-max-concurrency', '0']),
      /must be a positive integer/,
    );
  });

  it('--local-api-key stores the raw value', () => {
    const v = parse(['--local-api-key', 'sk-local-abc']);
    assert.equal(v.apiKey, 'sk-local-abc');
  });

  it('--local-seed requires a non-negative integer', () => {
    const v = parse(['--local-seed', '42']);
    assert.equal(v.seed, 42);
    const z = parse(['--local-seed', '0']);
    assert.equal(z.seed, 0);
    assert.throws(
      () => parse(['--local-seed', '-1']),
      /must be a non-negative integer/,
    );
  });

  it('a flag without a value raises a corrective error', () => {
    assert.throws(
      () => parse(['--local-backend']),
      /--local-backend requires a value/,
    );
  });
});

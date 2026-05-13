import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProviderConfig } from '../../src/config/provider-config';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'provider-config-'));
}

function writeConfig(root: string, body: string): void {
  const dir = path.join(root, '.swarm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), body);
}

describe('config/provider-config', () => {
  it('returns an empty config when the file does not exist', () => {
    const root = makeRoot();
    try {
      const cfg = loadProviderConfig(root);
      assert.equal(cfg.extractor, null);
      assert.equal(cfg.session, null);
      assert.equal(cfg.local.backend, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns an empty config when the file has no provider block', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'rule_packs:\n  - standard\n');
      const cfg = loadProviderConfig(root);
      assert.equal(cfg.extractor, null);
      assert.equal(cfg.session, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses a complete provider block', () => {
    const root = makeRoot();
    try {
      writeConfig(
        root,
        [
          'provider:',
          '  extractor: deterministic',
          '  session: local',
          '  local:',
          '    backend: ollama',
          '    base_url: http://localhost:11434/v1',
          '    model_extractor: qwen2.5-coder:14b',
          '    model_session: qwen2.5-coder:32b',
          '    grammar: auto',
          '    request_timeout_ms: 90000',
          '    max_concurrency: 2',
          '    seed: 0',
          '    persona_model_map:',
          '      architect: qwen2.5-coder:32b',
          '      verifier: qwen2.5-coder:14b',
          '',
        ].join('\n'),
      );
      const cfg = loadProviderConfig(root);
      assert.equal(cfg.extractor, 'deterministic');
      assert.equal(cfg.session, 'local');
      assert.equal(cfg.local.backend, 'ollama');
      assert.equal(cfg.local.baseUrl, 'http://localhost:11434/v1');
      assert.equal(cfg.local.modelExtractor, 'qwen2.5-coder:14b');
      assert.equal(cfg.local.modelSession, 'qwen2.5-coder:32b');
      assert.equal(cfg.local.grammar, 'auto');
      assert.equal(cfg.local.requestTimeoutMs, 90000);
      assert.equal(cfg.local.maxConcurrency, 2);
      assert.equal(cfg.local.seed, 0);
      assert.deepEqual(cfg.local.personaModelMap, {
        architect: 'qwen2.5-coder:32b',
        verifier: 'qwen2.5-coder:14b',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors a single field when set in isolation', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider:\n  extractor: deterministic\n');
      const cfg = loadProviderConfig(root);
      assert.equal(cfg.extractor, 'deterministic');
      assert.equal(cfg.session, null);
      assert.equal(cfg.local.backend, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails loud on an unknown provider key', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider:\n  extractor: deterministic\n  bogus: x\n');
      assert.throws(
        () => loadProviderConfig(root),
        /unknown key "provider.bogus"/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails loud on an unknown local key', () => {
    const root = makeRoot();
    try {
      writeConfig(
        root,
        ['provider:', '  local:', '    backend: ollama', '    bogus_key: x', ''].join('\n'),
      );
      assert.throws(
        () => loadProviderConfig(root),
        /unknown key "provider.local.bogus_key"/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid extractor value', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider:\n  extractor: grpc\n');
      assert.throws(
        () => loadProviderConfig(root),
        /provider\.extractor.*not one of/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid local.backend value', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider:\n  local:\n    backend: mlc\n');
      assert.throws(
        () => loadProviderConfig(root),
        /provider\.local\.backend.*one of/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a non-mapping provider block', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider: deterministic\n');
      assert.throws(
        () => loadProviderConfig(root),
        /`provider` must be a mapping/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed YAML', () => {
    const root = makeRoot();
    try {
      writeConfig(root, 'provider:\n  extractor: [unbalanced\n');
      assert.throws(
        () => loadProviderConfig(root),
        /not valid YAML/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

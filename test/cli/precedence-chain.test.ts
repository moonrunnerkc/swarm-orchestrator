import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  emptyLocalProviderFlagValues,
  resolveEffectiveLocalProvider,
} from '../../src/cli/v8/local-provider-flags';
import { loadProviderConfig } from '../../src/config/provider-config';

/**
 * End-to-end exercise of the documented precedence chain for the
 * `LOCAL_LLM_BASE_URL` configuration source:
 *
 *     CLI flag > env var > `.swarm/config.yaml provider.local.base_url` > default
 *
 * Each step in this test sets the value via one source and verifies the
 * resolver returns it; subsequent steps shadow it with a higher-priority
 * source and the resolver picks the higher one. This proves the chain
 * works without relying on any handler-level integration code.
 */
describe('cli/v8 — precedence chain: --local-base-url / LOCAL_LLM_BASE_URL / config', () => {
  let root: string;
  const originalBaseUrl = process.env['LOCAL_LLM_BASE_URL'];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'precedence-'));
    delete process.env['LOCAL_LLM_BASE_URL'];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (originalBaseUrl === undefined) {
      delete process.env['LOCAL_LLM_BASE_URL'];
    } else {
      process.env['LOCAL_LLM_BASE_URL'] = originalBaseUrl;
    }
  });

  function writeConfigBaseUrl(value: string): void {
    const dir = path.join(root, '.swarm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.yaml'),
      ['provider:', '  local:', `    base_url: ${value}`, ''].join('\n'),
    );
  }

  it('uses the default (null → factory fallback) when no source supplies a value', () => {
    const config = loadProviderConfig(root);
    const resolved = resolveEffectiveLocalProvider(emptyLocalProviderFlagValues(), config.local);
    assert.equal(resolved.baseUrl, null);
  });

  it('config wins over the default', () => {
    writeConfigBaseUrl('http://config.local:1111/v1');
    const config = loadProviderConfig(root);
    const resolved = resolveEffectiveLocalProvider(emptyLocalProviderFlagValues(), config.local);
    assert.equal(resolved.baseUrl, 'http://config.local:1111/v1');
  });

  it('env var wins over the config file', () => {
    writeConfigBaseUrl('http://config.local:1111/v1');
    process.env['LOCAL_LLM_BASE_URL'] = 'http://env.local:2222/v1';
    const config = loadProviderConfig(root);
    const resolved = resolveEffectiveLocalProvider(emptyLocalProviderFlagValues(), config.local);
    assert.equal(resolved.baseUrl, 'http://env.local:2222/v1');
  });

  it('flag wins over both env var and config file', () => {
    writeConfigBaseUrl('http://config.local:1111/v1');
    process.env['LOCAL_LLM_BASE_URL'] = 'http://env.local:2222/v1';
    const flag = emptyLocalProviderFlagValues();
    flag.baseUrl = 'http://flag.local:3333/v1';
    const config = loadProviderConfig(root);
    const resolved = resolveEffectiveLocalProvider(flag, config.local);
    assert.equal(resolved.baseUrl, 'http://flag.local:3333/v1');
  });

  it('preserves env-var precedence over config when only env and config are set', () => {
    writeConfigBaseUrl('http://config.local:1111/v1');
    process.env['LOCAL_LLM_BASE_URL'] = 'http://env.local:2222/v1';
    const config = loadProviderConfig(root);
    const resolved = resolveEffectiveLocalProvider(emptyLocalProviderFlagValues(), config.local);
    assert.equal(resolved.baseUrl, 'http://env.local:2222/v1');
  });
});

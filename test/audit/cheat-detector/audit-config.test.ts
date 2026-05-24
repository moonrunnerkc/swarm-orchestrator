import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAuditConfig } from '../../../src/audit/cheat-detector/audit-config';

function withConfig(text: string, fn: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cfg-'));
  fs.mkdirSync(path.join(repo, '.swarm'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.swarm', 'audit-config.yaml'), text, 'utf8');
  try {
    fn(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

describe('cheat-detector / audit-config', () => {
  it('defaults intentSeverityPolicy to "strict" when config file is absent', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cfg-empty-'));
    try {
      const cfg = loadAuditConfig(repo);
      assert.equal(cfg.intentSeverityPolicy, 'strict');
      assert.deepEqual(cfg.excludePaths, []);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('defaults intentSeverityPolicy to "strict" when key is absent', () => {
    withConfig('excludePaths:\n  - fixtures/**\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'strict');
    });
  });

  it('parses intentSeverityPolicy: strict', () => {
    withConfig('intentSeverityPolicy: strict\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'strict');
    });
  });

  it('parses intentSeverityPolicy: lenient', () => {
    withConfig('intentSeverityPolicy: lenient\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'lenient');
    });
  });

  it('parses intentSeverityPolicy: off', () => {
    withConfig('intentSeverityPolicy: off\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'off');
    });
  });

  it('accepts quoted value', () => {
    withConfig('intentSeverityPolicy: "off"\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'off');
    });
  });

  it('is case-insensitive on the value', () => {
    withConfig('intentSeverityPolicy: STRICT\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'strict');
    });
  });

  it('falls back to default on unknown value rather than throwing', () => {
    withConfig('intentSeverityPolicy: paranoid\n', (repo) => {
      assert.equal(loadAuditConfig(repo).intentSeverityPolicy, 'strict');
    });
  });

  it('parses both excludePaths and intentSeverityPolicy together', () => {
    const yaml = 'excludePaths:\n  - fixtures/**\n  - test/data/*\nintentSeverityPolicy: lenient\n';
    withConfig(yaml, (repo) => {
      const cfg = loadAuditConfig(repo);
      assert.equal(cfg.intentSeverityPolicy, 'lenient');
      assert.deepEqual(cfg.excludePaths, ['fixtures/**', 'test/data/*']);
    });
  });
});

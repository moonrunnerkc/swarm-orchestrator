import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAuditConfig } from '../../../src/audit/cheat-detector/audit-config';
import { configureLogger, getLoggerConfig } from '../../../src/logger';

function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  // The logger writes warn/error to stderr by default in text mode.
  (process.stderr as { write: typeof process.stderr.write }).write = ((
    chunk: string | Uint8Array,
  ): boolean => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    (process.stderr as { write: typeof process.stderr.write }).write = original;
  }
  return captured;
}

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

  describe('unrecognized-field warning', () => {
    const priorConfig = getLoggerConfig();
    before(() => configureLogger({ level: 'warn', diagnosticsToStderr: true }));
    after(() => configureLogger({ level: priorConfig.level, diagnosticsToStderr: priorConfig.diagnosticsToStderr }));

    it('warns when the file has content but no recognized fields parse', () => {
      // Typo: `exclude_paths` (snake_case) instead of `excludePaths`. The
      // parser sees nothing it recognizes and returns the default config.
      // Without the warning, the user thinks the exclusion is in effect.
      const yaml = 'exclude_paths:\n  - fixtures/**\n';
      let stderr = '';
      withConfig(yaml, (repo) => {
        stderr = captureStderr(() => {
          loadAuditConfig(repo);
        });
      });
      assert.match(stderr, /audit-config/);
      assert.match(stderr, /no recognized fields/);
    });

    it('does not warn when the file is empty or comment-only', () => {
      const yaml = '# just a comment, intentionally empty\n# more comments\n';
      let stderr = '';
      withConfig(yaml, (repo) => {
        stderr = captureStderr(() => {
          loadAuditConfig(repo);
        });
      });
      assert.equal(stderr, '');
    });

    it('does not warn when excludePaths parsed successfully', () => {
      const yaml = 'excludePaths:\n  - fixtures/**\n';
      let stderr = '';
      withConfig(yaml, (repo) => {
        stderr = captureStderr(() => {
          loadAuditConfig(repo);
        });
      });
      assert.equal(stderr, '');
    });

    it('does not warn when intentSeverityPolicy is present even with an unknown value', () => {
      const yaml = 'intentSeverityPolicy: paranoid\n';
      let stderr = '';
      withConfig(yaml, (repo) => {
        stderr = captureStderr(() => {
          loadAuditConfig(repo);
        });
      });
      assert.equal(stderr, '');
    });
  });

  describe('executionGrounded', () => {
    it('defaults to disabled when the block is absent', () => {
      withConfig('intentSeverityPolicy: strict\n', (repo) => {
        const eg = loadAuditConfig(repo).executionGrounded;
        assert.equal(eg.enabled, false);
        assert.equal(eg.mutation, true);
        assert.equal(eg.issueRepro, true);
        assert.equal(eg.coverage, true);
        assert.equal(eg.maxWallClockPerPrMs, 30 * 60 * 1000);
      });
    });
    it('reads the enabled flag, the per-check flags, and the wall-clock cap', () => {
      const yaml = [
        'executionGrounded:',
        '  enabled: true',
        '  mutation: true',
        '  issueRepro: false',
        '  coverage: true',
        '  maxWallClockPerPrMs: 600000',
        '',
      ].join('\n');
      withConfig(yaml, (repo) => {
        const eg = loadAuditConfig(repo).executionGrounded;
        assert.equal(eg.enabled, true);
        assert.equal(eg.issueRepro, false);
        assert.equal(eg.coverage, true);
        assert.equal(eg.maxWallClockPerPrMs, 600000);
      });
    });
    it('does not warn when only executionGrounded is set', () => {
      let stderr = '';
      withConfig('executionGrounded:\n  enabled: true\n', (repo) => {
        stderr = captureStderr(() => loadAuditConfig(repo));
      });
      assert.equal(stderr, '');
    });
  });
});

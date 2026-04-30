import * as assert from 'assert';
import { configureLogger, getLogger, getLoggerConfig, setPrettyMode } from '../src/logger';

/**
 * Log-level routing: the logger filters by configured level rank, and the
 * `--verbose` / `--quiet` flag wiring in cli.ts depends on this contract.
 *
 * The logger writes directly to process.stdout/process.stderr. Tests
 * intercept those for the duration of one logger interaction, then
 * restore so that mocha's reporter (which also writes to stdout) is
 * not captured. Each test snapshots and restores the logger config so
 * leakage is impossible.
 */

interface RunResult {
  stdout: string;
  stderr: string;
}

function runCaptured(fn: () => void): RunResult {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

describe('Logger level routing', () => {
  let originalConfig: ReturnType<typeof getLoggerConfig>;

  beforeEach(() => {
    originalConfig = getLoggerConfig();
  });

  afterEach(() => {
    configureLogger({
      level: originalConfig.level,
      outputFormat: originalConfig.outputFormat,
      diagnosticsToStderr: originalConfig.diagnosticsToStderr,
    });
    setPrettyMode(originalConfig.prettyMode);
  });

  describe('level: info (default)', () => {
    it('emits info, warn, error; suppresses debug and trace', () => {
      configureLogger({ level: 'info' });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.error('e');
        log.warn('w');
        log.info('i');
        log.debug('d');
        log.trace('tr');
      });
      const all = stdout + stderr;
      assert.match(all, /\[t\] e/);
      assert.match(all, /\[t\] w/);
      assert.match(all, /\[t\] i/);
      assert.doesNotMatch(all, /\[t\] d\b/);
      assert.doesNotMatch(all, /\[t\] tr/);
    });
  });

  describe('level: debug (--verbose)', () => {
    it('emits debug but still suppresses trace', () => {
      configureLogger({ level: 'debug' });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.debug('d');
        log.trace('tr');
      });
      const all = stdout + stderr;
      assert.match(all, /\[t\] d/);
      assert.doesNotMatch(all, /\[t\] tr/);
    });
  });

  describe('level: trace', () => {
    it('emits trace', () => {
      configureLogger({ level: 'trace' });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.trace('tr');
      });
      assert.match(stdout + stderr, /\[t\] tr/);
    });
  });

  describe('level: warn (--quiet)', () => {
    it('suppresses info, debug, and trace; emits warn and error', () => {
      configureLogger({ level: 'warn' });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.error('e');
        log.warn('w');
        log.info('i');
        log.debug('d');
        log.trace('tr');
      });
      const all = stdout + stderr;
      assert.match(all, /\[t\] e/);
      assert.match(all, /\[t\] w/);
      assert.doesNotMatch(all, /\[t\] i/);
      assert.doesNotMatch(all, /\[t\] d\b/);
      assert.doesNotMatch(all, /\[t\] tr/);
    });
  });

  describe('level: silent', () => {
    it('suppresses everything including errors', () => {
      configureLogger({ level: 'silent' });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.error('e');
        log.warn('w');
      });
      assert.strictEqual(stdout + stderr, '');
    });
  });

  describe('diagnosticsToStderr routing', () => {
    it('sends info/debug/trace to stderr when enabled (presenter owns stdout)', () => {
      configureLogger({ level: 'trace', diagnosticsToStderr: true });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.info('i');
        log.debug('d');
        log.trace('tr');
      });
      assert.strictEqual(stdout, '');
      assert.match(stderr, /\[t\] i/);
      assert.match(stderr, /\[t\] d/);
      assert.match(stderr, /\[t\] tr/);
    });

    it('sends info/debug/trace to stdout by default (legacy shape)', () => {
      configureLogger({ level: 'trace', diagnosticsToStderr: false });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.info('i');
        log.debug('d');
        log.trace('tr');
        log.error('e');
      });
      assert.match(stdout, /\[t\] i/);
      assert.match(stdout, /\[t\] d/);
      assert.match(stdout, /\[t\] tr/);
      assert.match(stderr, /\[t\] e/);
    });
  });

  describe('pretty mode', () => {
    it('hides [scope] prefix when prettyMode is on', () => {
      configureLogger({ level: 'info', diagnosticsToStderr: false });
      setPrettyMode(true);
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.info('hello');
      });
      const all = stdout + stderr;
      assert.match(all, /^hello/m);
      assert.doesNotMatch(all, /\[t\]/);
    });

    it('shows [scope] prefix when prettyMode is off', () => {
      configureLogger({ level: 'info', diagnosticsToStderr: false });
      setPrettyMode(false);
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.info('hello');
      });
      assert.match(stdout + stderr, /\[t\] hello/);
    });
  });

  describe('JSON output format', () => {
    it('emits structured records to stderr regardless of level routing', () => {
      configureLogger({ level: 'info', outputFormat: 'json', diagnosticsToStderr: true });
      const { stdout, stderr } = runCaptured(() => {
        const log = getLogger('t');
        log.info('hello');
      });
      assert.strictEqual(stdout, '');
      const lines = stderr.trim().split('\n').filter(Boolean);
      const record = JSON.parse(lines[lines.length - 1]!) as { level: string; scope: string; message: string };
      assert.strictEqual(record.level, 'info');
      assert.strictEqual(record.scope, 't');
      assert.strictEqual(record.message, 'hello');
    });
  });
});

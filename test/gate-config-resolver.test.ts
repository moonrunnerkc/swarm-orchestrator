import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load_quality_gates_config } from '../src/quality-gates/config-loader';

describe('gate-config-resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('defaults', () => {
    it('loads built-in defaults when no .swarm/gates.yaml exists', () => {
      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.failOnIssues, true);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 12);
      assert.strictEqual(config.gates.duplicateBlocks.maxOccurrences, 2);
      assert.strictEqual(config.gates.accessibility.enabled, true);
    });
  });

  describe('.swarm/gates.yaml', () => {
    it('merges partial overrides from .swarm/gates.yaml over defaults', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  duplicateBlocks:\n    minLines: 20\n    maxOccurrences: 5\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 20);
      assert.strictEqual(config.gates.duplicateBlocks.maxOccurrences, 5);
      // Non-overridden gate keeps defaults
      assert.strictEqual(config.gates.accessibility.enabled, true);
      // Non-overridden field within overridden gate keeps default
      assert.strictEqual(config.gates.duplicateBlocks.enabled, true);
    });

    it('treats empty .swarm/gates.yaml as equivalent to no file', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(path.join(swarmDir, 'gates.yaml'), '', 'utf8');

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 12);
      assert.strictEqual(config.gates.accessibility.enabled, true);
    });

    it('allows disabling a gate via .swarm/gates.yaml', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  accessibility:\n    enabled: false\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.accessibility.enabled, false);
    });

    it('allows overriding top-level config flags', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'failOnIssues: false\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.failOnIssues, false);
      assert.strictEqual(config.enabled, true);
    });
  });

  describe('explicit path override', () => {
    it('explicit path overrides .swarm/gates.yaml values', () => {
      // Set up .swarm/gates.yaml with minLines=20
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  duplicateBlocks:\n    minLines: 20\n',
        'utf8'
      );

      // Set up explicit config with minLines=30
      const explicitFile = path.join(tmpDir, 'custom-gates.yaml');
      fs.writeFileSync(
        explicitFile,
        'gates:\n  duplicateBlocks:\n    minLines: 30\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir, explicitFile);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 30);
    });

    it('throws when explicit path does not exist', () => {
      assert.throws(
        () => load_quality_gates_config(tmpDir, '/nonexistent/gates.yaml'),
        (err: Error) => err.message.includes('not found')
      );
    });
  });

  describe('unknown gate key validation', () => {
    it('rejects unknown gate keys in .swarm/gates.yaml with descriptive error', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  fooBarGate:\n    enabled: true\n',
        'utf8'
      );

      assert.throws(
        () => load_quality_gates_config(tmpDir),
        (err: Error) => {
          assert.ok(err.message.includes('fooBarGate'), 'Should include the unknown key name');
          assert.ok(err.message.includes('duplicateBlocks'), 'Should list valid gate keys');
          return true;
        }
      );
    });

    it('rejects unknown gate keys in explicit config path', () => {
      const explicitFile = path.join(tmpDir, 'bad-gates.yaml');
      fs.writeFileSync(
        explicitFile,
        'gates:\n  notARealGate:\n    enabled: false\n',
        'utf8'
      );

      assert.throws(
        () => load_quality_gates_config(tmpDir, explicitFile),
        (err: Error) => err.message.includes('notARealGate')
      );
    });

    it('accepts kebab-case gate keys and normalizes them to camelCase', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  duplicate-blocks:\n    minLines: 99\n  runtime-checks:\n    enabled: false\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 99,
        'kebab-case "duplicate-blocks" should set duplicateBlocks.minLines');
      assert.strictEqual(config.gates.runtimeChecks.enabled, false,
        'kebab-case "runtime-checks" should set runtimeChecks.enabled');
    });

    it('rejects YAML that mixes kebab-case and camelCase for the same gate', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  duplicate-blocks:\n    minLines: 5\n  duplicateBlocks:\n    minLines: 7\n',
        'utf8'
      );

      assert.throws(
        () => load_quality_gates_config(tmpDir),
        (err: Error) => {
          assert.ok(err.message.includes('Duplicate gate config'),
            'error should call out the duplicate spelling');
          assert.ok(err.message.includes('duplicateBlocks'),
            'error should mention the canonical key');
          return true;
        }
      );
    });

    it('accepts all valid gate key names without error', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        [
          'gates:',
          '  scaffoldDefaults:',
          '    enabled: true',
          '  duplicateBlocks:',
          '    minLines: 15',
          '  hardcodedConfig:',
          '    enabled: true',
          '  readmeClaims:',
          '    enabled: true',
          '  testIsolation:',
          '    enabled: true',
          '  testCoverage:',
          '    enabled: true',
          '  accessibility:',
          '    enabled: true',
          '  runtimeChecks:',
          '    enabled: true',
        ].join('\n'),
        'utf8'
      );

      assert.doesNotThrow(() => load_quality_gates_config(tmpDir));
    });
  });

  describe('project gate registry', () => {
    it('loads explicitly registered custom gates from .swarm/gates/index.cjs', () => {
      const gatesDir = path.join(tmpDir, '.swarm', 'gates');
      fs.mkdirSync(gatesDir, { recursive: true });
      fs.writeFileSync(
        path.join(gatesDir, 'index.cjs'),
        [
          'module.exports.registerGates = ({ registerGate }) => {',
          '  registerGate({',
          '    key: "customGate",',
          '    title: "Custom Gate",',
          '    defaultConfig: { enabled: true, threshold: 2 },',
          '    async run() {',
          '      return { id: "custom-gate", title: "Custom Gate", status: "pass", durationMs: 0, issues: [] };',
          '    }',
          '  });',
          '};',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpDir, '.swarm', 'gates.yaml'),
        'gates:\n  customGate:\n    threshold: 5\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.customGate.enabled, true);
      assert.strictEqual(config.gates.customGate.threshold, 5);
    });
  });

  describe('YAML syntax errors', () => {
    it('throws descriptive error with file path on YAML syntax error', () => {
      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      const badFile = path.join(swarmDir, 'gates.yaml');
      fs.writeFileSync(badFile, '{\ninvalid yaml: [unclosed', 'utf8');

      assert.throws(
        () => load_quality_gates_config(tmpDir),
        (err: Error) => {
          assert.ok(err.message.includes(badFile), 'Error should include the file path');
          assert.ok(err.message.includes('YAML syntax error'), 'Error should mention YAML syntax');
          return true;
        }
      );
    });

    it('throws descriptive error for explicit path with syntax error', () => {
      const badFile = path.join(tmpDir, 'broken.yaml');
      fs.writeFileSync(badFile, 'gates:\n  - bad\n  list: [unclosed', 'utf8');

      assert.throws(
        () => load_quality_gates_config(tmpDir, badFile),
        (err: Error) => err.message.includes(badFile)
      );
    });
  });

  describe('legacy config/quality-gates.yaml fallback', () => {
    it('falls back to config/quality-gates.yaml when no .swarm/gates.yaml exists', () => {
      const configDir = path.join(tmpDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'quality-gates.yaml'),
        'gates:\n  duplicateBlocks:\n    minLines: 25\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 25);
    });

    it('.swarm/gates.yaml takes precedence over config/quality-gates.yaml', () => {
      // Both files exist; .swarm/gates.yaml should win
      const configDir = path.join(tmpDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'quality-gates.yaml'),
        'gates:\n  duplicateBlocks:\n    minLines: 25\n',
        'utf8'
      );

      const swarmDir = path.join(tmpDir, '.swarm');
      fs.mkdirSync(swarmDir, { recursive: true });
      fs.writeFileSync(
        path.join(swarmDir, 'gates.yaml'),
        'gates:\n  duplicateBlocks:\n    minLines: 40\n',
        'utf8'
      );

      const config = load_quality_gates_config(tmpDir);
      assert.strictEqual(config.gates.duplicateBlocks.minLines, 40);
    });
  });
});

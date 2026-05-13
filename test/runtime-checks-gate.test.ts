import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { run_runtime_checks_gate, RuntimeChecksConfig } from '../src/quality-gates/gates/runtime-checks.js';

describe('RuntimeChecksGate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(__dirname, `test-runtime-gate-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const baseConfig: RuntimeChecksConfig = {
    enabled: true,
    retries: 0,
    runTests: true,
    runLint: true,
    runAudit: true,
    timeoutMs: 30000
  };

  it('should skip when disabled', async () => {
    const result = await run_runtime_checks_gate(tmpDir, { ...baseConfig, enabled: false });
    assert.strictEqual(result.status, 'skip');
    assert.strictEqual(result.issues.length, 0);
  });

  it('should pass when project has no test script', async () => {
    // Project with no package.json at all
    const result = await run_runtime_checks_gate(tmpDir, baseConfig);
    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(result.issues.length, 0);
  });

  it('should pass when test script is a stub', async () => {
    // npm init defaults to 'echo "Error: no test specified" && exit 1'
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { test: 'echo "Error: no test specified" && exit 1' }
      }),
      'utf-8'
    );
    const result = await run_runtime_checks_gate(tmpDir, {
      ...baseConfig,
      runLint: false,
      runAudit: false
    });
    // Stub test script is detected and skipped
    assert.strictEqual(result.status, 'pass');
  });

  it('should pass when test script succeeds', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { test: 'echo "all tests pass"' }
      }),
      'utf-8'
    );
    const result = await run_runtime_checks_gate(tmpDir, {
      ...baseConfig,
      runLint: false,
      runAudit: false
    });
    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(result.stats?.testsRun, 1);
  });

  it('should fail when test script fails', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { test: 'exit 1' }
      }),
      'utf-8'
    );
    const result = await run_runtime_checks_gate(tmpDir, {
      ...baseConfig,
      runLint: false,
      runAudit: false
    });
    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.issues.length, 1);
    assert.ok(result.issues[0].message.includes('npm test'));
  });

  it('should skip lint when no eslint config exists', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
      'utf-8'
    );
    const result = await run_runtime_checks_gate(tmpDir, {
      ...baseConfig,
      runTests: false,
      runAudit: false
    });
    // No eslint config means lint check is skipped, not failed
    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(result.stats?.lintRun, 0);
  });

  it('should report correct gate id and title', async () => {
    const result = await run_runtime_checks_gate(tmpDir, baseConfig);
    assert.strictEqual(result.id, 'runtime-checks');
    assert.ok(result.title.includes('Runtime'));
  });
});

import { buildTestCommand, buildEslintCommand } from '../src/quality-gates/gates/runtime-checks.js';

describe('buildTestCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(__dirname, 'test-build-cmd-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns npm test for projects without package.json', () => {
    assert.strictEqual(buildTestCommand(tmpDir), 'npm test');
  });

  it('returns npm test for projects with a generic test script', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'echo "tests pass"' }
    }));
    assert.strictEqual(buildTestCommand(tmpDir), 'npm test');
  });

  it('appends Jest ignore patterns for Jest projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' }
    }));
    const cmd = buildTestCommand(tmpDir);
    assert.ok(cmd.includes('--testPathIgnorePatterns=runs/'));
    assert.ok(cmd.includes('--testPathIgnorePatterns=coverage/'));
  });

  it('scopes node --test to tests/ directory when it exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test' }
    }));
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const cmd = buildTestCommand(tmpDir);
    assert.strictEqual(cmd, "node --test 'tests/**/*.test.js'");
  });

  it('scopes node --test to test/ directory when it exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test' }
    }));
    fs.mkdirSync(path.join(tmpDir, 'test'));
    const cmd = buildTestCommand(tmpDir);
    assert.strictEqual(cmd, "node --test 'test/**/*.test.js'");
  });

  it('scopes node --test to both test dirs when both exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test' }
    }));
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    fs.mkdirSync(path.join(tmpDir, 'test'));
    const cmd = buildTestCommand(tmpDir);
    assert.strictEqual(cmd, "node --test 'tests/**/*.test.js' 'test/**/*.test.js'");
  });

  it('does not modify node --test when script already has explicit paths', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test tests/' }
    }));
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    assert.strictEqual(buildTestCommand(tmpDir), 'npm test');
  });

  it('falls back to npm test when node --test has no test directories', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test' }
    }));
    // No tests/ or test/ dir
    assert.strictEqual(buildTestCommand(tmpDir), 'npm test');
  });

  it('detects Jest via package.json jest config field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'react-scripts test' },
      jest: { testEnvironment: 'node' }
    }));
    const cmd = buildTestCommand(tmpDir);
    assert.ok(cmd.includes('--testPathIgnorePatterns=runs/'));
  });
});

import { execSync } from 'child_process';

describe('buildEslintCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(__dirname, 'test-eslint-cmd-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('includes ignore patterns for artifact dirs when no baseCommit', () => {
    const cmd = buildEslintCommand(tmpDir);
    assert.ok(cmd, 'should return a command');
    assert.ok(cmd!.includes('--ignore-pattern'), 'should include ignore patterns');
    assert.ok(cmd!.includes("'dist/'"), 'should ignore dist/');
    assert.ok(cmd!.includes("'runs/'"), 'should ignore runs/');
    assert.ok(cmd!.includes("'build/'"), 'should ignore build/');
  });

  it('scopes to changed files when baseCommit is provided', () => {
    // Set up a git repo with a base commit and a new file
    execSync('git init && git config user.email "t@t" && git config user.name "t"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'old.js'), 'var x = 1;');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
    const baseCommit = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // Add a new file after baseline
    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'const express = require("express");');
    execSync('git add . && git commit -m "add server"', { cwd: tmpDir, stdio: 'pipe' });

    const cmd = buildEslintCommand(tmpDir, baseCommit);
    assert.ok(cmd, 'should return a command');
    assert.ok(cmd!.includes('server.js'), 'should include the changed file');
    assert.ok(!cmd!.includes('old.js'), 'should NOT include the pre-existing file');
  });

  it('returns null when no lintable files changed', () => {
    execSync('git init && git config user.email "t@t" && git config user.name "t"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
    const baseCommit = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // Only change a non-JS file
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Updated');
    execSync('git add . && git commit -m "update readme"', { cwd: tmpDir, stdio: 'pipe' });

    const cmd = buildEslintCommand(tmpDir, baseCommit);
    assert.strictEqual(cmd, null, 'should return null when no JS/TS files changed');
  });

  it('excludes files in artifact directories from diff results', () => {
    execSync('git init && git config user.email "t@t" && git config user.name "t"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'var x = 1;');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
    const baseCommit = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    // Add files in artifact dirs and a real file
    fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'dist', 'bundle.js'), 'compiled code');
    fs.writeFileSync(path.join(tmpDir, 'api.js'), 'const api = {};');
    execSync('git add . && git commit -m "add dist and api"', { cwd: tmpDir, stdio: 'pipe' });

    const cmd = buildEslintCommand(tmpDir, baseCommit);
    assert.ok(cmd, 'should return a command');
    assert.ok(cmd!.includes('api.js'), 'should include the real changed file');
    assert.ok(!cmd!.includes('dist/bundle.js'), 'should exclude files in dist/');
  });

  it('extends the ignore set with top-level entries from .gitignore', () => {
    // Regression for the 2026-05 ow comparison run, where a user-created
    // scratch dir (`comparison-runs/`) was already in .gitignore but the
    // gate scanned it anyway and surfaced two errors in files outside
    // the project the user could not fix.
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      [
        '# header comment',
        '',
        'comparison-runs/',
        'sandbox',
        '!exception-line',     // negation entries are intentionally dropped
        '*.log',               // glob entries are intentionally dropped
        'src/generated/**',    // nested entries are intentionally dropped
      ].join('\n'),
    );

    const cmd = buildEslintCommand(tmpDir);

    assert.ok(cmd, 'should return a command');
    assert.ok(cmd!.includes("'comparison-runs/'"),
      `gitignored top-level dir must extend the ignore set; got: ${cmd}`);
    assert.ok(cmd!.includes("'sandbox/'"),
      `top-level entries without trailing slash must be ignored as dirs; got: ${cmd}`);
    assert.ok(!cmd!.includes("'exception-line/'"),
      'negation entries (!foo) must not shrink the ignore set');
    assert.ok(!cmd!.includes("'*.log/'") && !cmd!.includes("'*.log'"),
      'glob entries are not safely expressible as --ignore-pattern dir/ and must be dropped');
    assert.ok(!cmd!.includes("'src/generated/'"),
      'nested entries must be dropped — handled by eslint flat-config ignores instead');
  });

  it('does not duplicate entries already in the built-in ignore list', () => {
    // A project that lists `dist/` and `node_modules/` in its own
    // .gitignore must not produce `--ignore-pattern 'dist/' ... --ignore-pattern 'dist/'`.
    // The duplicate would not be an error but pollutes the command string
    // logged on failure and makes the gate output harder to read.
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      'dist/\nnode_modules/\ncustom-output/\n',
    );

    const cmd = buildEslintCommand(tmpDir);

    assert.ok(cmd, 'should return a command');
    const distMatches = cmd!.match(/'dist\/'/g) ?? [];
    assert.equal(distMatches.length, 1,
      `dist/ must appear exactly once even when also listed in .gitignore; got ${distMatches.length} occurrences`);
    assert.ok(cmd!.includes("'custom-output/'"),
      'project-specific gitignore entries must still extend the ignore set');
  });

  it('returns the built-in ignore list when no .gitignore is present', () => {
    // A repo without .gitignore still gets the orchestrator's built-in
    // exclusions; .gitignore is purely additive.
    const cmd = buildEslintCommand(tmpDir);

    assert.ok(cmd, 'should return a command');
    assert.ok(cmd!.includes("'dist/'"));
    assert.ok(cmd!.includes("'runs/'"));
  });
});

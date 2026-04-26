import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HookGenerator, EvidenceEntry } from '../src/hook-generator';
import { AgentProfile } from '../src/config-loader';
import { PlanStep } from '../src/plan-generator';

function makeAgent(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    name: 'worker',
    purpose: 'Implement server-side logic, APIs, and data processing',
    scope: [
      'Backend code (Node.js, Python, Go, Java, etc.)',
      'API endpoints and business logic',
      'Git commits for backend changes'
    ],
    boundaries: [
      'Do not modify frontend components or UI code',
      'Do not change infrastructure/deployment configs unless backend-specific'
    ],
    done_definition: ['All API endpoints work'],
    refusal_rules: ['Do not invent database features'],
    output_contract: { transcript: 'proof/step-{N}-backend.md', artifacts: [] },
    ...overrides
  };
}

function makeStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    stepNumber: 1,
    task: 'Build REST API for user management',
    agentName: 'worker',
    dependencies: [],
    expectedOutputs: ['src/api/users.ts', 'test/users.test.ts'],
    ...overrides
  };
}

describe('HookGenerator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-gen-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateStepHooks', () => {
    it('should create a hooks file with version 1 format in .github/hooks/', () => {
      const gen = new HookGenerator();
      const runDir = path.join(tempDir, 'runs', 'test-run');
      const workingDir = path.join(tempDir, 'worktree');
      fs.mkdirSync(runDir, { recursive: true });
      fs.mkdirSync(workingDir, { recursive: true });

      const result = gen.generateStepHooks({
        step: makeStep(),
        agent: makeAgent(),
        executionId: 'test-exec-1',
        runDir,
        stepBranch: 'swarm/test/step-1-worker',
        workingDir
      });

      assert.ok(fs.existsSync(result.hooksDir));
      assert.ok(result.hooksDir.endsWith(path.join('.github', 'hooks')));
      assert.ok(fs.existsSync(result.hooksFilePath));

      // Verify version 1 format
      const content = JSON.parse(fs.readFileSync(result.hooksFilePath, 'utf8'));
      assert.strictEqual(content.version, 1);
      assert.ok(content.hooks.preToolUse);
      assert.ok(content.hooks.postToolUse);
      assert.ok(content.hooks.sessionStart);
      assert.ok(content.hooks.errorOccurred);
      assert.strictEqual(content.hooks.preToolUse[0].type, 'command');
      assert.ok(content.hooks.preToolUse[0].bash);
      assert.ok(content.hooks.preToolUse[0].timeoutSec > 0);

      gen.cleanupHooks(result.hooksFilePath);
      assert.ok(!fs.existsSync(result.hooksFilePath));
    });

    it('should create the evidence directory in the run dir', () => {
      const gen = new HookGenerator();
      const runDir = path.join(tempDir, 'run-evidence');
      const workingDir = path.join(tempDir, 'worktree2');
      fs.mkdirSync(runDir, { recursive: true });
      fs.mkdirSync(workingDir, { recursive: true });

      const result = gen.generateStepHooks({
        step: makeStep({ stepNumber: 3 }),
        agent: makeAgent(),
        executionId: 'test-exec-2',
        runDir,
        stepBranch: 'swarm/test/step-3-worker',
        workingDir
      });

      assert.ok(fs.existsSync(path.join(runDir, 'evidence')));
      assert.ok(result.evidenceLogPath.includes('step-3.jsonl'));

      gen.cleanupHooks(result.hooksFilePath);
    });

    it('should produce valid JSON with all required hook entries', () => {
      const gen = new HookGenerator();
      const runDir = path.join(tempDir, 'run-json');
      const workingDir = path.join(tempDir, 'worktree3');
      fs.mkdirSync(runDir, { recursive: true });
      fs.mkdirSync(workingDir, { recursive: true });

      const result = gen.generateStepHooks({
        step: makeStep(),
        agent: makeAgent(),
        executionId: 'test-exec-3',
        runDir,
        stepBranch: 'swarm/test/step-1',
        workingDir
      });

      const config = JSON.parse(fs.readFileSync(result.hooksFilePath, 'utf8'));
      assert.strictEqual(config.version, 1);

      // Each hook event should have at least one command entry
      for (const event of ['preToolUse', 'postToolUse', 'sessionStart', 'errorOccurred']) {
        const hooks = config.hooks[event];
        assert.ok(Array.isArray(hooks), `hooks.${event} should be an array`);
        assert.ok(hooks.length > 0, `hooks.${event} should have at least one entry`);
        assert.strictEqual(hooks[0].type, 'command');
        assert.ok(typeof hooks[0].bash === 'string', `hooks.${event}[0].bash should be a string`);
      }

      gen.cleanupHooks(result.hooksFilePath);
    });
  });

  describe('deriveScopeRules', () => {
    it('should map backend agent to backend path patterns', () => {
      const gen = new HookGenerator();
      const rules = gen.deriveScopeRules(makeAgent());

      assert.ok(rules.allow.some(p => p.includes('api') || p.includes('server')));
      assert.ok(rules.deny.some(p => p.includes('components') || p.includes('pages')));
    });

    it('should map frontend agent to frontend path patterns', () => {
      const gen = new HookGenerator();
      const agent = makeAgent({
        name: 'worker',
        scope: ['Frontend code (React, Vue, Angular, HTML, CSS)', 'UI/UX implementation'],
        boundaries: ['Do not modify backend API endpoints or server logic', 'Do not change database schemas']
      });

      const rules = gen.deriveScopeRules(agent);

      assert.ok(rules.allow.some(p => p.includes('components') || p.includes('pages')));
      assert.ok(rules.deny.some(p => p.includes('api') || p.includes('server')));
      assert.ok(rules.deny.some(p => p.includes('schema') || p.includes('migration')));
    });

    it('should map tester agent to test path patterns', () => {
      const gen = new HookGenerator();
      const agent = makeAgent({
        name: 'worker',
        scope: ['Unit tests', 'Integration tests', 'Test coverage analysis', 'Quality assurance validation'],
        boundaries: ['Do not modify application logic to make tests pass']
      });

      const rules = gen.deriveScopeRules(agent);
      assert.ok(rules.allow.some(p => p.includes('test') || p.includes('spec')));
    });

    it('should map devops agent to CI/CD and Docker patterns', () => {
      const gen = new HookGenerator();
      const agent = makeAgent({
        name: 'worker',
        scope: ['CI/CD pipelines', 'Docker configuration', 'Deployment automation'],
        boundaries: ['Do not modify application business logic']
      });

      const rules = gen.deriveScopeRules(agent);
      assert.ok(rules.allow.some(p => p.includes('.github') || p.includes('Docker')));
    });

    it('should deduplicate path patterns', () => {
      const gen = new HookGenerator();
      const agent = makeAgent({
        scope: ['Frontend code (React)', 'UI/UX implementation', 'Component architecture'],
        boundaries: []
      });

      const rules = gen.deriveScopeRules(agent);
      const unique = new Set(rules.allow);
      assert.strictEqual(rules.allow.length, unique.size);
    });

    it('should return empty rules for an agent with generic scope', () => {
      const gen = new HookGenerator();
      const agent = makeAgent({
        scope: ['General programming tasks'],
        boundaries: []
      });

      const rules = gen.deriveScopeRules(agent);
      // Generic scope produces no specific path patterns
      assert.ok(Array.isArray(rules.allow));
      assert.ok(Array.isArray(rules.deny));
    });
  });

  describe('parseEvidenceLog', () => {
    it('should return empty array for non-existent file', () => {
      const gen = new HookGenerator();
      const entries = gen.parseEvidenceLog('/nonexistent/path.jsonl');
      assert.deepStrictEqual(entries, []);
    });

    it('should return empty array for empty file', () => {
      const gen = new HookGenerator();
      const logPath = path.join(tempDir, 'empty.jsonl');
      fs.writeFileSync(logPath, '');
      const entries = gen.parseEvidenceLog(logPath);
      assert.deepStrictEqual(entries, []);
    });

    it('should parse valid JSONL entries', () => {
      const gen = new HookGenerator();
      const logPath = path.join(tempDir, 'evidence.jsonl');

      const entry1: EvidenceEntry = {
        timestamp: '2026-03-17T10:00:00Z',
        event: 'postToolUse',
        tool: 'git',
        sha: 'abc1234'
      };
      const entry2: EvidenceEntry = {
        timestamp: '2026-03-17T10:01:00Z',
        event: 'postToolUse',
        tool: 'editFile',
        filePath: 'src/server.ts'
      };

      fs.writeFileSync(logPath, JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n');

      const entries = gen.parseEvidenceLog(logPath);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].tool, 'git');
      assert.strictEqual(entries[1].filePath, 'src/server.ts');
    });

    it('should skip malformed lines without throwing', () => {
      const gen = new HookGenerator();
      const logPath = path.join(tempDir, 'partial.jsonl');

      const validEntry: EvidenceEntry = {
        timestamp: '2026-03-17T10:00:00Z',
        event: 'postToolUse',
        tool: 'git'
      };

      fs.writeFileSync(logPath, JSON.stringify(validEntry) + '\n' + 'not valid json\n' + '\n');

      const entries = gen.parseEvidenceLog(logPath);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].tool, 'git');
    });
  });

  describe('buildPreToolUseScript', () => {
    it('should embed scope rules in the generated script', () => {
      const gen = new HookGenerator();
      const script = gen.buildPreToolUseScript(
        { allow: ['src/api'], deny: ['src/components'] },
        '/tmp/evidence.jsonl',
        'worker'
      );

      assert.ok(script.includes('src/api'));
      assert.ok(script.includes('src/components'));
      // Uses permissionDecision field (SDK reads this for deny enforcement)
      assert.ok(script.includes('permissionDecision'));
      assert.ok(script.includes('approve'));
      // Should reference evidence log for scope violation logging
      assert.ok(script.includes('scope_violation'));
      // Should output deny for out-of-scope operations
      assert.ok(script.includes("permissionDecision:'deny'") || script.includes('permissionDecision:"deny"'));
    });

    it('should exit cleanly when deny list is empty', () => {
      const gen = new HookGenerator();
      const script = gen.buildPreToolUseScript(
        { allow: ['src'], deny: [] },
        '/tmp/evidence.jsonl',
        'worker'
      );

      // With no deny rules, the script approves all operations
      assert.ok(script.includes('permissionDecision'));
      assert.ok(script.includes('approve'));
    });
  });

  describe('buildPostToolUseScript', () => {
    it('should reference the evidence log path', () => {
      const gen = new HookGenerator();
      const logPath = '/tmp/evidence/step-1.jsonl';
      const script = gen.buildPostToolUseScript(logPath);

      assert.ok(script.includes('step-1.jsonl'));
      assert.ok(script.includes('appendFileSync'));
    });
  });

  describe('cleanupHooks', () => {
    it('should remove a hooks file', () => {
      const gen = new HookGenerator();
      const hooksFile = path.join(tempDir, 'swarm-step-1.json');
      fs.writeFileSync(hooksFile, '{}');

      gen.cleanupHooks(hooksFile);
      assert.ok(!fs.existsSync(hooksFile));
    });

    it('should remove a hooks directory (legacy path)', () => {
      const gen = new HookGenerator();
      const hooksDir = path.join(tempDir, 'hooks-cleanup');
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(path.join(hooksDir, 'test.json'), '{}');

      gen.cleanupHooks(hooksDir);
      assert.ok(!fs.existsSync(hooksDir));
    });

    it('should not throw for non-existent path', () => {
      const gen = new HookGenerator();
      gen.cleanupHooks('/nonexistent/path/that/does/not/exist');
    });
  });

  describe('scope violation flow (deny enforcement + verification-layer enforcement)', () => {
    it('should deny and log scope_violation when preToolUse detects out-of-scope write', (done) => {
      const gen = new HookGenerator();
      const evidenceLog = path.join(tempDir, 'scope-violation-evidence.jsonl');

      // Generate a preToolUse script for backend_master with !src/components/ boundary
      const agent = makeAgent({
        name: 'worker',
        scope: ['Backend code (Node.js, Python, Go, Java, etc.)', 'API endpoints and business logic'],
        boundaries: ['Do not modify frontend components or UI code']
      });
      const scopeRules = gen.deriveScopeRules(agent);
      // Confirm deny rules include components
      assert.ok(scopeRules.deny.some(r => r.includes('components')), 'deny rules should include component paths');

      const script = gen.buildPreToolUseScript(scopeRules, evidenceLog, 'worker');

      // Simulate a preToolUse event where the tool writes to src/components/Button.tsx
      const context = JSON.stringify({
        toolName: 'editFile',
        toolArgs: { path: 'src/components/Button.tsx' }
      });

      const { execSync } = require('child_process');
      const stdout = execSync(`echo '${context.replace(/'/g, "'\\''")}' | ${script}`, {
        cwd: tempDir,
        timeout: 10000,
        encoding: 'utf8'
      });

      // Hook should output deny decision for out-of-scope file
      const hookOutput = JSON.parse(stdout);
      assert.strictEqual(hookOutput.permissionDecision, 'deny', 'hook should deny out-of-scope file');
      assert.ok(hookOutput.permissionDecisionReason.includes('Scope violation'), 'reason should explain the violation');

      // Evidence log should contain a scope_violation entry
      assert.ok(fs.existsSync(evidenceLog), 'evidence log should exist after scope violation');
      const entries = gen.parseEvidenceLog(evidenceLog);
      const violations = entries.filter(e => e.event === 'scope_violation');
      assert.strictEqual(violations.length, 1, 'should have exactly one scope violation');
      assert.strictEqual(violations[0].tool, 'editFile');
      assert.strictEqual(violations[0].filePath, 'src/components/Button.tsx');
      assert.strictEqual(violations[0].agentName, 'worker');
      assert.ok(violations[0].boundaryRule, 'violation should include the boundary rule');

      done();
    });

    it('should NOT log scope_violation for files within the agent scope', () => {
      const gen = new HookGenerator();
      const evidenceLog = path.join(tempDir, 'no-violation-evidence.jsonl');

      const agent = makeAgent({
        name: 'worker',
        scope: ['Backend code (Node.js, Python, Go, Java, etc.)', 'API endpoints and business logic'],
        boundaries: ['Do not modify frontend components or UI code']
      });
      const scopeRules = gen.deriveScopeRules(agent);
      const script = gen.buildPreToolUseScript(scopeRules, evidenceLog, 'worker');

      // Simulate a preToolUse event for a file in the allowed scope
      const context = JSON.stringify({
        toolName: 'editFile',
        toolArgs: { path: 'src/api/users.ts' }
      });

      const { execSync } = require('child_process');
      const stdout = execSync(`echo '${context.replace(/'/g, "'\\''")}' | ${script}`, {
        cwd: tempDir,
        timeout: 10000,
        encoding: 'utf8'
      });

      // Hook should approve in-scope file
      const hookOutput = JSON.parse(stdout);
      assert.strictEqual(hookOutput.permissionDecision, 'approve', 'hook should approve in-scope file');

      // No evidence log should exist (or it should be empty)
      if (fs.existsSync(evidenceLog)) {
        const entries = gen.parseEvidenceLog(evidenceLog);
        const violations = entries.filter(e => e.event === 'scope_violation');
        assert.strictEqual(violations.length, 0, 'no scope violations for in-scope file');
      }
    });

    it('verifier should fail step when evidence contains scope_violation entries', async () => {
      // Write scope violation entries to a mock evidence log
      const evidenceLog = path.join(tempDir, 'verifier-scope-evidence.jsonl');
      const violation = {
        timestamp: new Date().toISOString(),
        event: 'scope_violation',
        tool: 'editFile',
        filePath: 'src/components/Button.tsx',
        agentName: 'worker',
        boundaryRule: 'src/components'
      };
      fs.writeFileSync(evidenceLog, JSON.stringify(violation) + '\n');

      // Create a minimal transcript so the verifier can parse it
      const transcriptPath = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transcriptPath, '# Copilot Session\n\nI created src/components/Button.tsx\n');

      // Run verification with the evidence log
      const { VerifierEngine } = require('../src/verifier-engine');
      const verifier = new VerifierEngine(tempDir);
      const result = await verifier.verifyStep(
        1,
        'worker',
        transcriptPath,
        { requireTests: false, requireBuild: false, requireCommits: false },
        undefined,
        evidenceLog
      );

      // Verification should fail due to scope violations
      assert.strictEqual(result.passed, false, 'step should fail verification with scope violations');

      // Find the scope violation check
      const scopeCheck = result.checks.find(
        (c: { description: string }) => c.description === 'No scope violations detected during execution'
      );
      assert.ok(scopeCheck, 'should have a scope violation check');
      assert.strictEqual(scopeCheck.passed, false);
      assert.ok(scopeCheck.reason.includes('src/components/Button.tsx'), 'reason should mention the violated file');
      assert.ok(scopeCheck.reason.includes('worker'), 'reason should mention the agent');
    });
  });
});

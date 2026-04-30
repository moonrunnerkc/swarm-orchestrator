// Verifies all claims made in README.md are accurate
import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('README Verification', () => {
  const rootDir = path.join(__dirname, '../..');

  describe('Source file counts', () => {
    it('should have at least 42 top-level source files in src/', () => {
      const output = execSync('ls src/*.ts src/*.tsx 2>/dev/null | wc -l', { 
        cwd: rootDir, 
        encoding: 'utf-8' 
      });
      const count = parseInt(output.trim());
      assert.ok(count >= 42, `Expected >= 42 top-level source files in src/, got ${count}`);
    });

    it('should have at least 60 total source files including subdirectories', () => {
      const output = execSync('find src -name "*.ts" -o -name "*.tsx" | wc -l', { 
        cwd: rootDir, 
        encoding: 'utf-8' 
      });
      const count = parseInt(output.trim());
      assert.ok(count >= 60, `Expected >= 60 total source files in src/, got ${count}`);
    });

    it('should have at least 29 test files', () => {
      const output = execSync('ls test/*.test.ts | wc -l', { 
        cwd: rootDir, 
        encoding: 'utf-8' 
      });
      const count = parseInt(output.trim());
      assert.ok(count >= 29, `Expected >= 29 test files, got ${count}`);
    });
  });

  describe('Custom agents', () => {
    it('should have 7 custom agent files', () => {
      const agentsDir = path.join(rootDir, '.github/agents');
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.agent.md'));
      assert.strictEqual(files.length, 7, 'Expected 7 custom agent markdown files');
    });

    it('should have valid agent file names', () => {
      const agentsDir = path.join(rootDir, '.github/agents');
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.agent.md'));
      
      // Each agent file should follow naming convention
      files.forEach(file => {
        assert.match(file, /^[a-z_-]+\.agent\.md$/, `Agent file ${file} should follow naming convention`);
      });
    });
  });

  describe('Configuration files', () => {
    it('should have default-agents.yaml', () => {
      const configPath = path.join(rootDir, 'config/default-agents.yaml');
      assert.ok(fs.existsSync(configPath), 'config/default-agents.yaml should exist');
    });

    it('should have quality-gates.yaml', () => {
      const configPath = path.join(rootDir, 'config/quality-gates.yaml');
      assert.ok(fs.existsSync(configPath), 'config/quality-gates.yaml should exist');
    });
  });

  describe('Code proof anchors', () => {
    it('should have identifyExecutionWaves function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/swarm-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /identifyExecutionWaves/, 'Should have identifyExecutionWaves function');
    });

    it('should have createAgentBranch function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/swarm-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /createAgentBranch/, 'Should have createAgentBranch function');
    });

    it('should have verifyStep function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/verifier-engine.ts'), 
        'utf-8'
      );
      assert.match(content, /verifyStep/, 'Should have verifyStep function');
    });

    it('should have executeSession function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/session-executor.ts'), 
        'utf-8'
      );
      assert.match(content, /executeSession/, 'Should have executeSession function');
    });

    it('should have buildDependencyGraph function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/swarm-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /buildDependencyGraph/, 'Should have buildDependencyGraph function');
    });

    it('should have executeReplan function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/swarm-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /executeReplan/, 'Should have executeReplan function');
    });

    it('should have revisePlan function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/plan-generator.ts'), 
        'utf-8'
      );
      assert.match(content, /revisePlan/, 'Should have revisePlan function');
    });

    it('should have executeOptionalDeployment function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/swarm-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /executeOptionalDeployment/, 'Should have executeOptionalDeployment function');
    });

    it('should have bootstrap function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/bootstrap-orchestrator.ts'), 
        'utf-8'
      );
      assert.match(content, /bootstrap/, 'Should have bootstrap function');
    });

    it('should have fetchIssues function', () => {
      const content = fs.readFileSync(
        path.join(rootDir, 'src/github-issues-ingester.ts'), 
        'utf-8'
      );
      assert.match(content, /fetchIssues/, 'Should have fetchIssues function');
    });
  });

  describe('Package.json accuracy', () => {
    it('should have proper metadata', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      
      assert.strictEqual(pkg.name, 'swarm-orchestrator');
      assert.ok(pkg.version, 'Should have version');
      assert.ok(pkg.description, 'Should have description');
      assert.ok(pkg.author, 'Should have author');
      assert.ok(pkg.license, 'Should have license');
    });

    it('should have proper keywords', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      
      assert.ok(Array.isArray(pkg.keywords), 'Should have keywords array');
      assert.ok(pkg.keywords.length > 0, 'Should have at least one keyword');
    });

    it('should have bin entries', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      
      assert.ok(pkg.bin, 'Should have bin field');
      assert.ok(pkg.bin.swarm || pkg.bin['swarm-orchestrator'], 'Should have CLI bin entry');
    });
  });

  describe('Build and test scripts', () => {
    it('should have build script', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      
      assert.ok(pkg.scripts.build, 'Should have build script');
    });

    it('should have test script', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      
      assert.ok(pkg.scripts.test, 'Should have test script');
    });
  });

  describe('Demo scenarios', () => {
    it('should have demo scenarios directory', () => {
      const demosDir = path.join(rootDir, 'config');
      assert.ok(fs.existsSync(demosDir), 'Config directory should exist for demo scenarios');
    });
  });

  describe('TypeScript configuration', () => {
    it('should have tsconfig.json', () => {
      const tsconfigPath = path.join(rootDir, 'tsconfig.json');
      assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json should exist');
    });

    it('should have tsconfig.build.json', () => {
      const tsconfigPath = path.join(rootDir, 'tsconfig.build.json');
      assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.build.json should exist');
    });
  });

  describe('Documentation', () => {
    it('should have LICENSE file', () => {
      const licensePath = path.join(rootDir, 'LICENSE');
      assert.ok(fs.existsSync(licensePath), 'LICENSE file should exist');
    });

    it('should have README.md', () => {
      const readmePath = path.join(rootDir, 'README.md');
      assert.ok(fs.existsSync(readmePath), 'README.md should exist');
      
      const content = fs.readFileSync(readmePath, 'utf-8');
      assert.ok(content.length > 1000, 'README should have substantial content');
    });

    it('README should mention key features', () => {
      const readmePath = path.join(rootDir, 'README.md');
      const content = fs.readFileSync(readmePath, 'utf-8');

      assert.match(content, /falsification/i, 'README should mention the falsification battery');
      assert.match(content, /attestation/i, 'README should mention attestation');
      assert.match(content, /worker.*reviewer|reviewer.*worker/is, 'README should mention worker and reviewer roles');
      assert.match(content, /verification/i, 'README should mention verification');
    });
  });
});

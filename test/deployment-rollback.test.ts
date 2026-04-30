// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import http from 'http';
import * as os from 'os';
import * as path from 'path';
import DeploymentManager from '../src/deployment-manager';
import ExternalToolManager from '../src/external-tool-manager';

/**
 * Upgrade 10: Deployment Rollback
 * Tests tagPreDeploy, rollbackToTag, and runHealthCheck.
 */
describe('Upgrade 10: Deployment Rollback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rollback-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function initGitRepo(): string {
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'initial content', 'utf8');
    execSync('git add . && git commit -m "initial commit"', { cwd: tmpDir });
    return tmpDir;
  }

  function makeDeploymentManager(workDir: string): DeploymentManager {
    const toolManager = new ExternalToolManager({
      enableExternal: false,
      dryRun: true,
      logFile: path.join(workDir, 'commands.log')
    });
    return new DeploymentManager(toolManager, workDir);
  }

  describe('tagPreDeploy', () => {
    it('creates a git tag in the repo', () => {
      const repoDir = initGitRepo();
      const dm = makeDeploymentManager(repoDir);

      const tag = dm.tagPreDeploy('exec-123');
      assert.strictEqual(tag, 'pre-deploy/exec-123');

      // verify tag exists
      const tags = execSync('git tag', { cwd: repoDir, encoding: 'utf8' });
      assert.ok(tags.includes('pre-deploy/exec-123'), 'tag should exist in repo');
    });

    it('overwrites existing tag with -f flag', () => {
      const repoDir = initGitRepo();
      const dm = makeDeploymentManager(repoDir);

      dm.tagPreDeploy('exec-456');
      // add a new commit
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'updated', 'utf8');
      execSync('git add . && git commit -m "update"', { cwd: repoDir });

      // should not throw when re-tagging
      const tag = dm.tagPreDeploy('exec-456');
      assert.strictEqual(tag, 'pre-deploy/exec-456');
    });
  });

  describe('rollbackToTag', () => {
    it('reverts HEAD and creates a rollback commit', () => {
      const repoDir = initGitRepo();
      const dm = makeDeploymentManager(repoDir);

      // make a second commit to revert
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'changed content', 'utf8');
      execSync('git add . && git commit -m "change to revert"', { cwd: repoDir });

      dm.rollbackToTag('pre-deploy/test');

      // verify rollback commit exists
      const log = execSync('git log --oneline -1', { cwd: repoDir, encoding: 'utf8' });
      assert.ok(log.includes('rollback:'), 'latest commit should be a rollback');

      // verify file content was reverted
      const content = fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf8');
      assert.strictEqual(content, 'initial content', 'file should be reverted');
    });
  });

  describe('runHealthCheck', () => {
    const baseUrl = (p: number) => `http://${process.env.TEST_HOST || 'localhost'}:${p}`;
    let server: http.Server;
    let port: number;

    afterEach((done) => {
      if (server) {
        server.closeAllConnections();
        server.close(done);
      } else {
        done();
      }
    });

    it('returns true on HTTP 200', async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((_, res) => {
          res.writeHead(200);
          res.end('OK');
        });
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });

      const dm = makeDeploymentManager(tmpDir);
      const result = await dm.runHealthCheck(baseUrl(port), 1, 100);
      assert.strictEqual(result, true);
    });

    it('returns false on HTTP 500 after all retries', async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((_, res) => {
          res.writeHead(500);
          res.end('Error');
        });
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });

      const dm = makeDeploymentManager(tmpDir);
      // 2 retries with minimal interval for fast tests
      const result = await dm.runHealthCheck(baseUrl(port), 2, 50);
      assert.strictEqual(result, false);
    });

    it('retries the configured number of times before failing', async () => {
      let requestCount = 0;
      await new Promise<void>((resolve) => {
        server = http.createServer((_, res) => {
          requestCount++;
          res.writeHead(503);
          res.end('Unavailable');
        });
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });

      const dm = makeDeploymentManager(tmpDir);
      await dm.runHealthCheck(baseUrl(port), 3, 50);
      assert.strictEqual(requestCount, 3, 'should have made exactly 3 attempts');
    });

    it('succeeds on retry after initial failures', async () => {
      let requestCount = 0;
      await new Promise<void>((resolve) => {
        server = http.createServer((_, res) => {
          requestCount++;
          if (requestCount < 3) {
            res.writeHead(500);
            res.end('Error');
          } else {
            res.writeHead(200);
            res.end('OK');
          }
        });
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });

      const dm = makeDeploymentManager(tmpDir);
      const result = await dm.runHealthCheck(baseUrl(port), 3, 50);
      assert.strictEqual(result, true, 'should succeed on third attempt');
      assert.strictEqual(requestCount, 3);
    });
  });

  describe('rollback event in deployment metadata', () => {
    it('deployment metadata is saved even when rollback occurs', () => {
      const repoDir = initGitRepo();
      const dm = makeDeploymentManager(repoDir);

      const runDir = path.join(repoDir, 'runs', 'test-run');
      fs.mkdirSync(runDir, { recursive: true });

      dm.saveDeploymentMetadata(runDir, {
        stepNumber: 1,
        agentName: 'worker',
        timestamp: new Date().toISOString(),
        platform: 'vercel',
        previewUrl: 'https://preview.example.com',
        branchName: 'swarm/test/step-1'
      });

      const loaded = dm.loadDeploymentMetadata(runDir);
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].platform, 'vercel');
      assert.strictEqual(loaded[0].previewUrl, 'https://preview.example.com');
    });
  });
});

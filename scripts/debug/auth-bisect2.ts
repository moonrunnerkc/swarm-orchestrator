/**
 * auth-bisect2.ts — second-round bisection, focused on the orchestrator's
 * actual spawn timing and hook pre-generation. Each scenario targets a
 * specific hypothesis.
 */
import { spawn, spawnSync, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const AUTH_RE = /Authentication failed|Request ID:/i;
const tail = (s: string, n = 400) => (s && s.length > n ? s.slice(-n) : s);

function makeDemoDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-demo-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'bisect@local'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'bisect'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# ab2\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeWorktree(baseRepo: string, runDir: string, stepNum: number): string {
  const wtPath = path.join(runDir, 'worktrees', `step-${stepNum}`);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const branch = `ab2/step-${stepNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  spawnSync('git', ['branch', branch, 'HEAD'], { cwd: baseRepo });
  const r = spawnSync('git', ['worktree', 'add', wtPath, branch], { cwd: baseRepo, stdio: 'pipe' });
  if (r.status !== 0) throw new Error('worktree add failed: ' + (r.stderr?.toString() || ''));
  return wtPath;
}

function writeHooksFile(worktreePath: string, stepNumber: number, runDir: string): void {
  const hooksDir = path.join(worktreePath, '.github', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const evidenceDir = path.join(runDir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evLog = path.join(evidenceDir, `step-${stepNumber}.jsonl`);
  const config = {
    version: 1,
    hooks: {
      sessionStart: [{ type: 'command', bash: `node -e "require('fs').appendFileSync('${evLog}','session\\n')"`, timeoutSec: 10 }],
      preToolUse: [{ type: 'command', bash: `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write('{\\"permissionDecision\\":\\"approve\\"}'))"`, timeoutSec: 10 }],
      postToolUse: [{ type: 'command', bash: `node -e "require('fs').appendFileSync('${evLog}','post\\n')"`, timeoutSec: 10 }],
      errorOccurred: [{ type: 'command', bash: `node -e "require('fs').appendFileSync('${evLog}','err\\n')"`, timeoutSec: 10 }],
    },
  };
  fs.writeFileSync(path.join(hooksDir, `swarm-step-${stepNumber}.json`), JSON.stringify(config, null, 2));
}

function writeCopilotInstructions(dir: string): void {
  const src = path.resolve(__dirname, '..', '..', '.copilot-instructions.md');
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, '.copilot-instructions.md'));
  else fs.writeFileSync(path.join(dir, '.copilot-instructions.md'), '# ab2\n');
}

const ORCH_ENV = {
  GIT_AUTHOR_NAME: 'swarm-orchestrator',
  GIT_AUTHOR_EMAIL: 'swarm@localhost',
  GIT_COMMITTER_NAME: 'swarm-orchestrator',
  GIT_COMMITTER_EMAIL: 'swarm@localhost',
  COPILOT_ALLOW_ALL: 'true',
};

const PROMPT = 'Create a file hello.txt with content "Hello". Keep it tiny.';

interface Result { label: string; exit: number; authFailed: boolean; dur: number; stderr: string }

function runCopilot(cwd: string, env: NodeJS.ProcessEnv, label: string): Promise<Result> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn('copilot', ['-p', PROMPT, '--allow-all'], { cwd, env } as SpawnOptions);
    let so = '', se = '';
    if (proc.stdin) proc.stdin.end();
    if (proc.stdout) proc.stdout.on('data', (d) => { so += d.toString(); });
    if (proc.stderr) proc.stderr.on('data', (d) => { se += d.toString(); });
    const kill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {/**/} }, 90_000);
    proc.on('close', (c) => {
      clearTimeout(kill);
      const combined = so + '\n' + se;
      resolve({ label, exit: c ?? -1, authFailed: AUTH_RE.test(combined), dur: Date.now() - start, stderr: tail(se) });
    });
    proc.on('error', () => resolve({ label, exit: -1, authFailed: false, dur: Date.now() - start, stderr: 'spawn err' }));
  });
}

async function scenario(name: string, runner: () => Promise<Result[]>): Promise<Result[]> {
  console.log(`\n=== ${name} ===`);
  const out = await runner();
  for (const r of out) {
    const status = r.authFailed ? 'AUTH-FAIL' : (r.exit === 0 ? 'OK' : `EXIT=${r.exit}`);
    console.log(`  [${r.label}] ${status} dur=${r.dur}ms`);
    if (r.authFailed || r.exit !== 0) console.log(`    stderr: ${r.stderr.slice(-300)}`);
  }
  return out;
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const should = (n: string) => !only || only === n;
  const demoDir = makeDemoDir();
  const runDir = path.join(demoDir, 'runs', 'run1');
  fs.mkdirSync(runDir, { recursive: true });

  // Scenario A: one worktree, full orchestrator flags, hooks on, single copilot
  if (should('A')) {
    await scenario('A: single copilot, worktree, hooks-on, full orch env', async () => {
      const wt = makeWorktree(demoDir, runDir, 1);
      writeHooksFile(wt, 1, runDir);
      writeCopilotInstructions(wt);
      const env = { ...process.env, ...ORCH_ENV };
      return [await runCopilot(wt, env, 'A1')];
    });
  }

  // Scenario B: two parallel copilots via Promise.all, same setup
  if (should('B')) {
    await scenario('B: two copilots via Promise.all, hooks-on', async () => {
      const wt1 = makeWorktree(demoDir, runDir, 2);
      const wt2 = makeWorktree(demoDir, runDir, 3);
      writeHooksFile(wt1, 2, runDir);
      writeHooksFile(wt2, 3, runDir);
      writeCopilotInstructions(wt1);
      writeCopilotInstructions(wt2);
      const env = { ...process.env, ...ORCH_ENV };
      const [r1, r2] = await Promise.all([runCopilot(wt1, env, 'B1'), runCopilot(wt2, env, 'B2')]);
      return [r1, r2];
    });
  }

  // Scenario C: mimic orchestrator exactly — each step async-awaits a setup
  // phase (worktree, baseSha, hooks) BEFORE its own spawn, all in the same batch.
  if (should('C')) {
    await scenario('C: orchestrator-style: setup+spawn per step, launched together', async () => {
      const env = { ...process.env, ...ORCH_ENV };
      const stepFn = async (stepNum: number, label: string): Promise<Result> => {
        const wt = makeWorktree(demoDir, runDir, stepNum);
        // mimic: `git rev-parse HEAD` right before spawn
        spawnSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' });
        writeHooksFile(wt, stepNum, runDir);
        writeCopilotInstructions(wt);
        return runCopilot(wt, env, label);
      };
      const [r1, r2] = await Promise.all([stepFn(4, 'C1'), stepFn(5, 'C2')]);
      return [r1, r2];
    });
  }

  // Scenario D: two copilots via Promise.all but passed through spawn in
  // a child process that exits before another spawn is started (rule out
  // per-process state).
  if (should('D')) {
    await scenario('D: two copilots but with HOME overridden (check keyring) ', async () => {
      const wt1 = makeWorktree(demoDir, runDir, 6);
      const wt2 = makeWorktree(demoDir, runDir, 7);
      writeHooksFile(wt1, 6, runDir);
      writeHooksFile(wt2, 7, runDir);
      writeCopilotInstructions(wt1);
      writeCopilotInstructions(wt2);
      const env = { ...process.env, ...ORCH_ENV };
      const [r1, r2] = await Promise.all([runCopilot(wt1, env, 'D1'), runCopilot(wt2, env, 'D2')]);
      return [r1, r2];
    });
  }

  console.log('\n=== DONE ===');
}
main().catch(e => { console.error(e); process.exit(1); });

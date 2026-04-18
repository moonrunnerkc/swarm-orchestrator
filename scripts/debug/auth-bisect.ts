/**
 * auth-bisect.ts — progressively layer the orchestrator's copilot spawn context
 * onto a bare `copilot -p "say hello"` call until it fails with the auth error.
 *
 * Each layer prints: layer name, exit code, whether auth failed, last stderr lines.
 * Usage: npx tsx scripts/debug/auth-bisect.ts [--only L3]
 */
import { spawn, spawnSync, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface LayerResult {
  layer: string;
  exitCode: number;
  authFailed: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

const AUTH_RE = /Authentication failed|Request ID:/i;

function tail(s: string, n = 500): string {
  if (!s) return '';
  return s.length > n ? s.slice(-n) : s;
}

async function runCopilot(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
  timeoutMs = 120_000
): Promise<LayerResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const opts: SpawnOptions = { cwd, env };
    const proc = spawn('copilot', args, opts);
    let stdout = '';
    let stderr = '';
    if (proc.stdin) proc.stdin.end();
    if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d.toString(); });
    if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {/**/}
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      const combined = stdout + '\n' + stderr;
      resolve({
        layer: label,
        exitCode: code ?? -1,
        authFailed: AUTH_RE.test(combined),
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        durationMs: Date.now() - started,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({
        layer: label,
        exitCode: -1,
        authFailed: false,
        stdoutTail: '',
        stderrTail: 'spawn error: ' + err.message,
        durationMs: Date.now() - started,
      });
    });
  });
}

function makeTmpGitRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'bisect@local'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'bisect'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# bisect\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeWorktree(baseRepo: string, stepNum: number): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bisect-run-'));
  const wtPath = path.join(runDir, 'worktrees', `step-${stepNum}`);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const branch = `bisect/step-${stepNum}-${Date.now()}`;
  spawnSync('git', ['branch', branch, 'HEAD'], { cwd: baseRepo });
  const r = spawnSync('git', ['worktree', 'add', wtPath, branch], { cwd: baseRepo, stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error('worktree add failed: ' + (r.stderr?.toString() || ''));
  }
  return wtPath;
}

// Orchestrator's 5 extra env vars, matching copilot-adapter.ts and session-executor.ts
const ORCHESTRATOR_ENV_OVERLAY = {
  GIT_AUTHOR_NAME: 'swarm-orchestrator',
  GIT_AUTHOR_EMAIL: 'swarm@localhost',
  GIT_COMMITTER_NAME: 'swarm-orchestrator',
  GIT_COMMITTER_EMAIL: 'swarm@localhost',
  COPILOT_ALLOW_ALL: 'true',
};

const DEMO_FAST_PROMPT = [
  '=== COPILOT CLI SESSION - Step 1 ===',
  '',
  'You are operating as a GitHub Copilot CLI custom agent.',
  '',
  'Your specific task:',
  'Create a tiny TypeScript utility module at src/string-utils.ts that exports a function greet(name: string): string which returns "Hello, <name>!". Keep it boring. No new deps. Add a short top-of-file comment. Commit your work.',
  '',
  'Git Commit Requirements (CRITICAL)',
  'Make INCREMENTAL commits with natural, human-written messages.',
  '',
  '=== BEGIN WORK ===',
].join('\n');

function writeCopilotInstructions(dir: string): void {
  const src = path.resolve(__dirname, '..', '..', '.copilot-instructions.md');
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dir, '.copilot-instructions.md'));
  } else {
    fs.writeFileSync(path.join(dir, '.copilot-instructions.md'), '# swarm orchestrator\n');
  }
}

async function main() {
  const results: LayerResult[] = [];
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

  const envOk = path.resolve('docs/debug/env-ok.json');
  const envFail = path.resolve('docs/debug/env-fail.json');
  fs.mkdirSync(path.dirname(envOk), { recursive: true });

  const shouldRun = (name: string) => !only || only === name;

  // L0: bare spawn in os.tmpdir()
  if (shouldRun('L0')) {
    console.log('\n=== L0: bare copilot in os.tmpdir() ===');
    const env0 = { ...process.env };
    fs.writeFileSync(envOk, JSON.stringify(env0, null, 2));
    const r = await runCopilot(['-p', 'say hello', '--allow-all'], os.tmpdir(), env0, 'L0');
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
  }

  // L1: worktree cwd
  const baseRepo = makeTmpGitRepo('bisect-base-');
  const wt1 = makeWorktree(baseRepo, 1);
  if (shouldRun('L1')) {
    console.log('\n=== L1: copilot in git worktree ===');
    const r = await runCopilot(['-p', 'say hello', '--allow-all'], wt1, { ...process.env }, 'L1');
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
  }

  // L2: worktree + 5 extra env vars
  if (shouldRun('L2')) {
    console.log('\n=== L2: worktree + 5 orchestrator env vars ===');
    const env2 = { ...process.env, ...ORCHESTRATOR_ENV_OVERLAY };
    const r = await runCopilot(['-p', 'say hello', '--allow-all'], wt1, env2, 'L2');
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
  }

  // L3: + .copilot-instructions.md in worktree
  if (shouldRun('L3')) {
    console.log('\n=== L3: worktree + env + .copilot-instructions.md ===');
    writeCopilotInstructions(wt1);
    const env3 = { ...process.env, ...ORCHESTRATOR_ENV_OVERLAY };
    const r = await runCopilot(['-p', 'say hello', '--allow-all'], wt1, env3, 'L3');
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
  }

  // L4: + demo-fast multiline prompt
  if (shouldRun('L4')) {
    console.log('\n=== L4: L3 + full demo-fast prompt ===');
    writeCopilotInstructions(wt1);
    const env4 = { ...process.env, ...ORCHESTRATOR_ENV_OVERLAY };
    const r = await runCopilot(['-p', DEMO_FAST_PROMPT, '--allow-all'], wt1, env4, 'L4');
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
    if (r.authFailed) {
      fs.writeFileSync(envFail, JSON.stringify(env4, null, 2));
      console.log('  [wrote env-fail.json]');
    }
  }

  // L5: spawned from inside a tsx-exec'd parent (we already are tsx). We
  // simulate child-of-tsx by spawning tsx to spawn copilot.
  if (shouldRun('L5')) {
    console.log('\n=== L5: copilot via tsx-child wrapper ===');
    const wrapperPath = path.join(os.tmpdir(), `bisect-wrapper-${Date.now()}.ts`);
    const wrapperSrc = `import { spawnSync } from 'child_process';
const r = spawnSync('copilot', ${JSON.stringify(['-p', DEMO_FAST_PROMPT, '--allow-all'])}, {
  cwd: ${JSON.stringify(wt1)},
  env: { ...process.env, ...${JSON.stringify(ORCHESTRATOR_ENV_OVERLAY)} },
  stdio: 'pipe',
});
process.stdout.write(r.stdout || Buffer.from(''));
process.stderr.write(r.stderr || Buffer.from(''));
process.exit(r.status ?? 1);
`;
    fs.writeFileSync(wrapperPath, wrapperSrc);
    writeCopilotInstructions(wt1);
    const started = Date.now();
    const child = spawnSync('npx', ['tsx', wrapperPath], {
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 180_000,
    });
    const out = (child.stdout || '') + (child.stderr || '');
    const r: LayerResult = {
      layer: 'L5',
      exitCode: child.status ?? -1,
      authFailed: AUTH_RE.test(out),
      stdoutTail: tail(child.stdout || ''),
      stderrTail: tail(child.stderr || ''),
      durationMs: Date.now() - started,
    };
    results.push(r);
    console.log(`  exit=${r.exitCode} authFailed=${r.authFailed} dur=${r.durationMs}ms`);
    if (r.stderrTail) console.log('  stderrTail:', r.stderrTail.slice(-300));
    try { fs.unlinkSync(wrapperPath); } catch {/**/}
  }

  // L6: two concurrent invocations (second agent spawning while first is active)
  if (shouldRun('L6')) {
    console.log('\n=== L6: two concurrent copilot invocations ===');
    const wt2 = makeWorktree(baseRepo, 2);
    writeCopilotInstructions(wt1);
    writeCopilotInstructions(wt2);
    const env6 = { ...process.env, ...ORCHESTRATOR_ENV_OVERLAY };
    const [r1, r2] = await Promise.all([
      runCopilot(['-p', DEMO_FAST_PROMPT, '--allow-all'], wt1, env6, 'L6a'),
      runCopilot(['-p', DEMO_FAST_PROMPT, '--allow-all'], wt2, env6, 'L6b'),
    ]);
    results.push(r1, r2);
    console.log(`  L6a: exit=${r1.exitCode} authFailed=${r1.authFailed} dur=${r1.durationMs}ms`);
    console.log(`  L6b: exit=${r2.exitCode} authFailed=${r2.authFailed} dur=${r2.durationMs}ms`);
    if (r1.authFailed || r2.authFailed) {
      fs.writeFileSync(envFail, JSON.stringify(env6, null, 2));
      console.log('  [wrote env-fail.json]');
      if (r1.stderrTail) console.log('  L6a stderrTail:', r1.stderrTail.slice(-300));
      if (r2.stderrTail) console.log('  L6b stderrTail:', r2.stderrTail.slice(-300));
    }
  }

  // Summary
  console.log('\n======== BISECT SUMMARY ========');
  for (const r of results) {
    const status = r.authFailed ? 'AUTH-FAIL' : (r.exitCode === 0 ? 'OK' : `EXIT=${r.exitCode}`);
    console.log(`  ${r.layer.padEnd(5)} ${status.padEnd(12)} ${r.durationMs}ms`);
  }
  const firstFail = results.find(r => r.authFailed);
  if (firstFail) {
    console.log(`\n>>> FIRST AUTH FAILURE AT: ${firstFail.layer}\n`);
  } else {
    console.log('\n>>> NO AUTH FAILURE REPRODUCED <<<\n');
  }
}

main().catch(e => { console.error(e); process.exit(1); });

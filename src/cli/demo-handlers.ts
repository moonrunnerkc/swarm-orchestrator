/**
 * Demo and template CLI command handlers.
 * Extracted from cli-handlers.ts for modularity.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DemoMode } from '../demo-mode';
import { savePlanFile } from '../plan-files';
import { ExecuteSwarmCliOptions, parseSwarmFlags } from './flags';
import { getLogger, setPrettyMode } from '../logger';

// Minimal ANSI helpers for a cleaner demo UX. No chalk dep to keep the
// dist footprint unchanged. NO_COLOR env disables coloring for CI / pipes.
const colorOn = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => colorOn ? `\x1b[1m${s}\x1b[22m` : s,
  dim: (s: string) => colorOn ? `\x1b[2m${s}\x1b[22m` : s,
  cyan: (s: string) => colorOn ? `\x1b[36m${s}\x1b[39m` : s,
  magenta: (s: string) => colorOn ? `\x1b[35m${s}\x1b[39m` : s,
  green: (s: string) => colorOn ? `\x1b[32m${s}\x1b[39m` : s,
};

const logger = getLogger('cli:demo');

/**
 * Install npm dependencies for all package.json files in demo output.
 * Makes the demo runnable immediately after completion.
 */
export async function installDemoDependencies(demoDir: string): Promise<void> {
  const { execSync } = await import('child_process');

  const packageJsonPaths: string[] = [];

  function findPackageJsons(dir: string, depth: number = 0): void {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'runs') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findPackageJsons(fullPath, depth + 1);
        } else if (entry.name === 'package.json') {
          packageJsonPaths.push(dir);
        }
      }
    } catch {
      // Permission denied or broken symlink; skip this subtree
    }
  }

  findPackageJsons(demoDir);

  if (packageJsonPaths.length === 0) {
    return;
  }

  packageJsonPaths.sort((a, b) => a.length - b.length);

  const colorOn = process.stdout.isTTY && !process.env.NO_COLOR;
  const dim = (s: string) => colorOn ? `\x1b[2m${s}\x1b[22m` : s;
  const green = (s: string) => colorOn ? `\x1b[32m${s}\x1b[39m` : s;
  const red = (s: string) => colorOn ? `\x1b[31m${s}\x1b[39m` : s;

  logger.info(`\n  ${dim(`installing dependencies (${packageJsonPaths.length} location${packageJsonPaths.length === 1 ? '' : 's'})`)}`);

  let successCount = 0;
  let failCount = 0;

  for (const pkgDir of packageJsonPaths) {
    const relativePath = path.relative(demoDir, pkgDir) || '.';
    try {
      execSync('npm install --loglevel=error', {
        cwd: pkgDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000
      });
      logger.info(`  ${green('✓')} ${relativePath}`);
      successCount++;
    } catch {
      logger.warn(`  ${red('✗')} ${relativePath} ${dim('(run npm install manually)')}`);
      failCount++;
    }
  }

  if (failCount > 0) {
    logger.warn(`  ${dim(`installed ${successCount}/${packageJsonPaths.length}; resolve failures before running`)}`);
  }

  logger.info(`\n  ${dim('to run:')}`);
  logger.info(`    cd ${demoDir}`);

  const rootPkgPath = path.join(demoDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      if (pkg.scripts?.['start:server']) {
        logger.info(`    npm run start:server   ${dim('# backend')}`);
      } else if (pkg.scripts?.start) {
        logger.info(`    npm start              ${dim('# server')}`);
      }
      if (pkg.scripts?.dev) {
        logger.info(`    npm run dev            ${dim('# dev server')}`);
      }
      if (pkg.scripts?.test) {
        logger.info(`    npm test               ${dim('# tests')}`);
      }
    } catch {
      logger.info('    npm start');
    }
  }

  const frontendPkgPath = path.join(demoDir, 'frontend', 'package.json');
  if (fs.existsSync(frontendPkgPath)) {
    logger.info(`\n    ${dim('# frontend (separate terminal)')}`);
    logger.info('    cd frontend && npm run dev');
  }

  logger.info('');
}

export async function handleDemoCommand(args: string[]): Promise<number> {
  const subcommand = args[1];

  if (!subcommand || subcommand === '--help') {
    setPrettyMode(true);
    logger.info('\n  demo scenarios');
    logger.info('    demo-fast    two independent utility files, one wave');
    logger.info('    api-quick    REST API + tests + Dockerfile, two waves');
    logger.info('\n  run:  swarm demo <name>');
    logger.info('  list: swarm demo list\n');
    return 0;
  }

  if (subcommand === 'list') {
    setPrettyMode(true);
    const demoMode = new DemoMode();
    const scenarios = demoMode.getAvailableScenarios();

    logger.info(`\n  ${c.bold('demo scenarios')}\n`);

    scenarios.forEach(scenario => {
      logger.info(`  ${c.bold(scenario.name)}`);
      logger.info(`    ${c.dim(scenario.description)}`);
      logger.info(`    ${c.dim(`${scenario.steps.length} step${scenario.steps.length === 1 ? '' : 's'} · ${scenario.expectedDuration}`)}\n`);
    });

    logger.info(`  ${c.dim('run:')} swarm demo <name>\n`);
    return 0;
  }

  // Run a demo scenario
  try {
    return await runDemo(subcommand);
  } catch (error) {
    logger.error('Error running demo:', error instanceof Error ? error.message : error);
    return 1;
  }
}

export async function runDemo(scenarioName: string): Promise<number> {
  // Demos get a cleaner UX: drop `[scope]` log prefixes.
  setPrettyMode(true);

  const { executeSwarm } = await import('./swarm-handlers');

  const demoMode = new DemoMode();
  const scenario = demoMode.getScenario(scenarioName);

  // Parse all CLI flags (including --target, --pr, --hooks, etc.)
  const cliArgs = process.argv.slice(2);
  const parsedFlags = parseSwarmFlags(cliArgs);

  const os = require('os');
  let demoDir: string;
  let isExternalTarget = false;

  if (parsedFlags.targetDir) {
    demoDir = path.resolve(parsedFlags.targetDir);
    isExternalTarget = true;
    if (!fs.existsSync(demoDir)) {
      logger.error(`${c.bold('error:')} target directory does not exist: ${demoDir}`);
      return 1;
    }
  } else {
    demoDir = fs.mkdtempSync(path.join(os.tmpdir(), `swarm-demo-${scenarioName}-`));
    const { execSync } = require('child_process');
    execSync('git init', { cwd: demoDir, stdio: 'pipe' });
    execSync('git config user.email "demo@swarm.local"', { cwd: demoDir, stdio: 'pipe' });
    execSync('git config user.name "Swarm Demo"', { cwd: demoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(demoDir, 'README.md'), `# Swarm Demo: ${scenarioName}\n`);
    execSync('git add . && git commit -m "init demo"', { cwd: demoDir, stdio: 'pipe' });
  }

  // Run the demo in the target directory; restore cwd when done
  const originalDir = process.cwd();
  process.chdir(demoDir);

  try {
    if (!scenario) {
      logger.error(`${c.bold('error:')} demo scenario "${scenarioName}" not found`);
      logger.info('');
      logger.info('Available scenarios:');
      demoMode.getAvailableScenarios().forEach(s => {
        logger.info(`  ${c.cyan(s.name.padEnd(12))}  ${c.dim(s.description)}`);
      });
      logger.info('');
      logger.info(`Run: ${c.bold('swarm demo list')}`);
      return 1;
    }

    logger.info('');
    logger.info(`  ${c.bold('swarm')} ${c.dim('·')} ${scenario.name}`);
    logger.info(`  ${c.dim(scenario.description)}`);
    logger.info('');
    logger.info(`  steps     ${scenario.steps.length}`);
    logger.info(`  duration  ${c.dim(scenario.expectedDuration)}`);
    logger.info(`  folder    ${demoDir} ${c.dim(isExternalTarget ? '(target)' : '(temp)')}`);
    logger.info('');

    const plan = demoMode.scenarioToPlan(scenario);

    const planPath = savePlanFile(plan);

    const execOpts: ExecuteSwarmCliOptions = {
      ...parsedFlags,
      noQualityGates: true,
    };
    const exitCode = await executeSwarm(path.basename(planPath), execOpts);

    await installDemoDependencies(demoDir);

    return exitCode;
  } finally {
    process.chdir(originalDir);
  }
}

export async function handleTemplatesCommand(): Promise<number> {
  const templatesDir = path.join(__dirname, '..', '..', 'templates');
  const resolvedDir = fs.existsSync(templatesDir) ? templatesDir : path.join(__dirname, '..', '..', '..', 'templates');
  if (!fs.existsSync(resolvedDir)) {
    logger.error('Templates directory not found.');
    return 1;
  }
  const files = fs.readdirSync(resolvedDir).filter((f: string) => f.endsWith('.json'));
  logger.info('\n  Available Plan Templates\n');
  logger.info('  ' + '-'.repeat(60));
  for (const file of files) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(resolvedDir, file), 'utf8'));
      const steps = plan.steps?.length || 0;
      const duration = plan.metadata?.estimatedDuration || 'unknown';
      logger.info(`  ${file.padEnd(20)} ${String(steps).padStart(2)} steps   ${duration}`);
    } catch {
      // Template file is malformed; show it in the listing with an error indicator
      logger.info(`  ${file.padEnd(20)}  (invalid JSON)`);
    }
  }
  logger.info('  ' + '-'.repeat(60));
  logger.info(`\n  Usage: swarm swarm templates/<template>.json\n`);
  return 0;
}

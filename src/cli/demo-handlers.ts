/**
 * Demo and template CLI command handlers.
 * Extracted from cli-handlers.ts for modularity.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DemoMode } from '../demo-mode';
import { PlanStorage } from '../plan-storage';
import { ExecuteSwarmCliOptions, parseSwarmFlags } from './flags';
import { showUsage } from './usage';
import { getLogger } from '../logger';

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

  logger.info('\n📦 Installing dependencies for demo output...\n');

  packageJsonPaths.sort((a, b) => a.length - b.length);

  let successCount = 0;
  let failCount = 0;

  for (const pkgDir of packageJsonPaths) {
    const relativePath = path.relative(demoDir, pkgDir) || '.';
    try {
      logger.info(`  📂 ${relativePath}/`);
      execSync('npm install --loglevel=error', {
        cwd: pkgDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000
      });
      logger.info(`     ✅ Dependencies installed\n`);
      successCount++;
    } catch {
      logger.warn(`     ⚠️  npm install failed (run manually)\n`);
      failCount++;
    }
  }

  logger.info('━'.repeat(60));
  if (failCount === 0) {
    logger.info(`✅ All dependencies installed (${successCount} location${successCount > 1 ? 's' : ''})`);
  } else {
    logger.warn(`⚠️  Installed ${successCount}/${packageJsonPaths.length} - some may need manual install`);
  }

  logger.info('\n🚀 To run the demo:\n');
  logger.info(`   cd ${demoDir}`);

  const rootPkgPath = path.join(demoDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      if (pkg.scripts?.['start:server']) {
        logger.info('   npm run start:server   # Start backend');
      } else if (pkg.scripts?.start) {
        logger.info('   npm start              # Start server');
      }
      if (pkg.scripts?.dev) {
        logger.info('   npm run dev            # Start dev server');
      }
      if (pkg.scripts?.test) {
        logger.info('   npm test               # Run tests');
      }
    } catch {
      // package.json unreadable or malformed; show generic start command
      logger.info('   npm start');
    }
  }

  const frontendPkgPath = path.join(demoDir, 'frontend', 'package.json');
  if (fs.existsSync(frontendPkgPath)) {
    logger.info('\n   # Frontend (in separate terminal):');
    logger.info('   cd frontend && npm run dev');
  }

  logger.info('');
}

export async function handleDemoCommand(args: string[]): Promise<number> {
  const subcommand = args[1];

  if (!subcommand || subcommand === '--help') {
    logger.info('\nAvailable demo scenarios:');
    logger.info('  demo-fast      - Hello-world swarm (2 steps, ~1 min)');
    logger.info('  api-quick      - REST API with tests and Dockerfile (3 steps, ~5 min)\n');
    logger.info('Usage:');
    logger.info('  swarm demo <scenario-name>');
    logger.info('  swarm demo list\n');
    return 0;
  }

  if (subcommand === 'list') {
    const demoMode = new DemoMode();
    const scenarios = demoMode.getAvailableScenarios();

    logger.info('\n╔══════════════════════════════════════════════════════════════════════╗');
    logger.info('║  Available Demo Scenarios                                            ║');
    logger.info('╚══════════════════════════════════════════════════════════════════════╝\n');

    scenarios.forEach(scenario => {
      logger.info(`📋 ${scenario.name}`);
      logger.info(`   ${scenario.description}`);
      logger.info(`   Duration: ${scenario.expectedDuration}`);
      logger.info(`   Steps: ${scenario.steps.length}\n`);
    });

    logger.info('To run a demo:');
    logger.info('  swarm demo <scenario-name>\n');
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
  // Import from the extracted swarm-handlers module
  const { executeSwarm } = await import('./swarm-handlers');

  logger.info('🐝 Swarm Orchestrator - Demo Mode\n');

  const demoMode = new DemoMode();
  const scenario = demoMode.getScenario(scenarioName);

  // Parse all CLI flags (including --target, --pr, --hooks, etc.)
  const cliArgs = process.argv.slice(2);
  const parsedFlags = parseSwarmFlags(cliArgs);

  const os = require('os');
  let demoDir: string;
  let isExternalTarget = false;

  if (parsedFlags.targetDir) {
    // Use provided target directory instead of creating a temp one
    demoDir = path.resolve(parsedFlags.targetDir);
    isExternalTarget = true;
    if (!fs.existsSync(demoDir)) {
      logger.error(`❌ Target directory does not exist: ${demoDir}`);
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
  logger.info(`📂 Demo folder: ${demoDir}\n`);

  // Run the demo in the target directory; restore cwd when done
  const originalDir = process.cwd();
  process.chdir(demoDir);

  try {
    if (!scenario) {
      logger.error(`❌ Demo scenario "${scenarioName}" not found\n`);
      logger.info('Available scenarios:');
      demoMode.getAvailableScenarios().forEach(s => {
        logger.info(`  - ${s.name}: ${s.description}`);
      });
      logger.info('\nRun: swarm demo list\n');
      return 1;
    }

    logger.info(`📋 Scenario: ${scenario.name}`);
    logger.info(`Description: ${scenario.description}`);
    logger.info(`Estimated Duration: ${scenario.expectedDuration}`);
    logger.info(`Steps: ${scenario.steps.length}\n`);

    logger.info('This demo will:');
    logger.info('  1. Execute all steps in parallel based on dependencies');
    logger.info('  2. Show progress via structured console output');
    logger.info('  3. Verify each step with evidence-based checks');
    logger.info('  4. Demonstrate human-like git commit history\n');

    logger.info('ℹ️  NOTE: This will execute real Copilot CLI sessions.');
    logger.info(`    Running in ${isExternalTarget ? 'target' : 'temp'} folder: ${process.cwd()}\n`);

    const plan = demoMode.scenarioToPlan(scenario);

    const storage = new PlanStorage();
    const planPath = storage.savePlan(plan);

    logger.info(`✅ Demo plan saved to: ${planPath}\n`);

    // Forward all parsed CLI flags to the swarm executor
    const execOpts: ExecuteSwarmCliOptions = { ...parsedFlags, noQualityGates: true };
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

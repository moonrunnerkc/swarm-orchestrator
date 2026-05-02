import { OutputFormat } from '../logger';

export interface ExecuteSwarmCliOptions {
  model?: string;
  confirmDeploy?: boolean;
  noQualityGates?: boolean;
  qualityGatesConfigPath?: string;
  qualityGatesOutDir?: string;
  pm?: boolean;
  strictIsolation?: boolean;
  lean?: boolean;
  useInnerFleet?: boolean;
  session?: string;
  costEstimateOnly?: boolean;
  maxPremiumRequests?: number;
  maxRetries?: number;
  prMode?: 'auto' | 'review';
  hooksEnabled?: boolean;
  targetDir?: string;
  cliAgent?: string;
  owaspReport?: boolean;
  differentialTestCommand?: string;
  yes?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  streamAgent?: boolean;
  outputFormat?: OutputFormat;
}

export function parseOutputFormat(args: string[]): OutputFormat {
  if (args.includes('--json')) return 'json';
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1] === 'json') return 'json';
  return 'text';
}

interface PositionalArgOptions {
  booleanFlags?: string[];
  valueFlags?: string[];
}

export function extractPositionalArgs(
  args: string[],
  options: PositionalArgOptions = {}
): string[] {
  const booleanFlags = new Set(options.booleanFlags ?? []);
  const valueFlags = new Set(options.valueFlags ?? []);
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (booleanFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) continue;

    positional.push(arg);
  }

  return positional;
}

export function normalizeLeadingGlobalFlags(args: string[]): string[] {
  const reorderedFlags: string[] = [];
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--verbose' || arg === '--quiet' || arg === '-q' || arg === '--json' || arg === '--help' || arg === '-h') {
      reorderedFlags.push(arg);
      index += 1;
      continue;
    }

    if (arg === '--output') {
      reorderedFlags.push(arg);
      if (args[index + 1]) {
        reorderedFlags.push(args[index + 1]);
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    break;
  }

  if (reorderedFlags.length === 0) {
    return args;
  }

  if (index >= args.length) {
    if (reorderedFlags.includes('--help') || reorderedFlags.includes('-h')) {
      const trailingFlags = reorderedFlags.filter((flag) => flag !== '--help' && flag !== '-h');
      return ['--help', ...trailingFlags];
    }
    return args;
  }

  return [args[index], ...reorderedFlags, ...args.slice(index + 1)];
}

export function parseSwarmFlags(args: string[]): ExecuteSwarmCliOptions {
  const opts: ExecuteSwarmCliOptions = {};
  if (parseOutputFormat(args) === 'json') {
    opts.outputFormat = 'json';
  }

  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args[modelIndex + 1]) opts.model = args[modelIndex + 1];

  if (args.includes('--confirm-deploy')) opts.confirmDeploy = true;
  if (args.includes('--no-quality-gates')) opts.noQualityGates = true;
  if (args.includes('--pm')) opts.pm = true;
  if (args.includes('--strict-isolation')) opts.strictIsolation = true;
  if (args.includes('--lean')) opts.lean = true;
  if (args.includes('--verbose')) opts.verbose = true;
  if (args.includes('--useInnerFleet') || args.includes('--wrap-fleet')) opts.useInnerFleet = true;
  if (args.includes('--cost-estimate-only')) opts.costEstimateOnly = true;
  if (args.includes('--yes') || args.includes('-y')) opts.yes = true;
  if (args.includes('--quiet') || args.includes('-q')) opts.quiet = true;
  if (args.includes('--stream-agent')) opts.streamAgent = true;

  if (args.includes('--no-hooks')) {
    opts.hooksEnabled = false;
  } else if (args.includes('--hooks')) {
    opts.hooksEnabled = true;
  }

  const maxPremIdx = args.indexOf('--max-premium-requests');
  if (maxPremIdx !== -1 && args[maxPremIdx + 1]) {
    const parsed = parseInt(args[maxPremIdx + 1], 10);
    if (isNaN(parsed) || parsed < 0) {
      throw new Error(
        `--max-premium-requests requires a non-negative integer, got "${args[maxPremIdx + 1]}"`
      );
    }
    opts.maxPremiumRequests = parsed;
  }

  const maxRetriesIdx = args.indexOf('--max-retries');
  if (maxRetriesIdx !== -1 && args[maxRetriesIdx + 1]) {
    const parsed = parseInt(args[maxRetriesIdx + 1], 10);
    if (isNaN(parsed) || parsed < 0) {
      throw new Error(
        `--max-retries requires a non-negative integer, got "${args[maxRetriesIdx + 1]}"`
      );
    }
    opts.maxRetries = parsed;
  }

  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1 && args[resumeIndex + 1]) opts.session = args[resumeIndex + 1];

  const qgConfigIndex = args.indexOf('--quality-gates-config');
  if (qgConfigIndex !== -1 && args[qgConfigIndex + 1]) {
    opts.qualityGatesConfigPath = args[qgConfigIndex + 1];
  }

  const qgOutIndex = args.indexOf('--quality-gates-out');
  if (qgOutIndex !== -1 && args[qgOutIndex + 1]) {
    opts.qualityGatesOutDir = args[qgOutIndex + 1];
  }

  const prIndex = args.indexOf('--pr');
  if (prIndex !== -1 && args[prIndex + 1]) {
    const mode = args[prIndex + 1];
    if (mode !== 'auto' && mode !== 'review') {
      throw new Error(
        `--pr requires "auto" or "review", got "${mode}"`
      );
    }
    opts.prMode = mode;
  }

  const targetIndex = args.indexOf('--target') !== -1
    ? args.indexOf('--target')
    : args.indexOf('--dir');
  if (targetIndex !== -1 && args[targetIndex + 1]) {
    opts.targetDir = args[targetIndex + 1];
  }

  if (args.includes('--owasp-report')) opts.owaspReport = true;

  const toolIndex = args.indexOf('--tool');
  if (toolIndex !== -1 && args[toolIndex + 1]) {
    opts.cliAgent = args[toolIndex + 1];
  }

  const diffTestCmdIdx = args.indexOf('--differential-test-command');
  if (diffTestCmdIdx !== -1 && args[diffTestCmdIdx + 1]) {
    opts.differentialTestCommand = args[diffTestCmdIdx + 1];
  }

  return opts;
}

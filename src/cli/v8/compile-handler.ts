import * as path from 'path';
import { getLogger } from '../../logger';
import {
  ContractValidationError,
  compileGoal,
  discoverRepoContext,
  finalize,
} from '../../contract/compiler';
import { writeContract } from '../../contract/serializer';
import { runApproval, ContractRejectedError } from '../../contract/approval';
import { type Extractor } from '../../contract/extractor/types';
import { AnthropicExtractor } from '../../contract/extractor/anthropic-extractor';
import { StubExtractor } from '../../contract/extractor/stub-extractor';

const logger = getLogger('cli:v8:compile');

/** Parsed flags for `swarm v8 compile`. */
export interface CompileFlags {
  goal: string;
  out: string | null;
  repoRoot: string;
  autoApprove: boolean;
  disableEditor: boolean;
  extractor: 'anthropic' | 'stub' | 'stub-heuristic';
  model: string | null;
  temperature: number | null;
  apiKey: string | null;
}

/** Test seam: lets tests inject a custom extractor without touching env. */
export interface CompileHandlerInjections {
  extractor?: Extractor;
}

/**
 * Implementation of `swarm v8 compile <goal> [flags]`.
 *
 * Returns an exit code:
 *   0 — contract written
 *   1 — validation or runtime error
 *   2 — user rejected the contract
 *   3 — missing API key for default extractor
 */
export async function handleCompile(
  argv: string[],
  injections: CompileHandlerInjections = {},
): Promise<number> {
  let flags: CompileFlags;
  try {
    flags = parseCompileFlags(argv);
  } catch (err) {
    logger.error((err as Error).message);
    printCompileUsage();
    return 1;
  }

  const repoContext = discoverRepoContext(path.resolve(flags.repoRoot));

  let extractor: Extractor;
  try {
    extractor = injections.extractor ?? buildExtractor(flags);
  } catch (err) {
    logger.error((err as Error).message);
    return 3;
  }

  let draft;
  try {
    draft = await compileGoal({
      goal: flags.goal,
      repoContext,
      extractor,
    });
  } catch (err) {
    if (err instanceof ContractValidationError) {
      logger.error(err.message);
      return 1;
    }
    logger.error(
      `contract compilation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  let approved;
  try {
    approved = await runApproval(draft, {
      autoApprove: flags.autoApprove,
      disableEditor: flags.disableEditor,
    });
  } catch (err) {
    if (err instanceof ContractRejectedError) {
      logger.warn(err.message);
      return 2;
    }
    throw err;
  }

  const finalContract = finalize(approved);
  const outDir =
    flags.out ??
    path.join(flags.repoRoot, '.swarm', 'contracts', finalContract.manifest.contractId);
  writeContract(outDir, finalContract);
  logger.info(`contract written: ${outDir}`);
  logger.info(`contract id:      ${finalContract.manifest.contractId}`);
  logger.info(`contract hash:    ${finalContract.manifest.contractHash}`);
  return 0;
}

function buildExtractor(flags: CompileFlags): Extractor {
  if (flags.extractor === 'stub') return StubExtractor.fromHeuristic();
  if (flags.extractor === 'stub-heuristic') return StubExtractor.fromHeuristic();
  // anthropic: require an API key one way or the other.
  const apiKey = flags.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Pass --api-key, set the env var, or use --extractor stub.',
    );
  }
  const opts: ConstructorParameters<typeof AnthropicExtractor>[0] = { apiKey };
  if (flags.model !== null) opts.model = flags.model;
  if (flags.temperature !== null) opts.temperature = flags.temperature;
  return new AnthropicExtractor(opts);
}

/**
 * Parse `swarm v8 compile` argv. The first positional is the goal; flags
 * may appear in any order. Multiple positionals are joined with spaces so
 * unquoted goals work (`swarm v8 compile add a health check endpoint`).
 */
export function parseCompileFlags(argv: string[]): CompileFlags {
  const positionals: string[] = [];
  const flags: CompileFlags = {
    goal: '',
    out: null,
    repoRoot: process.cwd(),
    autoApprove: false,
    disableEditor: false,
    extractor: 'anthropic',
    model: null,
    temperature: null,
    apiKey: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--yes' || arg === '-y') {
      flags.autoApprove = true;
    } else if (arg === '--no-editor') {
      flags.disableEditor = true;
    } else if (arg === '--out') {
      flags.out = requireValue(argv, ++i, '--out');
    } else if (arg === '--repo-root') {
      flags.repoRoot = requireValue(argv, ++i, '--repo-root');
    } else if (arg === '--extractor') {
      const v = requireValue(argv, i + 1, '--extractor');
      i += 1;
      if (v !== 'anthropic' && v !== 'stub' && v !== 'stub-heuristic') {
        throw new Error(`invalid --extractor value "${v}"; expected one of anthropic, stub, stub-heuristic`);
      }
      flags.extractor = v;
    } else if (arg === '--model') {
      flags.model = requireValue(argv, ++i, '--model');
    } else if (arg === '--temperature') {
      const raw = requireValue(argv, ++i, '--temperature');
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) throw new Error(`invalid --temperature "${raw}"; must be a number`);
      flags.temperature = n;
    } else if (arg === '--api-key') {
      flags.apiKey = requireValue(argv, ++i, '--api-key');
    } else if (arg === '--help' || arg === '-h') {
      printCompileUsage();
      throw new Error('help requested');
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    throw new Error('missing goal: usage `swarm v8 compile <goal> [flags]`');
  }
  flags.goal = positionals.join(' ').trim();
  if (flags.goal.length === 0) {
    throw new Error('goal is empty');
  }
  return flags;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return v;
}

function printCompileUsage(): void {
  process.stderr.write(
    [
      'usage: swarm v8 compile <goal> [flags]',
      '',
      'flags:',
      '  --out <dir>           where to write the contract (default .swarm/contracts/<id>/)',
      '  --repo-root <path>    project root for repo-context discovery (default cwd)',
      '  --yes, -y             auto-approve without prompting',
      '  --no-editor           disable the [e]dit option in the approval prompt',
      '  --extractor <name>    anthropic (default) | stub | stub-heuristic',
      '  --model <id>          Anthropic model id override (default claude-sonnet-4-6)',
      '  --temperature <n>     sampling temperature override (default 0)',
      '  --api-key <key>       Anthropic API key override (default $ANTHROPIC_API_KEY)',
      '  --help, -h            show this message',
      '',
    ].join('\n'),
  );
}

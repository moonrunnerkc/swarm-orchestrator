import { getLogger } from '../../logger';
import { handleAudit } from './audit-handler';
import { handleCompile } from './compile-handler';
import { handleDoctor } from './doctor-handler';
import { handleInit } from './init-handler';
import { handleLedger } from './ledger-verify-handler';
import { handleResume } from './resume-handler';
import { handleRun } from './run-handler';
import { handleStats } from './stats-handler';

const logger = getLogger('cli:v8');

/**
 * Top-level handler for `swarm v8 <subcommand> [args]`.
 *
 * Phase 1 ships `compile`. Phase 2 ships `run`. Phase 4 ships `resume`.
 *
 * @param argv arguments AFTER the literal `v8` token, i.e. the subcommand
 *   plus its flags.
 */
export async function handleV8Command(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'compile':
      return handleCompile(rest);
    case 'run':
      return handleRun(rest);
    case 'resume':
      return handleResume(rest);
    case 'stats':
      return handleStats(rest);
    case 'ledger':
      return handleLedger(rest);
    case 'init':
      return handleInit(rest);
    case 'doctor':
      return handleDoctor(rest);
    case 'audit':
      return handleAudit(rest);
    case undefined:
    case '--help':
    case '-h':
      printV8Usage();
      return sub === undefined ? 1 : 0;
    default:
      logger.error(`unknown v8 subcommand: ${sub}`);
      printV8Usage();
      return 1;
  }
}

function printV8Usage(): void {
  process.stderr.write(
    [
      'usage: swarm v8 <subcommand> [args]',
      '',
      'subcommands:',
      '  compile <goal>   compile a natural-language goal into a contract',
      '  run <contract>   run a compiled contract',
      '  resume <run-id>  resume a partially-completed run',
      '  stats <run-id>   aggregate diagnostic counts from a run ledger',
      '  ledger verify <run-id>  verify a hash-chained ledger at rest',
      '  doctor           probe local prerequisites (API key, falsifiers, PMs)',
      '  init             scaffold contract.yaml + patches.jsonl',
      '  audit            audit a PR for AI-agent cheat patterns (v10)',
      '',
      'For per-subcommand flags, see `swarm v8 <subcommand> --help`.',
      '',
    ].join('\n'),
  );
}

import { getLogger } from '../../logger';
import { handleCompile } from './compile-handler';

const logger = getLogger('cli:v8');

/**
 * Top-level handler for `swarm v8 <subcommand> [args]`.
 *
 * Phase 1 implements `compile`. `run` and `resume` are reserved for Phase 2
 * and Phase 4 respectively; calling them now exits non-zero with a stub
 * message.
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
      logger.error('`swarm v8 run` is not implemented yet (Phase 2 deliverable).');
      return 64;
    case 'resume':
      logger.error('`swarm v8 resume` is not implemented yet (Phase 4 deliverable).');
      return 64;
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
      '  run <contract>   run a compiled contract              (Phase 2 — not yet implemented)',
      '  resume <run-id>  resume a partially-completed run     (Phase 4 — not yet implemented)',
      '',
      'For per-subcommand flags, see `swarm v8 <subcommand> --help`.',
      '',
    ].join('\n'),
  );
}

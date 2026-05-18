/**
 * Implementation of `swarm v8 init` (and `swarm init`).
 *
 * Scaffolds a starter `contract.yaml` and `patches.jsonl` in the
 * target directory, using language-appropriate build/test obligations.
 *
 * Flags:
 *   --language <lang>   node (default) | python | go | rust
 *   --force             overwrite existing files (default: skip)
 *   --cwd <path>        target directory (default: process.cwd())
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { runParseArgs, readBoolean, readString, type ParseArgsOptions } from './argv-schema';

const logger = getLogger('cli:v8:init');

/** Language-specific contract templates. */
const CONTRACT_TEMPLATES: Record<string, string> = {
  node: [
    'obligations:',
    '  - type: build-must-pass',
    '    command: npm run build',
    '  - type: test-must-pass',
    '    command: npm test',
  ].join('\n'),

  python: [
    'obligations:',
    '  - type: build-must-pass',
    '    command: python -m compileall .',
    '  - type: test-must-pass',
    '    command: pytest',
  ].join('\n'),

  go: [
    'obligations:',
    '  - type: build-must-pass',
    '    command: go build ./...',
    '  - type: test-must-pass',
    '    command: go test ./...',
  ].join('\n'),

  rust: [
    'obligations:',
    '  - type: build-must-pass',
    '    command: cargo build',
    '  - type: test-must-pass',
    '    command: cargo test',
  ].join('\n'),
};

const VALID_LANGUAGES = Object.keys(CONTRACT_TEMPLATES);
const PATCHES_CONTENT = '{"patch":"no-op","source":"swarm-init"}\n';

/** Parsed flags for `swarm v8 init`. */
interface InitFlags {
  /** Target language for contract obligations. */
  language: string;
  /** Overwrite existing files. */
  force: boolean;
  /** Target directory. */
  cwd: string;
  /** Set when `--help`/`-h` was passed; handler short-circuits with exit 0. */
  helpRequested: boolean;
}

const INIT_SCHEMA: ParseArgsOptions = {
  language: { type: 'string' },
  force: { type: 'boolean' },
  cwd: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

function parseFlags(argv: string[]): InitFlags {
  const { values } = runParseArgs(argv, INIT_SCHEMA);
  const helpRequested = readBoolean(values, 'help');
  if (helpRequested) {
    process.stderr.write(
      [
        'usage: swarm init [flags]',
        '',
        'flags:',
        '  --language <lang>  obligation language: node (default) | python | go | rust',
        '  --force            overwrite existing contract.yaml / patches.jsonl',
        '  --cwd <path>       target directory (default: process.cwd())',
        '  --help, -h         show this message',
        '',
      ].join('\n'),
    );
  }
  const rawLang = readString(values, 'language');
  const language = rawLang !== undefined
    ? requireValidLanguage(rawLang)
    : 'node';
  const cwd = readString(values, 'cwd');
  return {
    language,
    force: readBoolean(values, 'force'),
    cwd: cwd !== undefined ? path.resolve(cwd) : process.cwd(),
    helpRequested,
  };
}

function requireValidLanguage(raw: string): string {
  if (!VALID_LANGUAGES.includes(raw)) {
    throw new Error(
      `invalid --language value "${raw}"; expected ${VALID_LANGUAGES.join(' | ')}`,
    );
  }
  return raw;
}

/** Top-level dispatcher for the `init` subcommand. */
export async function handleInit(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.helpRequested) return 0;

  const contractPath = path.join(flags.cwd, 'contract.yaml');
  const patchesPath = path.join(flags.cwd, 'patches.jsonl');

  const contractExists = fs.existsSync(contractPath);
  const patchesExists = fs.existsSync(patchesPath);

  if ((contractExists || patchesExists) && !flags.force) {
    const existing: string[] = [];
    if (contractExists) existing.push('contract.yaml');
    if (patchesExists) existing.push('patches.jsonl');
    logger.info(
      `skipping init; ${existing.join(', ')} already exist. Use --force to overwrite.`,
    );
    return 0;
  }

  const contractContent = CONTRACT_TEMPLATES[flags.language];
  if (contractContent === undefined) {
    // Should not happen after validation, but satisfies the type checker.
    logger.error(`unsupported language: ${flags.language}`);
    return 1;
  }

  // Ensure target directory exists.
  if (!fs.existsSync(flags.cwd)) {
    fs.mkdirSync(flags.cwd, { recursive: true });
  }

  fs.writeFileSync(contractPath, contractContent + '\n', 'utf8');
  fs.writeFileSync(patchesPath, PATCHES_CONTENT, 'utf8');

  logger.info(`created ${contractPath}`);
  logger.info(`created ${patchesPath}`);

  return 0;
}
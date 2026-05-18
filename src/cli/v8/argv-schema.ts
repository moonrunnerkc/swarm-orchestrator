import { parseArgs, type ParseArgsConfig } from 'node:util';

// Shared building block for v8 CLI handlers. Each handler defines its
// flag-schema records as a `ParseArgsOptionsConfig` (the `options:` value
// `parseArgs` takes) plus an after-parse `validate` step that turns the
// untyped `values` object into the handler's typed flags struct.
//
// The duplicated `requireValue(argv, i, '--flag')` helper that each
// handler previously hand-rolled is gone: parseArgs surfaces the same
// "Option '--foo' requires an argument" error natively. We catch that
// error and rethrow with the handler-style "flag --foo requires a value"
// message so existing test assertions on error shape continue to match.

export type ParseArgsOptions = NonNullable<ParseArgsConfig['options']>;

interface ParseArgvResult<T> {
  values: T;
  positionals: string[];
}

export function runParseArgs<T extends Record<string, unknown>>(
  argv: readonly string[],
  options: ParseArgsOptions,
): ParseArgvResult<T> {
  try {
    const { values, positionals } = parseArgs({
      args: collapseStringValues(argv, options),
      options,
      allowPositionals: true,
      strict: true,
    });
    return { values: values as T, positionals };
  } catch (err) {
    throw rewriteParseArgsError(err);
  }
}

// parseArgs refuses values that look like another option, so
// `--local-seed -1` triggers an ambiguous-argument error. The pre-3b
// hand-rolled parsers accepted `-1` as a value (their require-value
// check only excluded `--` prefixes) and surfaced range errors downstream
// as "must be a non-negative integer" / "must be a positive integer".
// To preserve that semantic, collapse every `--<key> <value>` pair into
// `--<key>=<value>` here for string-type options, where parseArgs accepts
// arbitrary value content. Boolean options are left alone.
function collapseStringValues(argv: readonly string[], options: ParseArgsOptions): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok.startsWith('--') && !tok.includes('=')) {
      const key = tok.slice(2);
      const schema = options[key];
      if (schema !== undefined && schema.type === 'string') {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out.push(`${tok}=${next}`);
          i += 1;
          continue;
        }
      }
    }
    out.push(tok);
  }
  return out;
}

// parseArgs throws codes the handler tests assert against in their old
// "flag --foo requires a value" / "unknown flag: --foo" shape. Rewrite
// here so each handler doesn't catch-and-retoss.
function rewriteParseArgsError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  const code = (err as NodeJS.ErrnoException).code ?? '';
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    // parseArgs error messages quote flags as `'--foo'` (just the name)
    // or `'--foo <value>'` when complaining about a missing argument.
    // Extract just the leading `--xxx` so the rethrown message stays
    // byte-identical to the pre-3b hand-rolled "flag --foo requires a
    // value" / "unknown flag: --foo" shapes.
    const m = err.message.match(/'(--[A-Za-z0-9][A-Za-z0-9-]*)/);
    const flag = m?.[1] ?? '';
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      return new Error(`unknown flag: ${flag}`);
    }
    if (/argument/i.test(err.message)) {
      return new Error(`flag ${flag} requires a value`);
    }
  }
  return err;
}

export function requirePositiveInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag} "${raw}"; must be a positive integer`);
  }
  return n;
}

export function requireNonNegativeInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid ${flag} "${raw}"; must be a non-negative integer`);
  }
  return n;
}

export function requirePositiveFloat(raw: string, flag: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag} "${raw}"; must be a positive number (USD)`);
  }
  return n;
}

export function requireFiniteFloat(raw: string, flag: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid ${flag} "${raw}"; must be a number`);
  }
  return n;
}

export function requireEnum<T extends string>(
  raw: string,
  flag: string,
  values: readonly T[],
): T {
  if (!values.includes(raw as T)) {
    throw new Error(
      `invalid ${flag} value "${raw}"; expected ${values.join(' | ')}`,
    );
  }
  return raw as T;
}

// parseArgs returns flag values as `string | boolean | (string|boolean)[]`.
// The handlers expect specific shapes per flag, so these readers narrow
// after parse. They throw the same "flag X requires a value" shape the
// pre-3b code emitted when the parser saw a missing value, so test
// assertions on error messages stay byte-identical.
export function readString(values: Record<string, unknown>, key: string): string | undefined {
  const v = values[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return undefined;
  return v;
}

export function readBoolean(values: Record<string, unknown>, key: string): boolean {
  return values[key] === true;
}

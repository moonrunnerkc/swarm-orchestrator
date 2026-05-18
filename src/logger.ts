type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
export type OutputFormat = 'text' | 'json';

interface LoggerConfig {
  level?: LogLevel;
  outputFormat?: OutputFormat;
  /** Route info/debug/trace to stderr instead of stdout (text mode). */
  diagnosticsToStderr?: boolean;
}

interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  child: (scope: string) => Logger;
}

const LEVEL_RANK: Record<Exclude<LogLevel, 'silent'>, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const state: Required<Pick<LoggerConfig, 'level' | 'outputFormat' | 'diagnosticsToStderr'>> & { prettyMode: boolean } = {
  level: 'info',
  outputFormat: 'text',
  diagnosticsToStderr: false,
  // Pretty mode: hide `[scope]` prefixes for a cleaner CLI UX.
  // Auto-enabled by user-facing commands. Scope still shown in JSON output.
  prettyMode: false,
};

function normalizeArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  if (state.level === 'silent') return false;
  return LEVEL_RANK[level] <= LEVEL_RANK[state.level];
}

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(line + '\n');
}

function emit(level: Exclude<LogLevel, 'silent'>, scope: string | undefined, args: unknown[]): void {
  if (!shouldLog(level)) return;

  const message = normalizeArgs(args);
  if (state.outputFormat === 'json') {
    writeLine(process.stderr, JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...(scope ? { scope } : {}),
      message,
    }));
    return;
  }

  const prefix = (!state.prettyMode && scope) ? `[${scope}] ` : '';
  // Diagnostic levels (info/debug/trace) go to stderr when explicitly routed there
  // so the presenter owns stdout cleanly. Error/warn always to stderr.
  const isDiagnostic = level === 'info' || level === 'debug' || level === 'trace';
  const stream = level === 'error' || level === 'warn'
    ? process.stderr
    : (state.diagnosticsToStderr && isDiagnostic ? process.stderr : process.stdout);
  writeLine(stream, `${prefix}${message}`);
}

function createLogger(scope?: string): Logger {
  return {
    error: (...args: unknown[]) => emit('error', scope, args),
    warn: (...args: unknown[]) => emit('warn', scope, args),
    info: (...args: unknown[]) => emit('info', scope, args),
    debug: (...args: unknown[]) => emit('debug', scope, args),
    trace: (...args: unknown[]) => emit('trace', scope, args),
    child: (childScope: string) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export function configureLogger(config: LoggerConfig): void {
  if (config.level) state.level = config.level;
  if (config.outputFormat) state.outputFormat = config.outputFormat;
  if (config.diagnosticsToStderr !== undefined) state.diagnosticsToStderr = config.diagnosticsToStderr;
}

/**
 * Hide `[scope]` prefixes for a cleaner user-facing CLI UX.
 * Auto-enabled by user-facing commands; structured JSON output is unaffected.
 */
export function setPrettyMode(pretty: boolean): void {
  state.prettyMode = pretty;
}

export function getLogger(scope?: string): Logger {
  return createLogger(scope);
}

export function getLoggerConfig(): Required<Pick<LoggerConfig, 'level' | 'outputFormat' | 'diagnosticsToStderr'>> & { prettyMode: boolean } {
  return { ...state };
}
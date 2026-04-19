export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type OutputFormat = 'text' | 'json';

export interface LoggerConfig {
  level?: LogLevel;
  outputFormat?: OutputFormat;
}

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (scope: string) => Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const state: Required<LoggerConfig> & { dashboardActive: boolean } = {
  level: 'info',
  outputFormat: 'text',
  dashboardActive: false,
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

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[state.level];
}

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(line + '\n');
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]): void {
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

  const prefix = scope ? `[${scope}] ` : '';
  // When the Ink dashboard owns stdout, route everything to stderr.
  const stream = (level === 'error' || level === 'warn' || state.dashboardActive)
    ? process.stderr
    : process.stdout;
  writeLine(stream, `${prefix}${message}`);
}

function createLogger(scope?: string): Logger {
  return {
    error: (...args: unknown[]) => emit('error', scope, args),
    warn: (...args: unknown[]) => emit('warn', scope, args),
    info: (...args: unknown[]) => emit('info', scope, args),
    debug: (...args: unknown[]) => emit('debug', scope, args),
    child: (childScope: string) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export function configureLogger(config: LoggerConfig): void {
  if (config.level) state.level = config.level;
  if (config.outputFormat) state.outputFormat = config.outputFormat;
}

/**
 * When true, the Ink TUI dashboard owns stdout.
 * All logger output is routed to stderr and Spinner becomes a no-op.
 */
export function setDashboardActive(active: boolean): void {
  state.dashboardActive = active;
}

export function isDashboardActive(): boolean {
  return state.dashboardActive;
}

export function getLogger(scope?: string): Logger {
  return createLogger(scope);
}

export function getLoggerConfig(): Required<LoggerConfig> {
  return { ...state };
}

export function isJsonOutput(): boolean {
  return state.outputFormat === 'json';
}

export function writeStructuredOutput(payload: unknown): void {
  const content = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload, null, 2);
  process.stdout.write(content + '\n');
}


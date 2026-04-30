/**
 * Presenter: owns the user-facing CLI surface (banners, summary blocks,
 * results, footers). Writes to stdout. Color and glyph aware. Quiet-respecting.
 *
 * The logger (`src/logger.ts`) is for diagnostics and goes to stderr (when
 * routed there); the presenter is for users and goes to stdout. These are
 * two different concerns. Today's code conflates them.
 *
 * Live progress (spinner, in-place step status) lives in `cli/live-status.ts`.
 * The presenter handles static surfaces; LiveStatus handles the moving parts.
 */

export type Glyph =
  | 'check'    // success
  | 'cross'    // failure
  | 'bang'     // warning
  | 'dot'      // bullet / sigil
  | 'sep';     // separator between fragments

export interface PresenterTheme {
  color: boolean;
  ascii: boolean;
}

const ESC = '\x1b[';

const UTF8_GLYPHS: Record<Glyph, string> = {
  check: '✓',
  cross: '✗',
  bang: '!',
  dot: '·',
  sep: '·',
};

const ASCII_GLYPHS: Record<Glyph, string> = {
  check: 'v',
  cross: 'x',
  bang: '!',
  dot: '.',
  sep: '.',
};

function detectAscii(): boolean {
  if (process.env.SWARM_ASCII === '1') return true;
  const lc = (process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '').toLowerCase();
  if (!lc) return false;
  return !lc.includes('utf');
}

function detectColor(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  return Boolean(stream.isTTY);
}

export interface PresenterOptions {
  /** When true, suppress all output except errors and the final headline. */
  quiet?: boolean;
  /** Override the output stream (tests). Defaults to process.stdout. */
  out?: NodeJS.WriteStream;
  /** Force-enable or force-disable ANSI color (tests). */
  color?: boolean;
  /** Force-enable or force-disable ASCII glyphs (tests). */
  ascii?: boolean;
}

export interface PlanSummary {
  steps: number;
  model: string;
  modelMultiplier: number;
  retryPct: number;
  costRange: string;
  remediationBuffer?: number;
  innerFleet?: boolean;
  target?: string | undefined;
}

export interface RunStarted {
  runDir: string;
  runId?: string | undefined;
}

export interface FailedStepSummary {
  stepNumber: number;
  agentName: string;
  reason: string;
}

export interface FinalSummary {
  ok: boolean;
  completed: number;
  total: number;
  duration?: string | undefined;
  premiumRequests: number;
  gatesPassed?: number;
  gatesFailed?: number;
  estimateExceededPct?: number;
  estimateLow?: number;
  estimateHigh?: number;
  remediationSteps?: number;
  plannedSteps?: number;
  artifactsDir: string;
  prUrls?: Map<number, string> | undefined;
  failedSteps?: FailedStepSummary[];
  inspectCommand?: string | undefined;
}

export class Presenter {
  private readonly out: NodeJS.WriteStream;
  private readonly theme: PresenterTheme;
  private readonly quiet: boolean;

  constructor(opts: PresenterOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.theme = {
      color: opts.color ?? detectColor(this.out),
      ascii: opts.ascii ?? detectAscii(),
    };
    this.quiet = opts.quiet ?? false;
  }

  /** Public for the live-status / debug paths that need to render a glyph. */
  glyph(g: Glyph): string {
    return this.theme.ascii ? ASCII_GLYPHS[g] : UTF8_GLYPHS[g];
  }

  dim(s: string): string {
    return this.theme.color ? `${ESC}2m${s}${ESC}22m` : s;
  }

  bold(s: string): string {
    return this.theme.color ? `${ESC}1m${s}${ESC}22m` : s;
  }

  green(s: string): string {
    return this.theme.color ? `${ESC}32m${s}${ESC}39m` : s;
  }

  red(s: string): string {
    return this.theme.color ? `${ESC}31m${s}${ESC}39m` : s;
  }

  yellow(s: string): string {
    return this.theme.color ? `${ESC}33m${s}${ESC}39m` : s;
  }

  cyan(s: string): string {
    return this.theme.color ? `${ESC}36m${s}${ESC}39m` : s;
  }

  /** Raw write of a line. The static surface emits through this. */
  print(line: string): void {
    if (this.quiet) return;
    this.out.write(line + '\n');
  }

  blank(): void {
    if (this.quiet) return;
    this.out.write('\n');
  }

  /** Goal echo at the start of a `run` invocation. */
  runHeader(goal: string): void {
    if (this.quiet) return;
    this.print(`swarm run`);
    this.print(`${this.dim(this.glyph('dot'))} ${goal}`);
    this.blank();
  }

  /** Goal echo at the start of a `swarm <plan>` invocation. */
  swarmHeader(goal: string): void {
    if (this.quiet) return;
    this.print(`swarm`);
    this.print(`${this.dim(this.glyph('dot'))} ${goal}`);
    this.blank();
  }

  planSummary(s: PlanSummary): void {
    if (this.quiet) return;
    const stepsLabel = `${s.steps} step${s.steps === 1 ? '' : 's'}`;
    const modelFrag = `${s.model} ${s.modelMultiplier}×`;
    const retryFrag = `${s.retryPct}% retry buffer`;
    this.print(`  ${this.dim('plan')}     ${stepsLabel} ${this.dim(this.glyph('sep'))} ${modelFrag} ${this.dim(this.glyph('sep'))} ${retryFrag}`);
    this.print(`  ${this.dim('cost')}     ${s.costRange} premium request${s.costRange === '1' ? '' : 's'}`);
    if (s.remediationBuffer && s.remediationBuffer > 0) {
      this.print(`           ${this.dim(`+${s.remediationBuffer} remediation buffer`)}`);
    }
    if (s.innerFleet) {
      this.print(`           ${this.dim('/fleet subagent multiplier applied')}`);
    }
    if (s.target) {
      this.print(`  ${this.dim('target')}   ${s.target}`);
    }
    this.blank();
  }

  runStarted(r: RunStarted): void {
    if (this.quiet) return;
    this.print(`  ${this.dim('run')}      ${r.runDir}`);
    this.blank();
  }

  /** Single-line status while final quality gates run. */
  gateRunningStart(): void {
    if (this.quiet) return;
    this.print(`  ${this.dim('running quality gates...')}`);
  }

  cancelled(): void {
    if (this.quiet) return;
    this.print(`  ${this.dim('cancelled')}`);
  }

  finalSummary(f: FinalSummary): void {
    const sep = this.dim(this.glyph('sep'));
    const headlineGlyph = f.ok ? this.green(this.glyph('check')) : this.red(this.glyph('cross'));
    const headlineWord = f.ok ? 'done' : `${f.failedSteps?.length ?? f.total - f.completed} failed`;

    const fragments: string[] = [`${f.completed}/${f.total} step${f.total === 1 ? '' : 's'}`];
    if (f.duration) fragments.push(f.duration);
    fragments.push(`${f.premiumRequests} premium request${f.premiumRequests === 1 ? '' : 's'}`);
    if (typeof f.gatesPassed === 'number' || typeof f.gatesFailed === 'number') {
      const passed = f.gatesPassed ?? 0;
      const failed = f.gatesFailed ?? 0;
      const gateNote = failed === 0
        ? `${passed} gate${passed === 1 ? '' : 's'} passed`
        : `${passed} gates passed ${this.dim(this.glyph('sep'))} ${failed} failed`;
      fragments.push(gateNote);
    }

    // Headline always prints, even in quiet mode (it's the result).
    this.out.write(`  ${headlineGlyph} ${this.bold(headlineWord)} ${sep} ${fragments.join(` ${sep} `)}\n`);

    if (this.quiet) return;

    if (f.failedSteps && f.failedSteps.length > 0) {
      this.blank();
      for (const fs of f.failedSteps) {
        this.print(`    ${this.red(this.glyph('cross'))} step-${fs.stepNumber} ${this.dim(fs.agentName)} ${sep} ${fs.reason}`);
      }
    }

    if (f.estimateExceededPct !== undefined && f.estimateExceededPct > 20) {
      this.print(`    ${this.dim(`exceeded estimate by ${f.estimateExceededPct}% (estimate ${f.estimateLow ?? '?'}–${f.estimateHigh ?? '?'})`)}`);
    }

    if (f.remediationSteps && f.remediationSteps > 0) {
      this.print(`    ${this.dim(`${f.plannedSteps} planned + ${f.remediationSteps} remediation`)}`);
    }

    this.print(`  ${this.dim('artifacts')} ${f.artifactsDir}`);

    if (f.prUrls && f.prUrls.size > 0) {
      for (const [stepNum, url] of f.prUrls) {
        this.print(`  ${this.dim(`pr step-${stepNum}`)} ${url}`);
      }
    }

    if (!f.ok && f.inspectCommand) {
      this.blank();
      this.print(`  ${this.dim(`inspect: ${f.inspectCommand}`)}`);
    }

    this.blank();
  }
}

let singleton: Presenter | undefined;

/**
 * Returns the process-wide presenter singleton. Created on first access with
 * default options (color/ascii detected from env, quiet=false). Tests should
 * use `_setPresenterForTest` to inject a controlled instance.
 */
export function getPresenter(): Presenter {
  if (!singleton) singleton = new Presenter();
  return singleton;
}

/** Reconfigure the singleton (e.g. after parsing --quiet from argv). */
export function configurePresenter(opts: PresenterOptions): void {
  singleton = new Presenter(opts);
}

/** Test hook. */
export function _setPresenterForTest(instance: Presenter | undefined): void {
  singleton = instance;
}

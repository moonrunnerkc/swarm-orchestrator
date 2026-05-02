/**
 * Live status block: a fixed-position region pinned to the bottom of stdout
 * that re-renders in place via ANSI cursor moves. Running steps each occupy
 * one line (spinner, label, elapsed, current action). Static output (agent
 * stream lines, completed-step summaries, banners) prints above the block;
 * the block redraws after each insertion so it stays at the bottom.
 *
 * Non-TTY fallback: append a single line on each state transition. Pipes,
 * CI logs, and NO_COLOR/CI envs degrade gracefully without ANSI escapes.
 */

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const RENDER_INTERVAL_MS = 100;

const ESC = '\x1b[';
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K`;
const CURSOR_UP_ONE = `${ESC}1A`;

interface LiveStep {
  id: string;
  label: string;
  startedAt: number;
  currentAction?: string;
}

export interface LiveStatusOptions {
  /** Override TTY detection (used by tests). */
  tty?: boolean;
  /** Override target stream (used by tests). Defaults to process.stdout. */
  out?: NodeJS.WriteStream;
  /** Disable color codes (used by tests / NO_COLOR). */
  color?: boolean;
}

export class LiveStatus {
  private readonly out: NodeJS.WriteStream;
  private readonly tty: boolean;
  private readonly color: boolean;
  private readonly steps = new Map<string, LiveStep>();
  private readonly order: string[] = [];
  private renderedLines = 0;
  private spinnerFrame = 0;
  private renderTimer?: NodeJS.Timeout | undefined;
  private active = false;
  private exitHandlerInstalled = false;

  constructor(opts: LiveStatusOptions = {}) {
    this.out = opts.out ?? process.stdout;
    const detectedTty = Boolean(this.out.isTTY) && !process.env.CI;
    this.tty = opts.tty ?? detectedTty;
    this.color = opts.color ?? (this.tty && !process.env.NO_COLOR);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    if (this.tty) {
      this.out.write(HIDE_CURSOR);
      this.renderTimer = setInterval(() => this.render(), RENDER_INTERVAL_MS);
      this.renderTimer.unref?.();
      // Best-effort cursor restore on abnormal exit so a SIGINT or thrown
      // error does not leave the terminal with the cursor hidden.
      if (!this.exitHandlerInstalled) {
        const restore = (): void => {
          if (this.tty) this.out.write(SHOW_CURSOR);
        };
        process.once('exit', restore);
        process.once('SIGINT', () => { restore(); process.exit(130); });
        this.exitHandlerInstalled = true;
      }
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = undefined;
    }
    if (this.tty) {
      this.clearLiveBlock();
      this.out.write(SHOW_CURSOR);
    }
  }

  addStep(id: string, label: string): void {
    if (!this.steps.has(id)) {
      this.order.push(id);
    }
    this.steps.set(id, { id, label, startedAt: Date.now() });
    if (!this.tty) {
      this.out.write(`  ${this.dim('›')} ${label} ${this.dim('started')}\n`);
    } else {
      // Self-start the render loop the first time a step appears so the
      // spinner animates and the elapsed-time field ticks. The interval is
      // unref'd in start(), so it does not pin the event loop on its own.
      if (!this.active) this.start();
      this.render();
    }
  }

  setAction(id: string, action: string): void {
    const step = this.steps.get(id);
    if (!step) return;
    step.currentAction = action;
  }

  finishStep(id: string, state: 'done' | 'failed', summary?: string): void {
    const step = this.steps.get(id);
    if (!step) return;
    const elapsed = elapsedSeconds(step.startedAt);
    const glyph = state === 'done' ? this.green('✓') : this.red('✗');
    const tail = summary ? ` ${this.dim('·')} ${summary}` : '';
    const line = `  ${glyph} ${step.label} ${this.dim(formatDuration(elapsed))}${tail}`;
    this.printAbove(line);
    this.steps.delete(id);
    const idx = this.order.indexOf(id);
    if (idx >= 0) this.order.splice(idx, 1);
    // Tear down the render loop and restore the cursor when the last step
    // finishes; the next addStep will start it again.
    if (this.tty && this.steps.size === 0 && this.active) {
      this.stop();
    }
  }

  /** Print a line as static output above the live block. */
  print(line: string): void {
    this.printAbove(line);
  }

  /** True when running in a real TTY where cursor moves work. */
  isTTY(): boolean {
    return this.tty;
  }

  private printAbove(line: string): void {
    if (!this.tty) {
      this.out.write(line + '\n');
      return;
    }
    this.clearLiveBlock();
    this.out.write(line + '\n');
    this.render();
  }

  private clearLiveBlock(): void {
    if (this.renderedLines === 0) return;
    let buf = '';
    for (let i = 0; i < this.renderedLines; i++) {
      buf += CURSOR_UP_ONE + CLEAR_LINE;
    }
    this.out.write(buf);
    this.renderedLines = 0;
  }

  private render(): void {
    if (!this.tty) return;
    this.clearLiveBlock();
    const frame = SPINNER[this.spinnerFrame % SPINNER.length];
    this.spinnerFrame++;
    const lines: string[] = [];
    for (const id of this.order) {
      const step = this.steps.get(id);
      if (!step) continue;
      const elapsed = elapsedSeconds(step.startedAt);
      const action = step.currentAction
        ? ` ${this.dim('·')} ${this.dim(truncate(step.currentAction, 56))}`
        : '';
      lines.push(
        `  ${this.cyan(frame)} ${step.label} ${this.dim(formatDuration(elapsed))}${action}`,
      );
    }
    if (lines.length === 0) return;
    this.out.write(lines.join('\n') + '\n');
    this.renderedLines = lines.length;
  }

  private cyan(s: string): string {
    return this.color ? `${ESC}36m${s}${ESC}39m` : s;
  }

  private green(s: string): string {
    return this.color ? `${ESC}32m${s}${ESC}39m` : s;
  }

  private red(s: string): string {
    return this.color ? `${ESC}31m${s}${ESC}39m` : s;
  }

  private dim(s: string): string {
    return this.color ? `${ESC}2m${s}${ESC}22m` : s;
  }
}

function elapsedSeconds(startedAt: number): number {
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

let singleton: LiveStatus | undefined;

/**
 * Returns the process-wide LiveStatus instance, creating one on first call.
 * The instance is inert until start() is invoked, so importing this getter
 * from code paths that never run a swarm has no side effect.
 */
export function getLiveStatus(): LiveStatus {
  if (!singleton) singleton = new LiveStatus();
  return singleton;
}

/** Test hook: replace the singleton with an instance configured for capture. */
export function _setLiveStatusForTest(instance: LiveStatus | undefined): void {
  singleton = instance;
}

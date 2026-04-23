// Author: Bradley R. Kinnard
// Terminal spinner for visual feedback during long operations

import { getLogger, isDashboardActive } from './logger';
const logger = getLogger('spinner');

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOTS_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const BOUNCE_FRAMES = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];
const PULSE_FRAMES = ['🐝', '🐝 ', '🐝  ', '🐝   ', '🐝  ', '🐝 ', '🐝'];

export type SpinnerStyle = 'dots' | 'spinner' | 'bounce' | 'pulse';

export interface SpinnerOptions {
  style?: SpinnerStyle;
  prefix?: string;
  color?: string;
}

const FRAME_SETS: Record<SpinnerStyle, string[]> = {
  dots: DOTS_FRAMES,
  spinner: SPINNER_FRAMES,
  bounce: BOUNCE_FRAMES,
  pulse: PULSE_FRAMES
};

export class Spinner {
  private frames: string[];
  private frameIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private message: string;
  private prefix: string;
  private isRunning = false;

  constructor(message: string, options: SpinnerOptions = {}) {
    this.frames = FRAME_SETS[options.style || 'dots'];
    this.message = message;
    this.prefix = options.prefix || '';
  }

  start(): void {
    if (this.isRunning) return;
    // Ink TUI owns stdout when the dashboard is active; skip raw writes.
    if (isDashboardActive()) return;
    // When stdout is not a TTY (piped to a file, CI log, etc.) cursor-control
    // escapes show up as literal bytes and corrupt the captured output.
    if (!process.stdout.isTTY) return;
    this.isRunning = true;
    this.frameIndex = 0;

    // hide cursor
    process.stdout.write('\x1B[?25l');

    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      process.stdout.write(`\r${this.prefix}${frame} ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (!this.isRunning) {
      // Even when start() was skipped (dashboard mode), emit the final message via logger.
      if (finalMessage) {
        logger.info(`${this.prefix}${finalMessage}`);
      }
      return;
    }
    this.isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // clear line and show cursor
    process.stdout.write('\r\x1B[K');
    process.stdout.write('\x1B[?25h');

    if (finalMessage) {
      logger.info(`${this.prefix}${finalMessage}`);
    }
  }

  succeed(message?: string): void {
    this.stop(`✅ ${message || this.message}`);
  }

  fail(message?: string): void {
    this.stop(`❌ ${message || this.message}`);
  }

  warn(message?: string): void {
    this.stop(`⚠️  ${message || this.message}`);
  }

  info(message?: string): void {
    this.stop(`ℹ️  ${message || this.message}`);
  }
}

/**
 * Multi-step progress tracker with visual feedback
 */
export class ProgressTracker {
  private activeSpinners: Map<string, Spinner> = new Map();
  private stepStatus: Map<string, 'running' | 'done' | 'failed'> = new Map();

  startStep(stepId: string, message: string, prefix = '  '): void {
    const spinner = new Spinner(message, { style: 'dots', prefix });
    this.activeSpinners.set(stepId, spinner);
    this.stepStatus.set(stepId, 'running');
    spinner.start();
  }

  updateStep(stepId: string, message: string): void {
    const spinner = this.activeSpinners.get(stepId);
    if (spinner) {
      spinner.update(message);
    }
  }

  completeStep(stepId: string, message: string): void {
    const spinner = this.activeSpinners.get(stepId);
    if (spinner) {
      spinner.succeed(message);
      this.activeSpinners.delete(stepId);
      this.stepStatus.set(stepId, 'done');
    }
  }

  failStep(stepId: string, message: string): void {
    const existing = this.activeSpinners.get(stepId);
    if (existing) {
      existing.fail(message);
      this.activeSpinners.delete(stepId);
    } else {
      const spinner = new Spinner(message, { style: 'dots', prefix: '  ' });
      spinner.fail(message);
    }
    this.stepStatus.set(stepId, 'failed');
  }

  warnStep(stepId: string, message: string): void {
    const spinner = this.activeSpinners.get(stepId);
    if (spinner) {
      spinner.warn(message);
      this.activeSpinners.delete(stepId);
    }
  }

  stopAll(): void {
    for (const spinner of this.activeSpinners.values()) {
      spinner.stop();
    }
    this.activeSpinners.clear();
  }

  getRunningCount(): number {
    return this.activeSpinners.size;
  }
}

export default Spinner;

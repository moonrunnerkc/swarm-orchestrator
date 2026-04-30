import * as assert from 'assert';
import { Writable } from 'stream';
import { Presenter } from '../src/presenter';

/**
 * The presenter owns the user-facing CLI surface. These tests pin the
 * exact bytes for each state defined in docs/output-spec.md so that
 * surface drift is caught at PR time rather than via human review.
 *
 * Output is captured by passing a writable stream and reading the
 * accumulated bytes. Color is disabled so the goldens stay readable;
 * a separate test exercises the color path.
 */

interface Capture {
  stream: NodeJS.WriteStream;
  getOutput(): string;
}

function makeCapture(): Capture {
  const chunks: Buffer[] = [];
  const inner = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  // The presenter only touches `.write(...)` on the stream and never the
  // tty-shaped extras (clearLine, cursorTo, etc.), so a structural cast is
  // safe. The cast is wrapped in `unknown` to silence the structural check.
  const stream = Object.assign(inner, { isTTY: false, columns: 80, rows: 24 }) as unknown as NodeJS.WriteStream;
  return {
    stream,
    getOutput: (): string => Buffer.concat(chunks).toString('utf8'),
  };
}

function makePresenter(opts: { quiet?: boolean; color?: boolean; ascii?: boolean } = {}): { p: Presenter; out: Capture } {
  const out = makeCapture();
  const p = new Presenter({
    out: out.stream,
    color: opts.color ?? false,
    ascii: opts.ascii ?? false,
    ...(opts.quiet !== undefined ? { quiet: opts.quiet } : {}),
  });
  return { p, out };
}

describe('Presenter', () => {
  describe('runHeader', () => {
    it('renders the swarm-run goal echo with no scope prefix', () => {
      const { p, out } = makePresenter();
      p.runHeader('Add a function called greet');
      assert.strictEqual(
        out.getOutput(),
        'swarm run\n· Add a function called greet\n\n',
      );
    });
  });

  describe('swarmHeader', () => {
    it('renders the swarm-execute goal echo', () => {
      const { p, out } = makePresenter();
      p.swarmHeader('Add JWT auth');
      assert.strictEqual(out.getOutput(), 'swarm\n· Add JWT auth\n\n');
    });
  });

  describe('planSummary', () => {
    it('renders the canonical plan/cost block', () => {
      const { p, out } = makePresenter();
      p.planSummary({
        steps: 1,
        model: 'claude-sonnet-4',
        modelMultiplier: 1,
        retryPct: 15,
        costRange: '1–3',
        remediationBuffer: 1,
      });
      assert.strictEqual(
        out.getOutput(),
        '  plan     1 step · claude-sonnet-4 1× · 15% retry buffer\n  cost     1–3 premium requests\n           +1 remediation buffer\n\n',
      );
    });

    it('includes target line when target is provided', () => {
      const { p, out } = makePresenter();
      p.planSummary({
        steps: 2,
        model: 'claude-opus-4.5',
        modelMultiplier: 5,
        retryPct: 20,
        costRange: '4–10',
        target: '/tmp/repo',
      });
      const got = out.getOutput();
      assert.match(got, /target {3}\/tmp\/repo/);
      assert.match(got, /2 steps · claude-opus-4\.5 5×/);
    });

    it('annotates the inner-fleet multiplier when applied', () => {
      const { p, out } = makePresenter();
      p.planSummary({
        steps: 1,
        model: 'm',
        modelMultiplier: 1,
        retryPct: 15,
        costRange: '1',
        innerFleet: true,
      });
      assert.match(out.getOutput(), /\/fleet subagent multiplier applied/);
    });
  });

  describe('finalSummary', () => {
    it('renders the success headline plus artifacts line', () => {
      const { p, out } = makePresenter();
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '59s',
        premiumRequests: 1,
        gatesPassed: 8,
        gatesFailed: 0,
        artifactsDir: '/tmp/repo/runs/abc',
      });
      const got = out.getOutput();
      assert.match(got, /✓ done · 1\/1 step · 59s · 1 premium request · 8 gates passed/);
      assert.match(got, /artifacts \/tmp\/repo\/runs\/abc/);
    });

    it('renders failure headline and per-step failure lines', () => {
      const { p, out } = makePresenter();
      p.finalSummary({
        ok: false,
        completed: 0,
        total: 2,
        duration: '41s',
        premiumRequests: 0,
        artifactsDir: '/tmp/repo/runs/xyz',
        failedSteps: [
          { stepNumber: 1, agentName: 'worker', reason: 'verification failed: tests not run' },
          { stepNumber: 2, agentName: 'reviewer', reason: 'timeout' },
        ],
        inspectCommand: 'swarm report xyz',
      });
      const got = out.getOutput();
      assert.match(got, /✗ 2 failed · 0\/2 steps/);
      assert.match(got, /✗ step-1 worker · verification failed: tests not run/);
      assert.match(got, /✗ step-2 reviewer · timeout/);
      assert.match(got, /inspect: swarm report xyz/);
    });

    it('quiet mode prints only the headline', () => {
      const { p, out } = makePresenter({ quiet: true });
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '10s',
        premiumRequests: 1,
        artifactsDir: '/tmp/x',
      });
      const got = out.getOutput();
      assert.match(got, /✓ done · 1\/1 step · 10s · 1 premium request/);
      // No artifacts line in quiet mode.
      assert.doesNotMatch(got, /artifacts/);
    });

    it('lists PR URLs when present', () => {
      const { p, out } = makePresenter();
      const prUrls = new Map<number, string>([[1, 'https://github.com/a/b/pull/9']]);
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '5s',
        premiumRequests: 1,
        artifactsDir: '/tmp/x',
        prUrls,
      });
      assert.match(out.getOutput(), /pr step-1 https:\/\/github\.com\/a\/b\/pull\/9/);
    });
  });

  describe('quiet mode', () => {
    it('suppresses runHeader, planSummary, and runStarted', () => {
      const { p, out } = makePresenter({ quiet: true });
      p.runHeader('goal');
      p.planSummary({ steps: 1, model: 'm', modelMultiplier: 1, retryPct: 15, costRange: '1' });
      p.runStarted({ runDir: '/tmp/run' });
      assert.strictEqual(out.getOutput(), '');
    });

    it('still emits the final headline (the result is not optional)', () => {
      const { p, out } = makePresenter({ quiet: true });
      p.finalSummary({
        ok: false,
        completed: 0,
        total: 1,
        premiumRequests: 0,
        artifactsDir: '/tmp/x',
      });
      assert.match(out.getOutput(), /✗ 1 failed/);
    });
  });

  describe('glyph fallback', () => {
    it('uses ASCII glyphs when ascii=true', () => {
      const { p, out } = makePresenter({ ascii: true });
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '1s',
        premiumRequests: 1,
        artifactsDir: '/tmp/x',
      });
      const got = out.getOutput();
      assert.match(got, /v done . 1\/1 step . 1s . 1 premium request/);
      assert.doesNotMatch(got, /✓/);
      assert.doesNotMatch(got, /·/);
    });

    it('emits utf8 glyphs by default', () => {
      const { p, out } = makePresenter();
      p.finalSummary({
        ok: false,
        completed: 0,
        total: 1,
        premiumRequests: 0,
        artifactsDir: '/tmp/x',
      });
      assert.match(out.getOutput(), /✗/);
    });
  });

  describe('color', () => {
    it('emits ANSI escapes when color=true', () => {
      const { p, out } = makePresenter({ color: true });
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '1s',
        premiumRequests: 1,
        artifactsDir: '/tmp/x',
      });
      assert.match(out.getOutput(), /\x1b\[32m/);
      assert.match(out.getOutput(), /\x1b\[1m/);
    });

    it('emits no ANSI when color=false', () => {
      const { p, out } = makePresenter({ color: false });
      p.finalSummary({
        ok: true,
        completed: 1,
        total: 1,
        duration: '1s',
        premiumRequests: 1,
        artifactsDir: '/tmp/x',
      });
      assert.doesNotMatch(out.getOutput(), /\x1b\[/);
    });
  });

  describe('cancelled', () => {
    it('prints a single dim cancelled line', () => {
      const { p, out } = makePresenter();
      p.cancelled();
      assert.strictEqual(out.getOutput(), '  cancelled\n');
    });

    it('is suppressed in quiet mode', () => {
      const { p, out } = makePresenter({ quiet: true });
      p.cancelled();
      assert.strictEqual(out.getOutput(), '');
    });
  });
});

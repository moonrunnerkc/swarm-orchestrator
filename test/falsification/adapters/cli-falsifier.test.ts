import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CliFalsifier,
  type AdapterProfile,
  type CliFalsifierOptions,
  type CliInvocationRequest,
  type CliInvocationResult,
  type FalsifierStrategy,
  type ParsedCandidate,
} from '../../../src/falsification/adapters/cli-falsifier';
import type { CounterExampleInput, FalsificationInput, FalsifyOutcome } from '../../../src/falsification/adapters/types';

// Drives `CliFalsifier` against a synthetic `AdapterProfile` so the
// pipeline (strategy dispatch, parser invocation, baseline gating,
// cost emission, error propagation) is exercised independently of
// any real CLI.

interface StrategySpy {
  buildPromptCalls: number;
  parseCandidatesCalls: number;
  runCandidateCalls: number;
  checkBaselineCalls: number;
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-falsifier-'));
}

function makeCounterExample(candidate: ParsedCandidate): CounterExampleInput {
  return {
    files: candidate.files.map((f) => ({ relPath: f.relPath, bytes: f.bytes })),
    reproducer: 'synthetic-reproducer',
    reproducerOutput: 'synthetic-output',
    reproducerExitCode: 1,
  };
}

interface SyntheticOptions {
  readonly baselineOk?: boolean;
  readonly parsedCandidates?: readonly ParsedCandidate[];
  readonly runCandidate?: (
    candidate: ParsedCandidate,
  ) => { falsified: boolean; counterExample: CounterExampleInput | null };
}

function makeStrategy(spy: StrategySpy, options: SyntheticOptions = {}): FalsifierStrategy {
  const parsed =
    options.parsedCandidates ?? [
      { name: 'synthetic', rationale: 'synthetic candidate', files: [{ relPath: 'synthetic.txt', bytes: 'hi' }] },
    ];
  return {
    buildPrompt: () => {
      spy.buildPromptCalls += 1;
      return 'synthetic prompt';
    },
    checkBaseline: () => {
      spy.checkBaselineCalls += 1;
      return { ok: options.baselineOk ?? true, detail: 'synthetic baseline detail' };
    },
    parseCandidates: () => {
      spy.parseCandidatesCalls += 1;
      return parsed;
    },
    runCandidate: (candidate) => {
      spy.runCandidateCalls += 1;
      const runner = options.runCandidate;
      if (runner !== undefined) return runner(candidate);
      return { falsified: true, counterExample: makeCounterExample(candidate) };
    },
  };
}

function makeProfile(strategy: FalsifierStrategy, overrides: Partial<AdapterProfile> = {}): AdapterProfile {
  return {
    name: 'synthetic',
    errorLabel: 'synthetic',
    defaultBinary: 'synth-bin',
    defaultModel: null,
    handles: ['property-must-hold'],
    strategies: { 'property-must-hold': strategy },
    promptTemplatePath: {},
    promptDelivery: { kind: 'positional' },
    maxOutputBytes: 65_536,
    notApplicableDetail: 'synthetic adapter only handles property-must-hold',
    transientRetry: null,
    loggerScope: 'synthetic',
    buildArgs: () => ['--synthetic'],
    detectAuthMethod: () => 'api',
    computeCost: () => ({ dollarsBilled: 0.04, dollarsTokenEstimate: 0.04, dollarsApiEquivalent: 0.04 }),
    binaryMissingHint: 'install the synthetic CLI',
    ...overrides,
  };
}

function propertyInput(workspaceRoot: string): FalsificationInput {
  return {
    patchSha: '0'.repeat(40),
    obligation: { type: 'property-must-hold', predicate: 'true', target: 'synthetic target' },
    contextRefs: [],
    timeBudgetMs: 5_000,
    workspaceRoot,
  };
}

function fakeInvocation(
  stdout = '',
  stderr = '',
  exitCode = 0,
): (req: CliInvocationRequest) => Promise<CliInvocationResult> {
  return async () => ({ stdout, stderr, exitCode, wallClockMs: 1 });
}

function newSpy(): StrategySpy {
  return { buildPromptCalls: 0, parseCandidatesCalls: 0, runCandidateCalls: 0, checkBaselineCalls: 0 };
}

describe('CliFalsifier — profile-driven pipeline', () => {
  describe('strategy dispatch', () => {
    it('returns strategy-not-applicable when the profile has no strategy for the obligation type', async () => {
      const spy = newSpy();
      const profile = makeProfile(makeStrategy(spy));
      const adapter = new CliFalsifier(profile, { invocationOverride: fakeInvocation() });
      const ws = makeWorkspace();
      try {
        const outcome = await adapter.falsify({
          patchSha: '0'.repeat(40),
          obligation: { type: 'test-must-pass', command: 'echo' },
          contextRefs: [],
          timeBudgetMs: 1_000,
          workspaceRoot: ws,
        });
        assert.equal(outcome.result.kind, 'no-falsification-found');
        if (outcome.result.kind === 'no-falsification-found') {
          assert.equal(outcome.result.reason, 'strategy-not-applicable');
          assert.equal(outcome.result.detail, 'synthetic adapter only handles property-must-hold');
        }
        assert.equal(spy.checkBaselineCalls, 0, 'baseline must not be probed when no strategy matches');
        assert.equal(spy.buildPromptCalls, 0);
        assert.equal(spy.parseCandidatesCalls, 0);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

    it('routes to the correct strategy by obligation type and calls it exactly once', async () => {
      const spy = newSpy();
      const strategy = makeStrategy(spy, { parsedCandidates: [] });
      const adapter = new CliFalsifier(makeProfile(strategy), {
        invocationOverride: fakeInvocation('synthetic body'),
      });
      const ws = makeWorkspace();
      try {
        const outcome = await adapter.falsify(propertyInput(ws));
        assert.equal(spy.buildPromptCalls, 1);
        assert.equal(spy.parseCandidatesCalls, 1);
        assert.equal(outcome.result.kind, 'no-falsification-found');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  describe('output parser invocation', () => {
    it('parses the captured stdout through strategy.parseCandidates', async () => {
      let observedStdout: string | null = null;
      const parsed: ParsedCandidate[] = [
        { name: 'c0', rationale: 'first', files: [{ relPath: 'c0.txt', bytes: 'a' }] },
      ];
      const strategy: FalsifierStrategy = {
        buildPrompt: () => 'p',
        checkBaseline: () => ({ ok: true, detail: '' }),
        parseCandidates: (stdout) => {
          observedStdout = stdout;
          return parsed;
        },
        runCandidate: (c) => ({ falsified: true, counterExample: makeCounterExample(c) }),
      };
      const adapter = new CliFalsifier(makeProfile(strategy), {
        invocationOverride: fakeInvocation('captured-stdout-marker'),
      });
      const ws = makeWorkspace();
      try {
        const outcome = await adapter.falsify(propertyInput(ws));
        assert.equal(observedStdout, 'captured-stdout-marker');
        assert.equal(outcome.result.kind, 'counter-example-input');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

    it('propagates parser errors out of falsify()', async () => {
      const strategy: FalsifierStrategy = {
        buildPrompt: () => 'p',
        checkBaseline: () => ({ ok: true, detail: '' }),
        parseCandidates: () => {
          throw new Error('parser blew up');
        },
        runCandidate: () => ({ falsified: false, counterExample: null }),
      };
      const adapter = new CliFalsifier(makeProfile(strategy), { invocationOverride: fakeInvocation('x') });
      const ws = makeWorkspace();
      try {
        await assert.rejects(adapter.falsify(propertyInput(ws)), /parser blew up/);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  describe('cost record emission', () => {
    it('builds the cost record from profile.computeCost and the classification', async () => {
      const candidates: ParsedCandidate[] = [
        { name: 'good', rationale: 'falsifies', files: [{ relPath: 'good.txt', bytes: 'g' }] },
        { name: 'bad', rationale: 'does not', files: [{ relPath: 'bad.txt', bytes: 'b' }] },
      ];
      const spy = newSpy();
      const strategy = makeStrategy(spy, {
        parsedCandidates: candidates,
        runCandidate: (c) =>
          c.name === 'good'
            ? { falsified: true, counterExample: makeCounterExample(c) }
            : { falsified: false, counterExample: null },
      });
      const adapter = new CliFalsifier(
        makeProfile(strategy, {
          computeCost: () => ({ dollarsBilled: 0.5, dollarsTokenEstimate: 0.75, dollarsApiEquivalent: 1.25 }),
        }),
        { invocationOverride: fakeInvocation() },
      );
      const ws = makeWorkspace();
      try {
        const outcome: FalsifyOutcome = await adapter.falsify(propertyInput(ws));
        assert.equal(outcome.cost.adapterName, 'synthetic');
        assert.equal(outcome.cost.dollarsBilled, 0.5);
        assert.equal(outcome.cost.dollarsTokenEstimate, 0.75);
        assert.equal(outcome.cost.dollarsApiEquivalent, 1.25);
        assert.equal(outcome.cost.dollarsSpent, 0.75);
        assert.equal(outcome.cost.counterExamplesFound, 1);
        assert.equal(outcome.cost.falsePositives, 1);
        assert.equal(outcome.cost.authMethod, 'api');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

    it('zero-fills the cost record on baseline-predicate-failed without calling profile.computeCost', async () => {
      let computeCostCalls = 0;
      const spy = newSpy();
      const adapter = new CliFalsifier(
        makeProfile(makeStrategy(spy, { baselineOk: false }), {
          computeCost: () => {
            computeCostCalls += 1;
            return { dollarsBilled: 9, dollarsTokenEstimate: 9, dollarsApiEquivalent: 9 };
          },
        }),
        { invocationOverride: fakeInvocation() },
      );
      const ws = makeWorkspace();
      try {
        const outcome = await adapter.falsify(propertyInput(ws));
        assert.equal(outcome.result.kind, 'no-falsification-found');
        if (outcome.result.kind === 'no-falsification-found') {
          assert.equal(outcome.result.reason, 'baseline-predicate-failed');
          assert.equal(outcome.result.detail, 'synthetic baseline detail');
        }
        assert.equal(outcome.cost.dollarsBilled, 0);
        assert.equal(outcome.cost.dollarsTokenEstimate, 0);
        assert.equal(outcome.cost.dollarsApiEquivalent, 0);
        assert.equal(computeCostCalls, 0);
        assert.equal(spy.buildPromptCalls, 0);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  describe('supported-obligation filtering', () => {
    it('exposes the profile.handles list as the adapter.handles surface', () => {
      const spy = newSpy();
      const adapter = new CliFalsifier(
        makeProfile(makeStrategy(spy), { handles: ['property-must-hold', 'file-must-exist'] }),
      );
      assert.deepEqual([...adapter.handles], ['property-must-hold', 'file-must-exist']);
    });

    it('returns strategy-not-applicable without spawning the CLI for unhandled obligation types', async () => {
      let invocationCalls = 0;
      const adapter = new CliFalsifier(makeProfile(makeStrategy(newSpy())), {
        invocationOverride: async () => {
          invocationCalls += 1;
          return { stdout: '', stderr: '', exitCode: 0, wallClockMs: 0 };
        },
      });
      const ws = makeWorkspace();
      try {
        const outcome = await adapter.falsify({
          patchSha: '0'.repeat(40),
          obligation: { type: 'file-must-exist', path: 'README.md' },
          contextRefs: [],
          timeBudgetMs: 1_000,
          workspaceRoot: ws,
        });
        assert.equal(outcome.result.kind, 'no-falsification-found');
        assert.equal(invocationCalls, 0);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  describe('error propagation', () => {
    it('throws with exitCode and stderr attached when the CLI exits non-zero', async () => {
      const adapter = new CliFalsifier(makeProfile(makeStrategy(newSpy()), { errorLabel: 'synth' }), {
        invocationOverride: fakeInvocation('partial stdout', 'detailed stderr', 9),
      });
      const ws = makeWorkspace();
      try {
        await adapter.falsify(propertyInput(ws));
        assert.fail('expected falsify() to throw');
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.match(err.message, /synth exec failed with exit code 9/);
        const cause = (err as Error & { cause?: unknown }).cause as
          | { exitCode: number; stderr: string; stdout: string }
          | undefined;
        assert.ok(cause !== undefined);
        assert.equal(cause!.exitCode, 9);
        assert.equal(cause!.stderr, 'detailed stderr');
        assert.equal(cause!.stdout, 'partial stdout');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

    it('propagates strategy.runCandidate errors out of falsify()', async () => {
      const strategy: FalsifierStrategy = {
        buildPrompt: () => 'p',
        checkBaseline: () => ({ ok: true, detail: '' }),
        parseCandidates: () => [{ name: 'c', rationale: 'x', files: [{ relPath: 'a.txt', bytes: 'a' }] }],
        runCandidate: () => {
          throw new Error('runner blew up');
        },
      };
      const adapter = new CliFalsifier(makeProfile(strategy), { invocationOverride: fakeInvocation() });
      const ws = makeWorkspace();
      try {
        await assert.rejects(adapter.falsify(propertyInput(ws)), /runner blew up/);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});

// Silence unused-import warnings for CliFalsifierOptions — re-exported
// for downstream test fixtures that want the type without re-importing.
type _OptionsAlias = CliFalsifierOptions;

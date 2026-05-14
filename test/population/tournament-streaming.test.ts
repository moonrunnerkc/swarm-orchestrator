import { strict as assert } from 'assert';
import { StubSession } from '../../src/session/stub-session';
import {
  ARCHITECT_PERSONA,
  IMPLEMENTER_PERSONA,
} from '../../src/persona';
import {
  runTournament,
  type TournamentLedgerSink,
  type TournamentStreamingSink,
} from '../../src/population/tournament';
import { forbiddenImportsAssertion } from '../../src/verification/streaming-verifier';
import { LiveCostTracker } from '../../src/verification/live-cost-tracker';
import type { ObligationV1 } from '../../src/contract/types';
import type { SessionRequest } from '../../src/session/types';

class SilentSink implements TournamentLedgerSink {
  recordRoundStarted(): void {}
  recordCandidate(): void {}
  recordWinner(): void {}
  recordDiscard(): void {}
  recordEscalation(): void {}
}

class CapturingStreamSink implements TournamentStreamingSink {
  aborts: Array<{
    candidateIndex: number;
    personaId: string;
    reason: string;
    abortedAtChars: number;
  }> = [];
  recordStreamAborted(p: {
    candidateIndex: number;
    personaId: string;
    reason: string;
    abortedAtChars: number;
  }): void {
    this.aborts.push({
      candidateIndex: p.candidateIndex,
      personaId: p.personaId,
      reason: p.reason,
      abortedAtChars: p.abortedAtChars,
    });
  }
}

function buildSession(perPersona: Record<string, string>, scoreFor: (text: string) => number): StubSession {
  return new StubSession({
    projectContext: 'CTX',
    streamChunkSize: 8,
    responder: (req: SessionRequest) => {
      if (req.personaId === 'tournament-verifier') {
        const m = req.userMessage.match(/<<<CANDIDATE\n([\s\S]*?)\nCANDIDATE>>>/);
        const candidate = m?.[1] ?? '';
        return JSON.stringify({ score: scoreFor(candidate), rationale: 'ok' });
      }
      return perPersona[req.personaId] ?? 'no-op';
    },
  });
}

const fileObligation: ObligationV1 = { type: 'file-must-exist', path: 'out.txt' };

describe('population/tournament — streaming verification', () => {
  it('aborts only the offending candidate; survivors continue and one wins', async () => {
    // architect's stream contains a forbidden import; implementer's does not.
    const session = buildSession(
      {
        architect: 'import forbidden_pkg\nrest of body',
        implementer: 'clean body that scores well',
      },
      (text) => (text.includes('clean body') ? 0.9 : 0),
    );
    const sink = new CapturingStreamSink();
    const result = await runTournament({
      obligation: fileObligation,
      obligationIndex: 0,
      session,
      personas: { primary: [ARCHITECT_PERSONA, IMPLEMENTER_PERSONA] },
      config: {
        candidatesPerRound: 2,
        roundCap: 1,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2],
      },
      renderUserMessage: () => 'msg',
      applyCandidate: async () => ({ satisfied: true, detail: 'applied' }),
      ledgerSink: new SilentSink(),
      streamingAssertions: [forbiddenImportsAssertion(['forbidden_pkg'])],
      streamingSink: sink,
    });
    assert.equal(result.streamingAbortedCandidates, 1);
    assert.equal(sink.aborts.length, 1);
    assert.equal(sink.aborts[0]?.personaId, 'architect');
    assert.match(sink.aborts[0]?.reason ?? '', /forbidden_pkg/);
    assert.equal(result.satisfied, true);
    assert.equal(result.winner?.personaId, 'implementer');
  });

  it('aborted candidate cannot win even when its hash matches a memo entry', async () => {
    // Both candidates emit identical aborting text. Without protection
    // the second's verdict could be inherited from the first via memo.
    const session = buildSession(
      {
        architect: 'import forbidden_pkg\nXXX',
        implementer: 'import forbidden_pkg\nXXX',
      },
      () => 0.99,
    );
    const sink = new CapturingStreamSink();
    const result = await runTournament({
      obligation: fileObligation,
      obligationIndex: 0,
      session,
      personas: { primary: [ARCHITECT_PERSONA, IMPLEMENTER_PERSONA] },
      config: {
        candidatesPerRound: 2,
        roundCap: 1,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2],
      },
      renderUserMessage: () => 'msg',
      applyCandidate: async () => ({ satisfied: true, detail: 'applied' }),
      ledgerSink: new SilentSink(),
      streamingAssertions: [forbiddenImportsAssertion(['forbidden_pkg'])],
      streamingSink: sink,
    });
    assert.equal(sink.aborts.length, 2);
    assert.equal(result.satisfied, false);
    assert.equal(result.winner, null);
  });

  it('shared cost tracker aborts streams once projected spend crosses cap', async () => {
    const session = buildSession(
      {
        architect: 'a'.repeat(5000),
        implementer: 'b'.repeat(5000),
      },
      () => 0.9,
    );
    const sink = new CapturingStreamSink();
    const tracker = new LiveCostTracker({ budgetTokens: 50 });
    const result = await runTournament({
      obligation: fileObligation,
      obligationIndex: 0,
      session,
      personas: { primary: [ARCHITECT_PERSONA, IMPLEMENTER_PERSONA] },
      config: {
        candidatesPerRound: 2,
        roundCap: 1,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2],
      },
      renderUserMessage: () => 'msg',
      applyCandidate: async () => ({ satisfied: true, detail: 'applied' }),
      ledgerSink: new SilentSink(),
      streamingAssertions: [forbiddenImportsAssertion([])],
      costTracker: tracker,
      streamingSink: sink,
    });
    assert.ok(sink.aborts.length >= 1);
    for (const a of sink.aborts) assert.match(a.reason, /cost-cap/);
    // No winner because all candidates aborted.
    assert.equal(result.satisfied, false);
  });

  it('replay determinism: same inputs produce identical decisions', async () => {
    const make = () =>
      buildSession(
        {
          architect: 'import forbidden_pkg\nabc',
          implementer: 'good clean body',
        },
        (t) => (t.includes('good clean') ? 0.95 : 0),
      );
    const opts = (s: ReturnType<typeof make>, sink: CapturingStreamSink) => ({
      obligation: fileObligation,
      obligationIndex: 0,
      session: s,
      personas: { primary: [ARCHITECT_PERSONA, IMPLEMENTER_PERSONA] },
      config: {
        candidatesPerRound: 2,
        roundCap: 1,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2],
      },
      renderUserMessage: () => 'msg',
      applyCandidate: async () => ({ satisfied: true, detail: 'applied' }),
      ledgerSink: new SilentSink(),
      streamingAssertions: [forbiddenImportsAssertion(['forbidden_pkg'])],
      streamingSink: sink,
    });
    const sinkA = new CapturingStreamSink();
    const sinkB = new CapturingStreamSink();
    const a = await runTournament(opts(make(), sinkA));
    const b = await runTournament(opts(make(), sinkB));
    assert.deepEqual(sinkA.aborts, sinkB.aborts);
    assert.equal(a.winner?.personaId, b.winner?.personaId);
    assert.equal(a.streamingAbortedCandidates, b.streamingAbortedCandidates);
    assert.equal(a.streamingCharsBeforeAbort, b.streamingCharsBeforeAbort);
  });
});

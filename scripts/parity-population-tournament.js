#!/usr/bin/env node
// Phase 3a parity check: drive a tournament-mode runPopulation against a
// fixed-seed StubSession and capture the winning persona, outcome shape,
// and the deterministic subset of the ledger (everything except wall-time
// and file paths that vary per run). Pre-cut: capture baseline. Post-cut:
// re-run; the captures must remain byte-identical (or, for fields the
// post-split code legitimately reshapes, the deviations are documented in
// the commit body).
//
// Why a fixed-seed StubSession instead of a live provider: tournament
// fairness depends on candidate timing, which a real provider can't
// reproduce. StubSession's responder is a pure function of the request,
// which gives us byte-stable transcripts.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { JsonlLedger, readEntries } = require('../dist/src/ledger/jsonl-ledger');
const { createDefaultRegistry } = require('../dist/src/persona/persona-registry');
const { runPopulation } = require('../dist/src/population/manager');
const { StubSession } = require('../dist/src/session/stub-session');
const { finalize } = require('../dist/src/contract/compiler');

const OUT_ROOT = path.join(__dirname, '..', 'evidence', 'phase-3-parity', 'population');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeContract(repoRoot, filePath) {
  return finalize({
    schemaVersion: 'v1',
    goal: 'tournament parity capture',
    repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
    obligations: [
      { type: 'file-must-exist', path: filePath },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
    extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
  });
}

// Fixed responder: deterministic per (personaId, obligationIndex).
function buildSatisfiedSession() {
  return new StubSession({
    projectContext: 'CTX',
    responder: (req) => {
      if (req.personaId === 'tournament-verifier') {
        return JSON.stringify({ score: 0.85, rationale: 'parity-fixed' });
      }
      if (req.personaId === 'architect') {
        return '```\nfile body for parity capture\n```';
      }
      return 'no-op';
    },
  });
}

function buildEscalatingSession() {
  return new StubSession({
    projectContext: 'CTX',
    responder: (req) => {
      if (req.personaId === 'tournament-verifier') {
        return JSON.stringify({ score: 0.05, rationale: 'never good' });
      }
      if (req.personaId === 'architect') {
        return '```\nx\n```';
      }
      return 'no-op';
    },
  });
}

// Strip fields that vary run-to-run (wall time, temp paths, runId, hashes
// of paths). What remains is the behavioral signature.
function sanitizeOutcome(repoRoot, runId, o) {
  const out = {
    obligationIndex: o.obligationIndex,
    obligationType: o.obligation.type,
    personaId: o.personaId,
    satisfied: o.satisfied,
    detail: scrubPaths(repoRoot, runId, o.detail),
  };
  if (o.tournament) {
    out.tournament = {
      escalated: o.tournament.escalated,
      winnerPersonaId: o.tournament.winner?.personaId ?? null,
      roundCount: o.tournament.rounds.length,
      perRoundPersonas: o.tournament.rounds.map((r) => r.candidates.map((c) => c.personaId)),
    };
  }
  return out;
}

function scrubPaths(repoRoot, runId, s) {
  if (typeof s !== 'string') return s;
  return s
    .split(repoRoot).join('<REPO>')
    .split(runId).join('<RUN>');
}

function sanitizeLedgerEntry(repoRoot, runId, e) {
  const cloned = JSON.parse(JSON.stringify(e));
  // Wall-time + hash-chain fields vary per run; strip them. The behavioral
  // signature is everything else.
  delete cloned.ts;
  delete cloned.entryHash;
  delete cloned.prevHash;
  delete cloned.seq;
  if (typeof cloned.runId === 'string') cloned.runId = '<RUN>';
  if (typeof cloned.detail === 'string') cloned.detail = scrubPaths(repoRoot, runId, cloned.detail);
  if (cloned.type === 'workspace-snapshot' && Array.isArray(cloned.files)) {
    cloned.files = cloned.files.map((f) => ({
      ...f,
      path: typeof f.path === 'string' ? scrubPaths(repoRoot, runId, f.path) : f.path,
    }));
  }
  return cloned;
}

async function runCase(name, build) {
  const dir = path.join(OUT_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const repo = tmpDir(`phase3a-${name}-`);
  try {
    const { contract, session } = build(repo);
    const ledgerPath = path.join(repo, 'ledger.jsonl');
    const runId = `phase3a-${name}`;
    const ledger = new JsonlLedger(ledgerPath, runId);
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
      runId,
    });
    const sanitizedOutcomes = result.outcomes.map((o) => sanitizeOutcome(repo, runId, o));
    fs.writeFileSync(
      path.join(dir, 'outcomes.json'),
      JSON.stringify(
        {
          mode: result.mode,
          satisfied: result.satisfied,
          failed: result.failed,
          memoizedObligations: result.memoizedObligations,
          deterministicObligations: result.deterministicObligations,
          deterministicReroutes: result.deterministicReroutes,
          preVerifiedObligations: result.preVerifiedObligations,
          totalUsage: result.totalUsage,
          outcomes: sanitizedOutcomes,
        },
        null,
        2,
      ) + '\n',
    );
    const entries = readEntries(ledgerPath).map((e) => sanitizeLedgerEntry(repo, runId, e));
    fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(entries, null, 2) + '\n');
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch (_e) { /* swept */ }
  }
}

async function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  await runCase('satisfied-three-obligations', (repo) => ({
    contract: makeContract(repo, 'CHANGES.md'),
    session: buildSatisfiedSession(),
  }));
  await runCase('escalated-low-scores', (repo) => ({
    contract: makeContract(repo, 'CHANGES.md'),
    session: buildEscalatingSession(),
  }));
  const cases = fs.readdirSync(OUT_ROOT);
  process.stdout.write(`wrote tournament captures: ${cases.join(', ')}\n`);
}

main().catch((err) => {
  process.stderr.write(`harness failure: ${err.stack ?? err.message}\n`);
  process.exit(1);
});

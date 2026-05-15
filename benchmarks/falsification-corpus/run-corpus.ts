// Phase 4 parity harness: drives each adapter through the full
// pipeline (build prompt → invoke (overridden) → parse → apply →
// classify → cost) on a fixed seed of synthesized entries. Emits one
// JSON line per entry so a refactor can be gated on byte-stable
// predicate verdicts and integer-stable token costs.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CliFalsifier,
  claudeCodeProfile,
  codexProfile,
  copilotProfile,
} from '../../src/falsification/adapters';
import type { FalsificationInput } from '../../src/falsification/adapters';
import type { ObligationV1 } from '../../src/contract/types';

export const HARNESS_SEED = 'phase-4-parity-2026-05-14';

export interface CorpusRow {
  readonly id: string;
  readonly adapter: string;
  readonly predicate_verdict: string;
  readonly cost_tokens: number;
}

type AdapterName = 'codex' | 'copilot' | 'claude-code';

interface CorpusEntry {
  readonly id: string;
  readonly adapter: AdapterName;
  readonly obligation: ObligationV1;
  readonly setupWorkspace: (workspaceRoot: string) => void;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const codexCandidatesJson = (token: string): string =>
  [
    '```json',
    JSON.stringify({
      candidates: Array.from({ length: 3 }, (_, i) => ({
        name: `c-${i}`,
        rationale: 'introduces forbidden token in fresh file',
        files: [{ relPath: `c-${i}/leak.txt`, bytes: token }],
      })),
    }),
    '```',
    'tokens used: input=120 output=80 total=200',
  ].join('\n');

const codexInnocentJson = (): string =>
  [
    '```json',
    JSON.stringify({
      candidates: Array.from({ length: 3 }, (_, i) => ({
        name: `safe-${i}`,
        rationale: 'does not contain the token',
        files: [{ relPath: `safe-${i}/note.txt`, bytes: 'nothing-forbidden' }],
      })),
    }),
    '```',
    'tokens used: input=80 output=40 total=120',
  ].join('\n');

const copilotUpwardJson = (): string =>
  [
    '```json',
    JSON.stringify({
      candidates: [
        {
          name: 'add-upward',
          rationale: 'introduces upward import',
          files: [{ relPath: 'lib/cheat.ts', bytes: 'import { s } from "../sibling";\n' }],
        },
        {
          name: 'add-upward-2',
          rationale: 'second upward import',
          files: [{ relPath: 'lib/cheat2.ts', bytes: 'import "../sibling";\n' }],
        },
        {
          name: 'no-op',
          rationale: 'innocent control',
          files: [{ relPath: 'lib/innocent.ts', bytes: 'export const x = 2;\n' }],
        },
      ],
    }),
    '```',
    'Requests 4 Premium (10s)',
  ].join('\n');

const copilotInnocentJson = (): string =>
  [
    '```json',
    JSON.stringify({
      candidates: Array.from({ length: 3 }, (_, i) => ({
        name: `clean-${i}`,
        rationale: 'no upward import',
        files: [{ relPath: `lib/x${i}.ts`, bytes: `export const x${i} = ${i};\n` }],
      })),
    }),
    '```',
    'Requests 1 Premium (5s)',
  ].join('\n');

const copilotSignatureJson = (): string =>
  [
    '```json',
    JSON.stringify({
      candidates: [
        {
          name: 'wrong-return-type',
          rationale: 'flip return type',
          files: [
            {
              relPath: 'src/widget.ts',
              bytes: 'export function compute(x: number): string {\n  return String(x);\n}\n',
            },
          ],
        },
        {
          name: 'rename',
          rationale: 'rename function',
          files: [
            {
              relPath: 'src/widget.ts',
              bytes: 'export function renamed(x: number): number {\n  return x;\n}\n',
            },
          ],
        },
        {
          name: 'no-params',
          rationale: 'drop the parameter',
          files: [
            {
              relPath: 'src/widget.ts',
              bytes: 'export function compute(): number {\n  return 0;\n}\n',
            },
          ],
        },
      ],
    }),
    '```',
    'Requests 3 Premium (8s)',
  ].join('\n');

const claudeCodeEnvelope = (resultPayload: string, totalCostUsd: number): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: resultPayload,
    total_cost_usd: totalCostUsd,
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    stop_reason: 'end_turn',
    num_turns: 1,
  });

const setupImportGraphScope = (ws: string): void => {
  const scope = path.join(ws, 'lib');
  fs.mkdirSync(scope, { recursive: true });
  fs.writeFileSync(path.join(scope, 'a.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(ws, 'sibling.ts'), 'export const s = 2;\n', 'utf8');
};

/** Deterministic entry list, seed = HARNESS_SEED. */
export function buildCorpusEntries(): readonly CorpusEntry[] {
  return [
    {
      id: 'codex-prop-counter-example',
      adapter: 'codex',
      obligation: {
        type: 'property-must-hold',
        predicate: '! grep -r "FORBIDDEN_TOKEN_CORPUS" . 2>/dev/null',
        target: 'no FORBIDDEN_TOKEN_CORPUS in workspace',
      },
      setupWorkspace: () => undefined,
      stdout: codexCandidatesJson('FORBIDDEN_TOKEN_CORPUS'),
      stderr: 'model: o4-mini',
      exitCode: 0,
    },
    {
      id: 'codex-prop-no-counter-example',
      adapter: 'codex',
      obligation: {
        type: 'property-must-hold',
        predicate: '! grep -r "FORBIDDEN_TOKEN_CORPUS_B" . 2>/dev/null',
        target: 'no FORBIDDEN_TOKEN_CORPUS_B in workspace',
      },
      setupWorkspace: () => undefined,
      stdout: codexInnocentJson(),
      stderr: 'model: o4-mini',
      exitCode: 0,
    },
    {
      id: 'codex-prop-baseline-tainted',
      adapter: 'codex',
      obligation: {
        type: 'property-must-hold',
        predicate: '! grep -r "FORBIDDEN_TOKEN_CORPUS_C" . 2>/dev/null',
        target: 'no FORBIDDEN_TOKEN_CORPUS_C in workspace',
      },
      setupWorkspace: (ws) =>
        fs.writeFileSync(path.join(ws, 'tainted.txt'), 'FORBIDDEN_TOKEN_CORPUS_C', 'utf8'),
      stdout: codexInnocentJson(),
      stderr: 'model: o4-mini',
      exitCode: 0,
    },
    {
      id: 'copilot-import-graph-counter-example',
      adapter: 'copilot',
      obligation: { type: 'import-graph-must-satisfy', constraint: 'no-upward-imports', scope: 'lib' },
      setupWorkspace: setupImportGraphScope,
      stdout: copilotUpwardJson(),
      stderr: '',
      exitCode: 0,
    },
    {
      id: 'copilot-import-graph-no-counter-example',
      adapter: 'copilot',
      obligation: { type: 'import-graph-must-satisfy', constraint: 'no-upward-imports', scope: 'lib' },
      setupWorkspace: setupImportGraphScope,
      stdout: copilotInnocentJson(),
      stderr: '',
      exitCode: 0,
    },
    {
      id: 'copilot-function-signature-counter-example',
      adapter: 'copilot',
      obligation: {
        type: 'function-must-have-signature',
        file: 'src/widget.ts',
        name: 'compute',
        signature: '(x: number): number',
      },
      setupWorkspace: (ws) => {
        const srcDir = path.join(ws, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(
          path.join(srcDir, 'widget.ts'),
          'export function compute(x: number): number {\n  return x;\n}\n',
          'utf8',
        );
      },
      stdout: copilotSignatureJson(),
      stderr: '',
      exitCode: 0,
    },
    {
      id: 'claude-code-prop-counter-example',
      adapter: 'claude-code',
      obligation: {
        type: 'property-must-hold',
        predicate: '! grep -r "FORBIDDEN_TOKEN_CORPUS_D" . 2>/dev/null',
        target: 'no FORBIDDEN_TOKEN_CORPUS_D in workspace',
      },
      setupWorkspace: () => undefined,
      stdout: claudeCodeEnvelope(codexCandidatesJson('FORBIDDEN_TOKEN_CORPUS_D'), 0.12345),
      stderr: '',
      exitCode: 0,
    },
    {
      id: 'claude-code-import-graph-counter-example',
      adapter: 'claude-code',
      obligation: { type: 'import-graph-must-satisfy', constraint: 'no-upward-imports', scope: 'lib' },
      setupWorkspace: setupImportGraphScope,
      stdout: claudeCodeEnvelope(copilotUpwardJson(), 0.06789),
      stderr: '',
      exitCode: 0,
    },
  ];
}

// Integer-stable cost proxy that tolerates +/-1 floating-point jitter.
function costTokens(dollarsApiEquivalent: number, fallback: number): number {
  const apiEq = Math.round(dollarsApiEquivalent * 1_000_000);
  return apiEq > 0 ? apiEq : fallback;
}

async function runEntry(entry: CorpusEntry): Promise<CorpusRow> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `swarm-corpus-${entry.adapter}-`));
  try {
    entry.setupWorkspace(ws);
    const input: FalsificationInput = {
      patchSha: '0'.repeat(40),
      obligation: entry.obligation,
      contextRefs: [],
      timeBudgetMs: 5_000,
      workspaceRoot: ws,
    };
    const invocation = async () => ({
      stdout: entry.stdout,
      stderr: entry.stderr,
      exitCode: entry.exitCode,
      wallClockMs: 50,
    });
    let outcome;
    switch (entry.adapter) {
      case 'codex':
        outcome = await new CliFalsifier(codexProfile, {
          authMethodOverride: () => 'api',
          invocationOverride: invocation,
        }).falsify(input);
        break;
      case 'copilot':
        outcome = await new CliFalsifier(copilotProfile, {
          authMethodOverride: () => 'chatgpt',
          invocationOverride: invocation,
        }).falsify(input);
        break;
      case 'claude-code':
        outcome = await new CliFalsifier(claudeCodeProfile, {
          authMethodOverride: () => 'api',
          invocationOverride: invocation,
        }).falsify(input);
        break;
    }
    const verdict =
      outcome.result.kind === 'no-falsification-found'
        ? `${outcome.result.kind}:${outcome.result.reason}`
        : outcome.result.kind;
    return {
      id: entry.id,
      adapter: entry.adapter,
      predicate_verdict: verdict,
      cost_tokens: costTokens(outcome.cost.dollarsApiEquivalent, outcome.cost.counterExamplesFound),
    };
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

/** Execute the deterministic corpus in stable entry order. */
export async function runCorpus(): Promise<readonly CorpusRow[]> {
  const rows: CorpusRow[] = [];
  for (const entry of buildCorpusEntries()) rows.push(await runEntry(entry));
  return rows;
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (typeof outPath !== 'string' || outPath.length === 0) {
    throw new Error('usage: run-corpus.js <out.jsonl>');
  }
  const rows = await runCorpus();
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  assert.ok(rows.length > 0, 'corpus must emit at least one row');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`${e.stack ?? e.message}\n`);
    process.exitCode = 1;
  });
}

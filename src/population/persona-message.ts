import type { ContractManifest, ObligationV1 } from '../contract/types';
import { verifyObligation } from '../verification/run-verifier';
import { renderObligationFields } from '../shared/obligation-rendering';
import { appendFileContext } from './file-context';
import { isTestFilePath, type TestFramework } from './test-framework-misuse';

// commandFailureTail: pre-running the verifier once before synthesis
// surfaces the actual error to the persona; without it the implementer
// gets "make build pass" with zero signal and historically responded
// with off-target diffs.
// testFramework: without this hint the architect defaults to Jest API
// and lands broken files in node:test / Mocha / Vitest projects.
export interface RenderContext {
  commandFailureTail?: string;
  testFramework?: TestFramework | null;
}

// Contract context (goal, repo summary) is sent once via the cached
// system block; only per-obligation specifics go here so cache hits
// dominate.
export function renderDynamicMessage(
  obligation: ObligationV1,
  repoRoot: string,
  context?: RenderContext,
): string {
  const lines = [
    `Obligation:`,
    renderObligationFields(obligation),
    '',
    `Repository root: ${repoRoot}`,
    '',
  ];
  switch (obligation.type) {
    case 'file-must-exist': {
      // Framework hint goes FIRST: structurally salient placement
      // overrides the model's Jest-default-when-unhinted bias.
      const fwHint = renderTestFrameworkHint(obligation.path, context?.testFramework ?? null);
      if (fwHint) {
        lines.push('REQUIRED:', fwHint, '');
      }
      lines.push(`Emit the file content for ${obligation.path}.`);
      lines.push(
        'Wrap the file body in a single fenced code block. No prose outside the fences.',
      );
      break;
    }
    case 'build-must-pass':
      lines.push(`The repository must satisfy: ${obligation.command}`);
      lines.push('If the build is already passing, output the literal text "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that makes the build pass.',
      );
      lines.push(
        'Use repo-relative paths in diff headers (`--- a/path` and `+++ b/path`); never write outside existing files unless the diff explicitly creates a new path the obligation requires.',
      );
      if (context?.testFramework) {
        lines.push(renderFrameworkPreservationHint(context.testFramework));
      }
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.command, context.commandFailureTail));
      }
      break;
    case 'test-must-pass':
      lines.push(`The repository must satisfy: ${obligation.command}`);
      lines.push('If tests already pass, output the literal text "no-op".');
      lines.push('Otherwise output a unified diff against repo root that makes tests pass.');
      lines.push(
        'Use repo-relative paths in diff headers; never write outside existing files unless the diff explicitly creates a path the obligation requires.',
      );
      if (context?.testFramework) {
        lines.push(renderFrameworkPreservationHint(context.testFramework));
      }
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.command, context.commandFailureTail));
      }
      break;
    case 'function-must-have-signature':
      lines.push(
        `Function "${obligation.name}" in ${obligation.file} must declare the signature ` +
          `"${obligation.signature}".`,
      );
      lines.push('If the file already declares the function with this signature, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that brings the file into compliance.',
      );
      appendFileContext(lines, repoRoot, [obligation.file]);
      break;
    case 'property-must-hold':
      lines.push(
        `The property over "${obligation.target}" asserted by predicate "${obligation.predicate}" ` +
          `must hold (predicate exits zero).`,
      );
      lines.push('If the property already holds, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that makes the predicate pass.',
      );
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.predicate, context.commandFailureTail));
      }
      appendFileContext(lines, repoRoot, extractFilePathsFromPredicate(obligation.predicate));
      break;
    case 'import-graph-must-satisfy':
      lines.push(
        `Import graph rooted at ${obligation.scope} must satisfy "${obligation.constraint}".`,
      );
      lines.push('If the constraint already holds, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that removes the offending edges.',
      );
      break;
    case 'coverage-must-exceed':
      lines.push(
        `Coverage report ${obligation.scope} must report ${obligation.metric} pct >= ` +
          `${obligation.threshold}%.`,
      );
      lines.push('If coverage already meets the threshold, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that adds tests until coverage clears the threshold.',
      );
      break;
    case 'performance-must-not-regress':
      lines.push(
        `Benchmark "${obligation.benchmark}" must not regress past ` +
          `${(obligation.threshold * 100).toFixed(1)}% versus the baseline value at ` +
          `${obligation.baseline}.`,
      );
      lines.push('If the benchmark already meets the budget, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that recovers the regression.',
      );
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.benchmark, context.commandFailureTail));
      }
      break;
  }
  return lines.join('\n');
}

// Conservative on purpose: false negatives are fine (persona gets no
// extra context); false positives are gated by appendFileContext's
// fs.existsSync check.
function extractFilePathsFromPredicate(predicate: string): string[] {
  const candidates: string[] = [];
  const tokenRe = /(?:^|[\s'"`])([a-zA-Z0-9_.][a-zA-Z0-9_./-]*\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?=[\s'"`)|;&]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(predicate)) !== null) {
    const token = m[1];
    if (token === undefined) continue;
    if (token.startsWith('/') || token.startsWith('-')) continue;
    if (!candidates.includes(token)) candidates.push(token);
  }
  return candidates;
}

// Prescriptive when framework is known; silent when null —
// over-specifying is worse than under-specifying.
function renderTestFrameworkHint(
  relPath: string,
  framework: TestFramework | null,
): string | null {
  if (!isTestFilePath(relPath)) return null;
  switch (framework) {
    case 'jest':
      return 'This is a test file. Use Jest API: `import { ... } from \'@jest/globals\'` (or rely on globals), `describe`, `test`/`it`, `expect(x).toBe(y)`. Do NOT mix in node:test or Mocha imports.';
    case 'vitest':
      return 'This is a test file. Use Vitest API: `import { describe, it, expect } from \'vitest\'`. Do NOT mix in Jest, node:test, or Mocha imports.';
    case 'mocha':
      return 'This is a test file. Use Mocha API: `import { describe, it } from \'mocha\'` plus an assertion library that the project already depends on (typically `chai` or `node:assert`). Do NOT use Jest `expect(x).toBe(y)`.';
    case 'node-test':
      return 'This is a test file. Use Node.js built-in test runner: `import { describe, it } from \'node:test\'` and `import assert from \'node:assert/strict\'`. Use `assert.equal(actual, expected)` (or `assert.deepEqual`); do NOT use Jest `expect(...).toBe(...)` — node:test has no `expect`. Import source files using extension-less paths that match the project\'s tsconfig moduleResolution.';
    case 'pytest':
      return 'This is a test file. Use pytest API: `def test_xxx():` with plain `assert <expr>`. Do NOT use unittest.TestCase classes unless the project already does.';
    case null:
      return null;
  }
}

// Without this hint, the verifier historically rewrote already-correct
// test files into Jest API and broke build-must-pass.
function renderFrameworkPreservationHint(framework: TestFramework): string {
  return (
    `This project uses the **${framework}** test framework. Preserve it. ` +
    'Do not switch test frameworks (no Jest in node:test projects, no node:test in Jest projects, etc.) ' +
    'and do not add a different framework to package.json. Fix the failure within the existing framework.'
  );
}

function renderFailureBlock(command: string, tail: string): string {
  const capped = tail.length > 2000 ? tail.slice(-2000) : tail;
  return [
    `The verifier ran \`${command}\` against the current workspace and it failed. Tail of stderr+stdout:`,
    '```',
    capped,
    '```',
    'Diagnose the failure from this output and produce the smallest diff that fixes the root cause. Do not write speculative files.',
  ].join('\n');
}

// Marginal cost vs. the post-merge check is one extra verifier run per
// command obligation; in return the persona prompt carries the real
// error and collapses round-after-round misdiagnosis into one patch.
function preRunCommandVerifier(
  obligation: ObligationV1,
  options: Parameters<typeof verifyObligation>[1],
): string | null {
  if (
    obligation.type !== 'build-must-pass' &&
    obligation.type !== 'test-must-pass' &&
    obligation.type !== 'property-must-hold' &&
    obligation.type !== 'performance-must-not-regress'
  ) {
    return null;
  }
  const r = verifyObligation(obligation, options);
  if (r.satisfied) return null;
  const m = r.detail.match(/tail:\s*([\s\S]+)$/);
  if (m && m[1]) return m[1].trim();
  return r.detail;
}

export function buildRenderContext(
  obligation: ObligationV1,
  repoRoot: string,
  manifest: ContractManifest,
  commandTimeoutMs: number | undefined,
): RenderContext {
  const ctx: RenderContext = {};
  if (obligation.type === 'file-must-exist') {
    const fw = manifest.repoContext.testFramework ?? null;
    if (fw !== null) ctx.testFramework = fw;
  } else {
    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    const tail = preRunCommandVerifier(obligation, verifyOpts);
    if (tail) ctx.commandFailureTail = tail;
  }
  return ctx;
}

// Render the verifiable-evidence block triggers into the PR comment. When a
// trigger blocks a merge, the author must be able to read the comment, copy the
// reproduce command, run it, and see the same failing result. Each trigger
// therefore renders its summary, the exact reproduce command, and the captured
// evidence (the failing repro output, the surviving mutant, the obligation
// output, or the restored failing tests). Kept out of index.ts so the renderer
// stays focused.

import type { AuditMode } from '../types';
import type {
  BlockTrigger,
  BlockTriggerEvidence,
  MockMutationProvenEvidence,
  NoOpFixProvenEvidence,
  TestTamperProvenEvidence,
} from '../gate/block-trigger-types';

/**
 * Render the block-trigger section, or [] when there are none. In gate mode the
 * header frames the triggers as the blocking reason; in advise mode it frames
 * them as advisory evidence that is not blocking.
 *
 * @param triggers the eligible-fired triggers to render
 * @param mode the audit mode, which changes only the framing
 * @returns the section's markdown lines
 */
export function renderBlockTriggerSection(
  triggers: readonly BlockTrigger[],
  mode: AuditMode,
): string[] {
  if (triggers.length === 0) return [];
  const gating = mode === 'gate';
  const lines: string[] = [
    `## ${gating ? 'Blocking evidence' : 'Verifiable evidence'} (${triggers.length})`,
    '',
  ];
  lines.push(
    gating
      ? '_This PR is blocked by self-certifying runtime evidence. Run the command under each item to see the same result._'
      : '_Self-certifying runtime evidence. Advisory mode, not blocking. Run the command under each item to reproduce._',
    '',
  );
  for (const trigger of triggers) lines.push(...renderOne(trigger));
  return lines;
}

function renderOne(trigger: BlockTrigger): string[] {
  return [
    `### \`${trigger.kind}\``,
    '',
    trigger.summary,
    '',
    '*Reproduce:*',
    '```sh',
    trigger.reproduce,
    '```',
    '',
    ...renderEvidence(trigger.evidence),
  ];
}

function renderEvidence(evidence: BlockTriggerEvidence): string[] {
  switch (evidence.kind) {
    case 'claim-falsified':
      return [
        `*Claim:* \`${evidence.claim}\` for ${evidence.issueRef}. ` +
          `*Repro status:* pre ${evidence.preStatus}, post ${evidence.postStatus}.`,
        '',
        '```text',
        evidence.postOutput,
        '```',
        '',
      ];
    case 'corroborated-under-constraint': {
      const detail =
        evidence.signal === 'surviving-mutant'
          ? `surviving mutant(s): ${(evidence.mutants ?? []).join('; ')}`
          : `uncovered changed line(s): ${(evidence.uncoveredLines ?? []).join(', ')}`;
      return [
        `*Finding:* \`${evidence.category}\` at ${evidence.file}:${evidence.line}. *Runtime signal:* ${detail}.`,
        '',
        '```diff',
        evidence.findingEvidence,
        '```',
        '',
      ];
    }
    case 'obligation-failure':
      return [
        `*Obligation:* \`${evidence.obligationType}\`. *Command:* \`${evidence.command}\`.`,
        '',
        '```text',
        evidence.output,
        '```',
        '',
      ];
    case 'test-tamper-proven':
      return renderTestTamperProven(evidence);
    case 'mock-mutation-proven':
      return renderMockMutationProven(evidence);
    case 'no-op-fix-proven':
      return renderNoOpFixProven(evidence);
  }
}

/** ✅ / ❌ / — for a control that passed, failed, or never executed (null). */
function controlMark(value: boolean | null): string {
  if (value === true) return '✅';
  if (value === false) return '❌';
  return '—';
}

/** The three internal controls behind a restoration proof, in a fixed order so
 *  the table renders byte-identical for the same proof. The trigger only gates
 *  when all three are ✅ (see self-certifying.controlsAllGreen). */
function renderTestTamperProven(evidence: TestTamperProvenEvidence): string[] {
  const c = evidence.controls;
  return [
    `*Verdict:* \`${evidence.verdict}\` — \`${evidence.category}\` on ${evidence.testFiles.join(', ')}.`,
    '',
    `*Restored failing test(s):* ${evidence.failingTests.join('; ')}.`,
    '',
    '| Control | Result |',
    '| --- | --- |',
    `| Restored test passes on the base checkout | ${controlMark(c.baseTestPasses)} |`,
    `| Tampered suite passes as submitted | ${controlMark(c.tamperedSuitePasses)} |`,
    `| Restored run fails twice with the same test identity | ${controlMark(c.restoredFailsTwiceSameIdentity)} |`,
    '',
  ];
}

/** The three controls behind a mock-mutation proof, in a fixed order so the
 *  table renders byte-identical for the same proof. The trigger only gates
 *  when all three are ✅ (see self-certifying.controlsAllGreen). */
function renderMockMutationProven(evidence: MockMutationProvenEvidence): string[] {
  const c = evidence.controls;
  return [
    `*Verdict:* \`${evidence.verdict}\` — cheat-mock-mutation on ${evidence.testFiles.join(', ')}.`,
    '',
    `*Restored failing test(s):* ${evidence.failingTests.join('; ')}.`,
    '',
    `*Mocked return value(s):* ${evidence.mockedReturnValues.map((v) => `\`${v}\``).join(', ')}.`,
    '',
    '| Control | Result |',
    '| --- | --- |',
    `| Tampered (mocked) suite passes as submitted | ${controlMark(c.tamperedSuitePasses)} |`,
    `| Restored run fails twice with the same test identity | ${controlMark(c.restoredFailsTwiceSameIdentity)} |`,
    `| Added mock returns the asserted value | ${controlMark(c.mockReturnsAssertedValue)} |`,
    '',
  ];
}

/** The three controls behind a no-op-fix proof, in a fixed order so the table
 *  renders byte-identical for the same proof. The trigger only gates when all
 *  three are ✅ (see self-certifying.controlsAllGreen). */
function renderNoOpFixProven(evidence: NoOpFixProvenEvidence): string[] {
  const c = evidence.controls;
  return [
    `*Verdict:* \`${evidence.verdict}\` — no-op-fix; reverted ${evidence.revertedSourceFiles.join(', ')}.`,
    '',
    `*PR claim:* \`${evidence.prClaim}\`.`,
    '',
    `*Affected test(s) rerun with the fix reverted:* ${evidence.affectedTestFiles.join('; ')}.`,
    '',
    '| Control | Result |',
    '| --- | --- |',
    `| PR claims a fix | ${controlMark(c.prClaimsFix)} |`,
    `| Affected tests pass as submitted | ${controlMark(c.suitePassesAsSubmitted)} |`,
    `| Affected tests still pass with the fix reverted (twice) | ${controlMark(c.revertedSuiteStillPassesTwice)} |`,
    '',
  ];
}

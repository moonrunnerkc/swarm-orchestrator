import { strict as assert } from 'assert';
import { renderPrComment } from '../../../src/audit/report-comment';
import { assignConfidence } from '../../../src/audit/cheat-detector/verify-findings';
import type { AuditResult, Finding } from '../../../src/audit/types';

function finding(over: Partial<Finding>): Finding {
  return {
    category: 'no-op-fix',
    severity: 'warn',
    message: 'm',
    location: { file: 'src/a.ts', line: 1 },
    evidence: 'e',
    ...over,
  };
}

function result(findings: Finding[]): AuditResult {
  return {
    pass: findings.every((f) => f.severity !== 'block'),
    findings,
    generatedAt: '2026-05-31T00:00:00.000Z',
    detectorVersions: { 'no-op-fix': '2.0.0' },
    detectorSet: 'default',
  };
}

describe('audit / report-comment / confidence + cascade', () => {
  it('assignConfidence: runtime-corroborated > judge-confirmed > structural-only', () => {
    const fs = [
      finding({ runtimeCorroboration: { signal: 'surviving-mutant', mutants: ['m'] }, judgeConfirmed: true }),
      finding({ judgeConfirmed: true, severity: 'warn' }),
      finding({ intentUpgraded: true, severity: 'warn' }),
      finding({ severity: 'block' }),
      finding({ severity: 'info' }),
    ];
    assignConfidence(fs);
    assert.deepEqual(
      fs.map((f) => f.confidence),
      ['runtime-corroborated', 'judge-confirmed', 'structural-only', 'structural-only', 'structural-only'],
    );
  });

  it('renders the confidence on each finding', () => {
    const out = renderPrComment(result([finding({ confidence: 'judge-confirmed', severity: 'warn' })]), {
      mode: 'advise',
    });
    assert.match(out, /\*Confidence:\* judge-confirmed\./);
  });

  it('renders the judge model id and prompt hash for replay', () => {
    const out = renderPrComment(
      result([
        finding({
          severity: 'warn',
          judgeModelId: 'claude-haiku-4-5-20251001',
          judgePromptHash: 't:abc12345+d:def67890',
          judgeReasoning: 'the path is untouched',
        }),
      ]),
      { mode: 'advise' },
    );
    assert.match(out, /LLM judge \(`claude-haiku-4-5-20251001`, prompt `t:abc12345\+d:def67890`\)/);
    assert.match(out, /the path is untouched/);
  });

  it('renders the runtime-corroboration backing next to the badge', () => {
    const out = renderPrComment(
      result([
        finding({
          category: 'coverage-erosion',
          confidence: 'runtime-corroborated',
          runtimeCorroboration: { signal: 'surviving-mutant', mutants: ['Block@src/a.ts:12 -> Survived'] },
        }),
      ]),
      { mode: 'advise' },
    );
    assert.match(out, /\*Confidence:\* runtime-corroborated\./);
    assert.match(out, /Runtime-corroborated by\* a surviving mutant \(Block@src\/a\.ts:12 -> Survived\)/);
  });

  it('collapses a same-category cascade beyond the cap into one summary line', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 25; i += 1) {
      findings.push(finding({ severity: 'warn', location: { file: `src/f${i}.ts`, line: 1 } }));
    }
    const out = renderPrComment(result(findings), { mode: 'advise' });
    const rendered = (out.match(/### `no-op-fix`/g) ?? []).length;
    assert.equal(rendered, 10, 'should render only the first 10 of the cascade');
    assert.match(out, /15 more `no-op-fix` finding\(s\)/);
  });
});

import { strict as assert } from 'assert';
import { buildRemediationStep } from '../src/gate-remediation';
import type { AgentProfile } from '../src/config-loader';

function makeAgentsMap(names: string[]): Map<string, AgentProfile> {
  const map = new Map<string, AgentProfile>();
  for (const name of names) {
    map.set(name, { name, model: 'test-model', systemPrompt: '' } as unknown as AgentProfile);
  }
  return map;
}

function resolveAgent(agents: Map<string, AgentProfile>, name: string): AgentProfile | undefined {
  return agents.get(name);
}

describe('gate-remediation', () => {
  describe('buildRemediationStep', () => {
    it('returns null when gate result is undefined', () => {
      const result = buildRemediationStep(
        undefined,
        true,
        'duplicateRefactorAdded',
        {},
        makeAgentsMap(['integrator_finalizer']),
        resolveAgent,
        'Fix duplicates',
        'warning',
        3,
        'fallback_agent',
      );
      assert.equal(result, null);
    });

    it('returns null when gate passed', () => {
      const result = buildRemediationStep(
        { status: 'pass', issues: [] },
        true,
        'duplicateRefactorAdded',
        {},
        makeAgentsMap(['integrator_finalizer']),
        resolveAgent,
        'Fix duplicates',
        'warning',
        3,
        'fallback_agent',
      );
      assert.equal(result, null);
    });

    it('returns null when config disabled', () => {
      const result = buildRemediationStep(
        { status: 'fail', issues: [{ message: 'dup found' }] },
        false,
        'duplicateRefactorAdded',
        {},
        makeAgentsMap(['integrator_finalizer']),
        resolveAgent,
        'Fix duplicates',
        'warning',
        3,
        'fallback_agent',
      );
      assert.equal(result, null);
    });

    it('returns null when already triggered', () => {
      const result = buildRemediationStep(
        { status: 'fail', issues: [{ message: 'dup found' }] },
        true,
        'duplicateRefactorAdded',
        { duplicateRefactorAdded: true },
        makeAgentsMap(['integrator_finalizer']),
        resolveAgent,
        'Fix duplicates',
        'warning',
        3,
        'fallback_agent',
      );
      assert.equal(result, null);
    });

    it('returns a remediation step with integrator_finalizer when available', () => {
      const triggered: Record<string, boolean> = {};
      const result = buildRemediationStep(
        { status: 'fail', issues: [{ message: 'dup found', filePath: 'src/foo.ts' }] },
        true,
        'duplicateRefactorAdded',
        triggered,
        makeAgentsMap(['integrator_finalizer', 'backend_master']),
        resolveAgent,
        'Fix duplicates',
        'warning',
        3,
        'backend_master',
      );
      assert.notEqual(result, null);
      assert.equal(result!.agent, 'integrator_finalizer');
      assert.equal(result!.afterStep, 3);
      assert.ok(result!.task.includes('Fix duplicates'));
      assert.ok(result!.task.includes('src/foo.ts'));
      assert.equal(triggered['duplicateRefactorAdded'], true);
    });

    it('falls back to fallback agent when integrator_finalizer not found', () => {
      const result = buildRemediationStep(
        { status: 'fail', issues: [{ message: 'issue' }] },
        true,
        'testFlag',
        {},
        makeAgentsMap(['backend_master']),
        resolveAgent,
        'Fix something',
        'warning',
        5,
        'backend_master',
      );
      assert.notEqual(result, null);
      assert.equal(result!.agent, 'backend_master');
    });

    it('appends issue hints to the task description', () => {
      const result = buildRemediationStep(
        { status: 'fail', issues: [{ message: 'bad code', filePath: 'a.ts', hint: 'use extract method' }] },
        true,
        'flag',
        {},
        makeAgentsMap(['integrator_finalizer']),
        resolveAgent,
        'Fix it',
        'warning',
        1,
        'fallback',
      );
      assert.ok(result!.task.includes('hint: use extract method'));
    });
  });
});

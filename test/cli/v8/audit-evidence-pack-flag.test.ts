import { strict as assert } from 'assert';
import { handleAudit } from '../../../src/cli/v8/audit-handler';

// The evidence pack's replay-identical identity keys off the PR repo and head
// SHA, which only --pr carries. --evidence-pack without --pr must be a usage
// error (exit 2) rather than producing a pack with no stable identity.
describe('cli/v8/audit --evidence-pack flag', () => {
  it('rejects --evidence-pack without --pr as a usage error', async () => {
    const code = await handleAudit(['--evidence-pack', './pack', '--diff-file', 'x.diff']);
    assert.equal(code, 2);
  });

  it('rejects --evidence-pack with --diff-stdin as a usage error', async () => {
    const code = await handleAudit(['--evidence-pack', './pack', '--diff-stdin']);
    assert.equal(code, 2);
  });
});

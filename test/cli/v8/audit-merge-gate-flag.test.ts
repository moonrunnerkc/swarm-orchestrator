import { strict as assert } from 'assert';
import { handleAudit } from '../../../src/cli/v8/audit-handler';

// The positive merge-safety gate provisions the PR's merged tree from its repo
// and head SHA, which only --pr carries. --merge-gate without --pr must be a
// usage error (exit 2) rather than silently doing nothing. The diff-file source
// keeps the parse valid up to the merge-gate check and avoids reading stdin.
describe('cli/v8/audit --merge-gate flag', () => {
  it('rejects --merge-gate without --pr as a usage error', async () => {
    const code = await handleAudit(['--merge-gate', '--diff-file', 'x.diff']);
    assert.equal(code, 2);
  });

  it('rejects --merge-gate with --diff-stdin as a usage error', async () => {
    const code = await handleAudit(['--merge-gate', '--diff-stdin']);
    assert.equal(code, 2);
  });
});

import { strict as assert } from 'assert';
import { classifyProvisionAttempt } from '../../scripts/real-prs/polyglot-provision';

describe('classifyProvisionAttempt', () => {
  it('classifies a clone/install failure as provision-failed with the real detail', () => {
    const skip = [
      'provision: sandbox-install-failed: python dependency install step "poetry install" (poetry install --no-interaction --no-ansi) failed in /tmp/x',
    ];
    const r = classifyProvisionAttempt(skip, 0);
    assert.equal(r.status, 'provision-failed');
    assert.ok(r.detail.includes('poetry install'), 'detail carries the real failing command');
  });

  it('classifies a purely-additive PR as no-mutable-source', () => {
    const r = classifyProvisionAttempt(['no mutable source lines in diff'], 0);
    assert.equal(r.status, 'no-mutable-source');
  });

  it('classifies a provisioned run with no corroboration as ran-zero-corroborated', () => {
    const r = classifyProvisionAttempt(['coverage[<root>]: unsupported runner'], 0);
    assert.equal(r.status, 'ran-zero-corroborated');
    assert.ok(r.detail.includes('Node-only'));
  });

  it('prefers the provision-failed classification when both a provision skip and other skips exist', () => {
    const r = classifyProvisionAttempt(
      ['provision: sandbox-clone-failed: unreachable', 'no mutable source lines in diff'],
      0,
    );
    assert.equal(r.status, 'provision-failed');
  });
});

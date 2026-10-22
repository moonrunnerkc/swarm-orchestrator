# Obtainable raw evidence for the October 22 capability study

This evidence branch contains the raw native ledgers, exported bundles, external CLI streams,
command outputs, exact patches, frozen inputs, supplemental scorers and local verification logs.
Product source is commit f07cd0861c3be79087baffabbb1238b38e3e37eb. Gates and release checks ran
at 726d2746435e7130b7b407163c8574fc36e9e6a9, whose source includes that product unchanged.
The product report lives on the feature branch; this branch supplies the underlying bytes.
External CLI streams are untrusted imports, not native chokepoint evidence. Verifying a native
bundle validates its evidence and recorded outcome, including failures; it is not a successful task score.

The standard gzip tar archive preserves bytes. inventory.json gives the archive digest and every
member's length and SHA-256. No ledger or payload was rewritten. The shared credential detector's
findings and review are included: matches concern public usage/allowance metrics, dummy Ollama
authentication, source metadata and verifier detector text. No detector exemption was added.
Known-pattern review does not guarantee secret removal.

From a clone, obtain this branch's archive without switching your working tree:

```sh
git fetch origin artifacts/capability-2026-10-22
git show FETCH_HEAD:docs/evidence/2026-10-22-capability/inventory.json > /tmp/capability-inventory.json
git show FETCH_HEAD:docs/evidence/2026-10-22-capability/evidence.tar.gz > /tmp/capability-evidence.tar.gz
python3 - <<'PY'
import hashlib, json, pathlib, tarfile, tempfile
inventory = json.loads(pathlib.Path('/tmp/capability-inventory.json').read_text())
archive = pathlib.Path('/tmp/capability-evidence.tar.gz')
assert 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest() == inventory['archiveDigest']
destination = pathlib.Path(tempfile.mkdtemp(prefix='swarm-capability-restored-'))
with tarfile.open(archive) as packed:
    expected = {row['path'] for row in inventory['files']}
    assert {member.name for member in packed.getmembers()} == expected
    assert all(member.isfile() for member in packed.getmembers())
    packed.extractall(destination, filter='data')
for path in destination.rglob('*'):
    path.chmod(0o700 if path.is_dir() else 0o600)
for row in inventory['files']:
    data = (destination / row['path']).read_bytes()
    assert len(data) == row['bytes']
    assert 'sha256:' + hashlib.sha256(data).hexdigest() == row['digest']
print(destination)
PY
```

Python 3.12 or newer supports the extraction filter. Enter a restored native session's bundle
directory and run `node verify.mjs` with Node 24. Five bundles were independently checked before
publication, all exit 0. Native chain verification does not judge task semantics.
The native-sessions directory includes the entities gate-plan preflight and all four live Swarm
runs. launch-N directories hold product records; comparison-blobs holds digest-addressed external
outputs. The original retained Mocha session remains obtainable from the previously published
evidence/2026-10-22-sessions branch at 2af3c588c, with restoration documented in the product report.

Re-run trajectory-account.mjs from the product feature branch on each restored session. Use its
score-project.mjs and the existing score-tests.mjs with the frozen task manifests and restored
patches for independent project and added-test scoring. Hidden cases are evaluator artifacts and
must remain outside worker workspaces. The two failed agent starts were never retried.

Post-publication accounting is in additional-accounting.json. Product totals exclude readiness
and smoke work, which are listed separately. The raw archive is unchanged. Hidden evaluators
were outside worker checkouts but not protected by OS isolation on this host. Broad CLI host
permissions could reach them; no access was observed. These exposed development samples do not
establish a comparison with enforced inaccessible evaluators.

This is a data-only snapshot, not Swarm product source. Its parent preserves the earlier
publication. The earlier source-plus-archive snapshot failed the unchanged repository weight
check. This snapshot contains only the evidence and its verification workflow. It does not
claim a product gates result. Run python3 verify-archive.py at its root to check every member
and all five native bundles. Product gates remain on the feature PR.

Final source CI records and complete compressed logs are in ci-record.json and ci/. They bind
head 4544df018e8e8164dcfc45c03f959e9f5a22d343 to both push and PR runs. The PR merge tree and
source head tree are identical. Both platform gates, Node 22/24 packaged checks and verifier
matrices passed. The retired source-plus-archive snapshot's weight failure is retained too;
it was not a passing product tree. Each saved log has compressed and uncompressed digests.

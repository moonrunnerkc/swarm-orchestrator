# Sessions of the delivery and preservation stage

`delivery-preservation-sessions.tar.xz` (sha256
`3456a92a0fa43306b55a8190a4065754d956859846a1b338a17ebb57f149c023`) holds, under
`swarm-study-2026-10-24/`, the whole stage directory of each of the stage's eleven live launches,
which is everything the scoring scripts read:
- the session ledgers and blobs of each launch (each with its exported bundle and that bundle's
  own `verify.mjs`):
  - the development launch;
  - the eight launches of the mechanism study;
  - the two launches of the delivery confirmation;
- the run records, the revealed records and the content-addressed blobs (each delivered patch and
  each attempt's snapshot);
- the three frozen manifests, which carry the hidden evaluators of these exposed tasks;
- the configurations they were frozen from.

Extract it under `~/.cache` to give the scoring scripts the paths the stage report names:

```sh
tar -xJf delivery-preservation-sessions.tar.xz -C ~/.cache
node ~/.cache/swarm-study-2026-10-24/mechanism/runs/sessions/<launch>/bundle/verify.mjs \
  ~/.cache/swarm-study-2026-10-24/mechanism/runs/sessions/<launch>/bundle
```

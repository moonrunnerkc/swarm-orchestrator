# refactor-ironroot: acceptance criteria

Sealed before either agent started. Neither agent sees this file, `requirements.json`, `judge.toml`
or `held-out/`.

- Category: refactor
- Repository: ironroot (read-only; every run works in a clone)
- Base: `1d325c297757e83f048be593b59cfda7681a5448`
- Source of the task: new; written for this comparison

## Requirement record

`requirements.json`, passed to `swarm-verify verify --requirements`. R1's text is the task as typed.

```json
[
 {
  "id": "R1",
  "text": "In ironroot, move the three built-in falsifiers out of src/ironroot/verification/falsification.py into a new module, src/ironroot/verification/builtin_claims.py: _falsify_chain_seq_monotonic, _falsify_parent_hash_linkage, _falsify_artifact_hash_stability, and the _BUILTIN_CLAIMS tuple that registers them. falsification.py keeps the claim types, the registry, get_claim_registry, reset_claim_registry_for_testing and run_falsification, and no longer defines the falsifiers or the tuple. This is a pure move: behavior doesn't change, the registry still seeds the same three claims in the same order, existing imports keep working (the tests import _BUILTIN_CLAIMS from ironroot.verification.falsification), and the tests stay as they are.",
  "source": "user",
  "kind": "refactor",
  "required": true,
  "assumptions": [],
  "versions": [],
  "evidence": {
   "tests": [],
   "checks": [
    "test"
   ],
   "structure": [
    {
     "path": "src/ironroot/verification/builtin_claims.py",
     "contains": "async def _falsify_chain_seq_monotonic"
    },
    {
     "path": "src/ironroot/verification/builtin_claims.py",
     "contains": "async def _falsify_parent_hash_linkage"
    },
    {
     "path": "src/ironroot/verification/builtin_claims.py",
     "contains": "async def _falsify_artifact_hash_stability"
    },
    {
     "path": "src/ironroot/verification/builtin_claims.py",
     "contains": "_BUILTIN_CLAIMS"
    }
   ],
   "packages": []
  }
 }
]
```

## Declared checks

`judge.toml`, written as the judging clone's `swarm.toml` after sealing (what `swarm init` infers
for this repository):

```toml
# The judge's declared checks: what swarm init infers for this repository at the base.
[checks]
test = "python3 -m pytest -q"
```

## Held-out check

Sealed with `swarm-verify init --seal 'tests/**/*held_out*'` from a `swarm.toml` whose only test check is
`held-out = { command = "python3 -m pytest -q --no-cov -p no:cacheprovider tests/integrity/test_builtin_claims_held_out.py", kind = "test" }`. The files are copied from
`held-out/` into the judging clone, sealed out of it, and overlaid only for the held-out run.

The structural check: builtin_claims.py defines the three falsifiers and _BUILTIN_CLAIMS; falsification.py defines none of them and keeps its types, registry and entry points; _BUILTIN_CLAIMS is still importable from falsification and is the same object; the registry seeds the same three claims in order, each falsifier living in builtin_claims. --no-cov because the project's addopts carry --cov-fail-under=30, which fails any single-file run.

- `held-out/tests/integrity/test_builtin_claims_held_out.py` sha256 `d4cb3253848b5b4c72d60d43614823f39b3ac0c26f6774b1b931fe7aa2ba860a`

## How both patches are judged

The same way, by `judge.sh`: a fresh clone at the base, the held-out files sealed, `judge.toml`
as `swarm.toml`, then `swarm-verify verify --base 1d325c297757e83f048be593b59cfda7681a5448 --patch <patch.diff> --requirements
requirements.json`, isolated, dependencies prepared, then `swarm-verify replay`. The verdict's
requirement statuses and held-out result are the outcome.

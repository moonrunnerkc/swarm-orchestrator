# Follow-ups

One line per thing deliberately not done during the verifier-first rebuild.
- Held-out tests run in the same process as the code under test, so a source change that patches `node:assert` (or any shared test helper) at import time disables their assertions; the tamper evaluation's four overridden-equality cheats pass this way. Closing it needs the held-out run to load assertions the change cannot reach (a separate assertion process or a frozen copy of the module).
- A surviving mutant does not fail the verdict; whether it should is an open question to settle against the tamper evaluation's honest false-positive rate before changing the rule.
- Checks that already fail at the base commit fail every change; comparing against a base run would let the verifier separate inherited failures from new ones.
- Dependencies are linked from the workspace; a monorepo whose node_modules symlinks workspace packages resolves them to the workspace rather than the checkout. A per-run install or a link rewrite would fix that.
- Submodules are left out of the tree digest; verify.mjs cannot recompute a gitlink from an export.

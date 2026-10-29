# Follow-ups

One line per thing deliberately not done during the verifier-first rebuild.
- Dependencies are linked from the workspace; a monorepo whose node_modules symlinks workspace packages resolves them to the workspace rather than the checkout. A per-run install or a link rewrite would fix that.
- Submodules are left out of the tree digest; verify.mjs cannot recompute a gitlink from an export.
- The evaluation smoke ran three SWE-bench Verified tasks only; the Terminal-Bench 2.0 list and the remaining frozen tasks have not been run.

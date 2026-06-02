# Stryker viability patches

Per-repo notes for getting the execution-grounded mutation check to drive a
repo's test suite. Each repo in the corpus is classified in
`../stryker-viability.json` as one of:

- **green**: Stryker runs against the changed package out of the box (the
  package's detected runner plus a hoisted plugin install is enough).
- **yellow**: Stryker runs only with a documented config adjustment; the
  adjustment is described in `<repo-slug>.md` in this directory.
- **red**: excluded, with the reason recorded in `stryker-viability.json`
  (an undrivable test setup, a custom runtime pool, no detectable runner).

The evidence run (`npm run execution-grounded:run`) skips red repos and
evaluates green and yellow ones. Viability is derived from real run outcomes,
not asserted: a repo is green when a mutation run completed on at least one of
its PRs, and red/yellow with the recorded skip reason otherwise.

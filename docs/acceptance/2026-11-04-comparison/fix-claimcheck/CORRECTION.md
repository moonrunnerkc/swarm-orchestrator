# The one correction to these criteria (2026-11-05)

What changed: R1's evidence in `requirements.json` and `criteria.md`. It named tests by the path
prefix `src::`, every test under `src/`. It now names the three tests of the fix commit e050152,
held out in `held-out/`, by their identity as vitest reports them (`file::suite > title`).

Why: claimcheck's vitest configuration collects `src/**` and `test/**`. A prefix that names one
root says nothing about the repository's tests; it only excluded Swarm's tests, which were put in
`test/unit/`, so R1 read unverified for a patch whose held-out tests passed (2026-11-04 README,
"R1's evidence"). The criteria were wrong about the repository, not either patch. Named by
identity, the requirement is witnessed by the fix commit's own tests wherever an agent puts its
own, and the verifier (swarm-verify 2.1.0) measures the sealed tests test by test.

What did not change: the held-out files, their sha256 digests, the held-out command, `judge.toml`,
the base, and the task's wording. Originals: `criteria.original.md`, `requirements.original.json`.

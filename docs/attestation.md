# Proof-coverage attestation

`swarm audit` emits a machine-readable proof-coverage attestation alongside its
findings. A "no findings" audit is not the same as "everything was checked": the
attestation states what the silence covers so a merge policy can decide, rather
than inferring, whether an audit is safe to consume.

## What it is

For each execution-grounded proof engine, the attestation records whether it
executed, its verdict, and, when it abstained, the precise reason. It also
records sandbox provisioning status and how many control clauses were evaluated.
It is a pure projection of the audit's execution-grounded outcome, so two audits
of the same PR head produce byte-identical attestations. It reports; it does not
judge. There is no pass, block, or merge language in it.

Source: `src/audit/attestation/proof-coverage.ts` (the roll-up and public types),
`src/audit/attestation/engine-projection.ts` (the per-engine projectors).

## Where it appears

- **Audit JSON** (`swarm audit --output json`): under the top-level
  `proofCoverage` key.
- **Evidence pack** (`swarm audit --pr <ref> --evidence-pack <dir>`): as
  `attestation/proof-coverage.json`, content-addressed into `MANIFEST.json` with
  role `attestation`, re-verifiable offline with `verifyManifest`.
- **GitHub Action check output**: a compact summary written to
  `$GITHUB_STEP_SUMMARY` by `.github/actions/swarm-audit/action.yml` and the
  dogfood workflow `.github/workflows/pr-audit.yml`.

## Schema

```json
{
  "schema": "swarm-proof-coverage/v1",
  "provisioning": { "attempted": true, "provisioned": false, "reason": "no lockfile" },
  "engines": [
    {
      "engine": "no-op-fix-restoration",
      "applicable": true,
      "executed": true,
      "records": [
        {
          "subject": "src/pay.ts",
          "verdict": "proven",
          "outcome": "finding",
          "controlsEvaluated": 4,
          "replayCommand": "npx mocha ..."
        }
      ]
    }
  ],
  "summary": {
    "enginesApplicable": 1,
    "enginesExecuted": 1,
    "findings": 1,
    "abstains": 0,
    "controlsEvaluated": 4
  }
}
```

- `outcome` is one of `finding`, `exonerated`, `abstain`, `signal`, `disputed`. A
  `signal` is a corroboration run (mutation, coverage) that informs but never
  becomes a finding on its own. A `disputed` outcome is a fired-then-disputed
  proof: every per-instance control went green, but a static refuter (today,
  coverage relocation) contested the leap from pattern to cheat, so the record is
  neither a finding nor a clean pass. `summary.disputed` counts them.
- `abstainClass` (present only on an abstain) is one of `not-provisioned`,
  `control-clause`, `structurally-inapplicable`, `execution-error`. The precise
  reason is always the `verdict` string; `abstainClass` buckets it.
- `provisioning.attempted` is false when the execution-grounded layer did not run
  at all (disabled, or not a `--pr` audit); in that case `engines` is empty and
  the attestation honestly states that no proof executed.

## The consumption contract

A merge policy keys on states, not on the absence of findings. The states below
are what a cautious policy can distinguish.

### A state a cautious auto-merge policy could key on

All of the following, together:

- `provisioning.provisioned === true` (the sandbox built and installed), and
- `summary.findings === 0` (no proof reached a finding), and
- every engine a policy trusts is `applicable === true` and `executed === true`
  for the diff's relevant categories (the proof actually ran, rather than
  abstaining before any execution).

This is the only shape in which "no findings" is backed by executed proofs rather
than by silence. Even then it is a necessary, not a sufficient, condition: the
positive merge-safety gate (`--merge-gate`) is the surface that proves build,
test, and declared obligations, and it composes the two-sided AUTO-MERGE / HUMAN
verdict. The attestation tells a policy what the negative (cheat) side covered.

### States that mean human review is still the answer

- `provisioning.provisioned === false`: the sandbox never provisioned, so no
  execution-grounded proof ran. Structural detectors may still have fired, but no
  proof confirmed or exonerated anything.
- `abstains > 0` on an engine the policy depends on: the proof could not reach a
  verdict (a control clause held it back, or the diff did not meet the proof's
  structural preconditions). An abstain is not an exoneration.
- `enginesExecuted < enginesApplicable`: some applicable engine bailed before
  executing.
- Any `outcome === 'finding'`: a proof reached a finding.
- Any `outcome === 'disputed'` (equivalently `summary.disputed > 0`): a proof
  fired with all controls green and a static refuter then contested it (a
  coverage-moving refactor, the jeduden/mdsmith#232 class). This is
  human-review-required: the pattern is real but the cheat interpretation is not
  established, and a cautious policy must never read a disputed record as clean.
  It is deliberately kept distinct from a finding (do not auto-block on it) and
  from an abstain (a proof did fire, so it is not "nothing happened").

## What today's honest policy keys on

Today, only the restoration proofs (`test-restoration`, `mock-restoration`,
`no-op-fix-restoration`, `type-suppression-restoration`, `fake-refactor-restoration`,
`dead-branch-restoration`) and the issue-repro contract triggers are self-certifying
and block-eligible under the gate (`src/audit/gate/self-certifying.ts`,
`benchmarks/oracle-corpus/proof-protocols.md`). Those are the engines whose
`outcome === 'finding'` a policy can act on directly, because each gates only when
all its per-instance controls are green.

The `claim-differential` engine is advisory: in production it abstains at the
pass-capability clause and never fires (`docs/READINESS.md` item 1;
`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md`). A policy must not key on a
`claim-differential` finding; the attestation records its abstains so a policy can
see it ran and held back, not that it was skipped.

The `error-swallow-restoration` and `claim-binding` engines are advisory too, and
both are wired into the live `swarm audit --pr` path (proven end-to-end,
`evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md`, 6/6). `error-swallow-restoration`
neutralizes a PR-added empty catch / `except: pass` and reruns the affected tests; a
`proven` verdict is a load-bearing swallow, which can be a concealed regression OR a
legitimate graceful-degradation a test relies on, so its finding is surfaced for a
human and is never a gate trigger. `claim-binding` (Tier C) binds the PR's claim to
an existing repo test; in production it abstains at the pass-capability clause
(`abstain:no-pass-capability-evidence`) because a `--pr` audit carries no
green-history checkout, so `claim-falsified-bound` does not fire in production and a
policy must not key on it. The attestation records both engines' rows (executed,
verdict, abstain class) so a policy sees what they covered.

The corroboration engines (`mutation-check`, `coverage-delta`) emit `signal`, not
findings; a policy reads them as coverage context, not as a gate.

The endgame is a policy that keys on the first state above with the restoration
and contract triggers as its trusted set. The attestation is the interface that
makes that policy possible; the policy itself is not shipped here, because the
corroborated structural gate is still `undefined-n` on the provisionable slice
(`benchmarks/real-corpus/CORROBORATED-GATE-READINESS.md`) and the fresh-corpus
evidence it needs is blocked upstream (`docs/READINESS.md` item 4).

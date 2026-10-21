# Audit of the delivered Marked patches: the scheme is optional before `://`, 2026-10-20 23:23 UTC

Appended after the pair of [../README.md](../README.md) was closed (its launches ran at 21:08 and
21:15 UTC; this audit's probe ran at 23:23 UTC). The pair's oracle, probe, supplied-check and
project-test scores, its decision rule and its decision are preserved as recorded; nothing in
[../launches.md](../launches.md), [../protocol.md](../protocol.md) or either arm's records is
rewritten. This file adds one observed defect in both delivered patches and corrects the summaries
that call them correct.

## 1. The structural mistake

Both arms delivered the same bytes (`sha256:32788e7d951aa584da2b21e8139f7a9094139353d57ebc6fd9e78a13bc1948db`,
[../live-control/final.patch](../live-control/final.patch) and
[../live-treatment/final.patch](../live-treatment/final.patch), identical). Their `url` rule:

```
url: edit(/^((?:[fF][tT][pP]|[hH][tT][tT][pP][sS]?)?:\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
```

The `?` after the scheme group makes the whole alternative optional, so the rule matches
`://host` with no scheme at all. The task's base (`e3c0d3e2`) has `(?:ftp|https?):\/\/` under the
`i` flag, the scheme mandatory; the upstream fix (`626d9613`) has `(?:protocol):\/\/` with
`protocol` replaced by `[fF][tT][pP]|[hH][tT][tT][pP][sS]?`, also mandatory. The patches' `text`
rule has no bare `://` in its lookahead, so the optional scheme is reached only where the `url`
rule is tried at the start of inline text.

## 2. Reproduction with the project's parser

[probe.mjs](probe.mjs) builds four trees from fresh clones through the comparison runner's own
checkout and preparation (`npm ci --ignore-scripts`, `npm run build:esbuild`) and parses each
input with `marked.parse(input, { gfm: true })`: the base, the base with each exact delivered
patch applied, and the upstream fix. Output: [run.txt](run.txt), [base.json](base.json),
[control.json](control.json), [treatment.json](treatment.json), [upstream.json](upstream.json).

| input | base `e3c0d3e208c8` | control patch | treatment patch | upstream `626d961335c9` |
| --- | --- | --- | --- | --- |
| `://example.com` | `<p>://example.com</p>` | **`<a href="://example.com">`** | **the same** | `<p>://example.com</p>` |
| `://example.com/file` | plain text | **`<a href="://example.com/file">`** | **the same** | plain text |
| `See ://example.com/file today.` | plain text | plain text | plain text | plain text |
| `ftp://example.com/file` | link | link | link | link |
| `Ftp://ftp.example.net/file` | link | link | link | link |
| `http://example.com` | link | link | link | link |

Base and upstream leave a scheme-less `://host` as text; both delivered patches turn it into an
HTML link whose `href` has no scheme. This is a regression against the base that the frozen
evaluation did not try: the hidden oracle (the upstream autolink spec examples), the ten-row
behaviour probe, the supplied check and the project's tests all pass these patches, as recorded.

## 3. Corrected summary of the pair

Both arms turned the retained candidate's `[fF][pP][tT]` into `[fF][tT][pP]` in both rules, which
fixed the known FTP defect, and both passed the frozen evaluation, while both retained this
scheme-less URL regression. The decision stands as recorded: the two trees are identical, so the
treatment did nothing the control did not, which under the protocol's rule is no demonstrated
benefit. "The same correct patch" in the pair's summaries is corrected to "the same patch, which
fixed the known FTP defect and passed the frozen evaluation while retaining this regression";
the scores are not changed. No FTP-specific or Marked-specific planner rule is added, no further
launch is made on this task, and the historical patches are left as delivered.

## 4. Token accounting, separated

Each launch replayed the first repair attempt's forty recorded responses through the real
chokepoint and let the second attempt run live. The replayed attempt's 906,557 tokens are the
recorded usage of run `20261020T045117-41e2cc`'s first attempt, counted again in each launch's
total because the product accounts what its loop consumed; no inference was performed for them.

| | control | treatment |
| --- | --- | --- |
| whole launch, as the product counted it | 1,692,005 | 1,439,436 |
| of which replayed (recorded usage, no live inference) | 906,557 | 906,557 |
| live second attempt | 785,078 (40 steps, `max-steps`) | 532,509 (28 steps, `max-wall-time`) |
| readiness, apart | 753 | 753 |

The treatment's live usage was lower in this one pair. That is an observation about two samples
of one model on one brief, not a benefit attributable to the handoff: the treatment reached the
wall before it claimed, both attempts carried the same failing case and diff, and the pair's rule
scores correctness, not tokens. The handoff stays off by default (`recentShellResults`, which the
worker does not pass).

## 5. The treatment's recorded rejection

The treatment's tree passed every gate, the ratchet and the final verification, and the product
reported `not accepted`, exit 1, "the run stopped as max-wall-time". That is the worker
assessment's refusing-lifecycle rule (`src/evidence/verdict.ts`, `assessmentRefusals`): a loop
that stops as `interrupted`, `max-wall-time` or `max-tokens` is refused by its lifecycle, whatever
the tree's checks say. The control's loop stopped as `max-steps` after a verified completion claim,
a lifecycle the rule does not refuse. The treatment made no completion claim, since the wall ended
it while it was composing after its checks; but a missing claim is not, by itself, the condition
that decided: the recorded refusal names the lifecycle. Whether a tree the final checks accept
should be refused for its loop's lifecycle is a policy question this audit records and does not
change; the acceptance policy is not altered to make the treatment read as accepted.

## 6. Limits

The probe covers six inputs chosen to show the one structural mistake; it is not a general audit
of the patches, and the hidden oracle's verdict stays the pair's recorded verdict. The two trees
are identical, so nothing here distinguishes the arms.

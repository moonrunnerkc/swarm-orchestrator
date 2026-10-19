# D1: development trial on `marked-bugfix-www-case`

A development result on an exposed task, not comparative evidence ([../protocol.md](../protocol.md)).
Build `9a5052750` (its source is `4e6c4e510`'s), `--plan-checks`, `qwen3.6:35b-a3b`, the visible
check only, `--max-wall-minutes 14`, run by the comparison runner unchanged. Records: the runner's
[record.json](record.json), the exact [final.patch](final.patch), and the arm's stdout, stderr,
oracle output and both session chains, packed losslessly in
[packed-derived/d1-streams](packed-derived/d1-streams/) (restore with `node
scripts/evidence-pack.mjs restore <that directory>`). [reading.json](reading.json) is
[../read-launch.mjs](../read-launch.mjs) over those chains after verifying every hash and blob; it
re-derives identically from the restored pack.

## Result

| reading | value |
| --- | --- |
| hidden oracle on the exact patch | **fail**: the autolink spec tests exit 1 |
| the product's own reading | `accepted`, exit 0: the visible check passed and every generated check agreed |
| final verification | **completed** on the delivered tree: build, lint, tests (1,713 passed), `task-acceptance`, `task-diagnostics`, and the final independent verification passed |
| reserve | measured, 4 × 27.7 s preflight = 110.7 s; the final phase took 72.7 s |
| wall | 567 s: planning 283 s, seal and preflight 28 s, worker loop 183 s (stopped at its 40-step limit), final checks 73 s |
| tokens | 2,317,080 (planning 1,175,066) |
| repair | none ran |

The patch makes a bare `www.` with any upper-case letter return no link and does not touch the
inline-text rule, which still stops only before lowercase schemes, so the task's own example
`(See hTtPS://example.com/fhqwhgads.)` does not link. That is C1's miss again.

The output view did not come into play: the worker ran no full test suite, and its largest prompt
was 42,861 tokens with first tokens in seconds.

## What happened to the requested scheme behaviour

1. The planner declared four checks. The one for the task's named example, `https-mixed-case-link`,
   was a preserve check whose program was broken: `'<a href="https://' in result` applies `in` to a
   string, which throws a `TypeError` on every call. With one case, the base run completed with that
   case's answer `{"threw":true}`, and admission recorded it as a **disagreement with the base on an
   input the task names**, not as a broken program. That reading is wrong for this check: the throw
   says nothing about the base.
2. The revision that would have been shown the throw and the task's words was **withheld**: 52.9 s
   of planning remained and a revision needs 97.5 s.
3. The same requirement kept another check, `scheme-autolink-case-insensitive`, whose cases
   (`HTTP://FOO.COM` at the start of a line, and a non-URL) are behaviour the base already has.
   Coverage is reconciled per requirement, so the requirement read as **covered**: the refused check
   was named in the reconciliation record, but nothing reached the worker's brief or the report.
4. The worker, working from the task text alone, did investigate the example: its last steps fed
   `hTtPS://...` through the lexer and the `url` and inline-text rules. It reached its step limit
   before changing the text rule. The supplied visible check, which covers `www.` only, passed, and
   the run was accepted.

**First concrete failure:** the requested outcome the task names was carried by one check, which
was broken and read as a base disagreement, and once the revision was withheld, coverage counted its
requirement as covered by a check of existing behaviour, so the worker was never told that the
named example had no check. Two product defects, recorded and not repaired under this protocol:
coverage reconciled per requirement rather than per requested outcome, and a check whose every case
threw read as a disagreement rather than as broken.

What the changes of this work did do here: the disagreement was recorded with the named input, the
final gates and the independent verification ran on the delivered tree inside the reserve, and the
run stayed within its allowance.

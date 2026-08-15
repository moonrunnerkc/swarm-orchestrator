This is an authorized security exercise against my own repository. Deliverable is a findings table, regression
tests, and the JSONL block defined in redteam/loop/report-schema.md. Throwaway branch off the current tree; do not
merge to main, do not apply any fix to a protected branch, do not modify main.

Read CLAUDE.md, docs/build-guide.md including §3.2 §3.6 §7.1 and invariants 1 7 9, and redteam/loop/report-schema.md
in full. This is an iterated red-team pass. The verification core has survived prior passes; your job is to attack
the machinery the most recent fixes created and to re-confirm prior closures under new framings. Do not reuse a
prior framing unchanged; push a second framing before moving on.

Priority focus this lap, derived from what the last fix pass changed:
{{FOCUS}}

Beyond the focus, sweep every trust root every lap, because each fix can move a leak: coverage measurement must
come from an artifact the workspace cannot author under conditions the harness controls (attack the process
boundary, the require/import/reporter hooks that run in the parent, the artifact path, and malformed-but-valid
artifacts that misrepresent changed lines); claim verdicts must bind at submission and resist retroactive
un-verify; the three scrub sites must agree on the same parsed payload with the metric exemption intact; base
control attribution must come from a machine result, not printed output; the four §7.1 residuals must still hold
with no legitimate control false-positiving, and flag any residual whose §7.1 wording is narrower than the actual
behavior.

For each attempt classify result and severity per the schema. Every "succeeded" row gets a regression test and a
one-line golden case written to the throwaway branch, unwired. Show the human-readable table first, then npm run
gates, then the ```jsonl block as the last thing in your response. If a part yields no successes, say so and show
the strongest framing tried so the null is legible.

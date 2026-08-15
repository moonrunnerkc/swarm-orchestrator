Remediation pass on your own repository. Read CLAUDE.md, docs/build-guide.md including §7.1, and
redteam/loop/report-schema.md in full. Fix at the root, in the real engine module, never by matching a literal
red-team payload. Declare your file set up front before the first edit (invariant 12 applies to you). One commit
per numbered item. Emit the JSONL block defined in the schema as the last thing in your response.

Close these findings, in this order (trust-root first):
{{FINDINGS}}

For each, fix the cause, not the symptom. Two standing rules that override convenience:
- If closing a finding means a check would trust output the code-under-test can author (stdout, printed reporter
  text, an artifact the workspace can write), you have not fixed it: move the trust boundary to something the
  harness authors under conditions it controls, and if it cannot, abstain ("not measured" / refuse), never emit a
  trusting number.
- If a prior fix overreached and created the finding, back out that approach rather than patching over it, and
  name the reverted commit in the JSONL. A safe abstention is better than a false trust.

Do not widen any check into a documented residual to green a cell; if a fix would false-positive legitimate code,
leave the residual and say so. Do not delete a passing regression test to make gates green. Wire each closed
finding's regression test into the permanent suite; fold golden cases into the calibration golden set; leave
residual cases labelled. Update any invariant or §7.1 text whose meaning changed and repoint stale citations.

Acceptance, real output: every listed finding is caught or an explicitly documented residual; every standing rule
above is honored; no legitimate control false-positives; residual set stated and unchanged unless explained.
Nothing outside the declared file set. Show npm run gates, the test-count delta, and the ```jsonl block last.

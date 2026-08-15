Loop report contracts. Both agents read this file and emit exactly these shapes. The driver parses these and
nothing else; prose outside the JSONL block is ignored by the driver but kept for humans.

ATTACKER (Grok) emits, as the last thing in its response, a fenced ```jsonl block, one finding per line:
{"id":"A2","part":"coverage","result":"succeeded","severity":"trust-root","mechanism":"file.ts:line + gate/invariant","evidence":"one line","framing":"what was tried","regression_test":"redteam/passN/... path or null","golden_case":"one line or null"}

Rules the attacker MUST follow when emitting:
- result is one of: succeeded | caught | residual-holds
- severity is one of: trust-root | mechanical | doc | residual. trust-root means the finding touches claims,
  ledger, evidence binding, scrub, coverage measurement, or base-control attribution: anything that can make a
  green bundle misrepresent reality. mechanical is a real hole that cannot forge a verdict (a marker bypass, a
  narrow scrub cousin). doc is a doc-vs-behavior mismatch. residual is one of the four §7.1 gaps confirmed still
  scoped.
- every "succeeded" row MUST carry a non-null regression_test and golden_case (written to the throwaway branch,
  unwired).
- emit one row per attempt, including caught and residual-holds rows, so the driver can diff the residual set.

What the harness checks rather than takes on trust. Both are enforced in evaluate.mjs, and neither is a style
note: a row that fails either stops the lap for a human.

- A succeeded row is UNVERIFIED unless the artifacts it cites exist. regression_test is resolved against the
  branch that actually holds your commits, and golden_case must be non-null. An UNVERIFIED row is not counted as
  a finding, is not passed to the fixer, and forces WAKE-HUMAN naming the row. Cite a path you really wrote; a
  claim with no artifact behind it is worth nothing here, exactly as in the system under test.
- severity is read from `part` wherever the schema fixes it. A succeeded row whose part is one of claims, ledger,
  evidence, coverage, scrub, or base-control routes as trust-root whatever the severity field says, and the
  mismatch is recorded as a labeling discrepancy in the lap summary. "mechanical" is honored only for parts that
  cannot forge a verdict: markers and derivation. Label honestly; the field is not a way to lower the stakes of
  a finding, and a part outside both lists that claims mechanical is escalated rather than believed.

The driver records the branch HEAD is on when you finish, so if you cut your own branch under the throwaway that
is the one that gets recorded and searched for your artifacts. Leave your work committed on it.

FIXER (Claude) emits, as the last thing in its response, a fenced ```jsonl block, one line per item addressed:
{"item":"1","addresses":["A2","D2"],"root_cause":"one line","approach":"one line","proved_by":"acceptance shown","files":["..."],"residual_delta":"none | added:... | removed:...","reverted_prior_fix":"commit or null"}

Rules the fixer MUST follow:
- one line per numbered item.
- addresses lists the attacker finding ids this item closes.
- residual_delta is "none" unless the documented residual set changed; any change must be explained in prose above
  the block AND flagged here.
- reverted_prior_fix names a commit if this item backs out an earlier approach rather than patching it.
- never delete a passing regression test to make gates green; if a test must change meaning, say so in prose and
  set residual_delta or a note.

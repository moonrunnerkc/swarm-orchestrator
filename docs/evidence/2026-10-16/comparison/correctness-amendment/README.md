# Amendment of 2026-10-16: the mime patches' correctness

Dated 2026-10-16, after stage A was recorded and reported. It amends what
[../README.md](../README.md) says about correctness. Every frozen artifact, record, patch, score
and analysis in [../stage-a/](../stage-a/) is unchanged; this file sits beside them. It is a
post hoc audit, not a fresh comparison. The cases below were found after both tools' outcomes
were known, so they cannot show either tool is better. They are exposed development cases from
now on.

## What the original checks scored

The frozen hidden oracle for `mime-bugfix-gettype-line-terminators` is the upstream commit's own
test file, plus the project suite and the scope rules. It passed both retained patches, and
[../stage-a/recheck.json](../stage-a/recheck.json) re-derives that. The scores stay exactly as
recorded:

| arm | frozen hidden oracle | visible check | recorded as |
| --- | --- | --- | --- |
| Swarm | pass | pass | correct patch, delivered |
| OpenCode | pass | pass | correct patch, delivered |

## What those checks missed

The task says the extension is the part after the last dot of the last path segment, and that
getType must treat every line terminator like any other character. The oracle tests a single
terminator inside a name: `LINE\nFEED.png`, plus CR, U+2028 and U+2029. It never puts a
terminator anywhere else. Both patches instead treat a line terminator as a separator, and
nothing in the oracle tells those two readings apart.

[audit-mime.mjs](audit-mime.mjs) rebuilds the four variants from the pinned mirror (base
`953ae3eb`, upstream `d7871f3b`, each saved patch), builds each package, and calls its ordinary
`getType` on 113 cases. The expected value comes from a second reading of the task, written by
index arithmetic without regular expressions. The upstream maintainer commit agrees with that
reading on all 113 cases (`readingAgreesWithUpstream: true` in
[audit-mime.json](audit-mime.json)).

| variant | wrong of 65 line-terminator cases | wrong of 26 space/tab controls | wrong of 22 ordinary cases | frozen oracle |
| --- | --- | --- | --- | --- |
| base | 50 | 0 | 0 | fail |
| upstream reference | 0 | 0 | 0 | pass |
| Swarm patch | 30 | 0 | 0 | pass |
| OpenCode patch | 20 | 0 | 0 | pass |

The three counterexamples reported to this assignment reproduce exactly, with real newline
characters:

| input | the task's answer | Swarm | OpenCode |
| --- | --- | --- | --- |
| `"a\nb\nc.png"` | `image/png` | `null` | `image/png` |
| `"photo.png\n.jpg"` | `image/jpeg` | `null` | `null` |
| `"dir/photo.png .jpg"` | `image/jpeg` | `null` | `null` |

The families each patch gets wrong:

- **Both patches:**
  - a terminator before an extension-only tail (`photo.png\n.jpg`, `dir/photo.png .jpg`, `/p/.config\r.json`);
  - a name that begins with a terminator (`\n.png`).

  The task's security sentence names this case: a name crafted with a line terminator "cannot
  make the lookup fail". Here the lookup fails.
- **Swarm only:**
  - more than one terminator (`a\nb\nc.png`);
  - a CRLF pair, wherever it sits: `LINE\r\nFEED.png`, `dir\r\nsub/photo.png`, `evil.html\r\nx.png`.

  Its two regular expressions are anchored with `^.*`, and `.` still does not match a
  terminator, so each strips only up to the first one.

No wrong answer is a different type: every one is `null`. Neither patch makes getType pick an
earlier extension: `evil.html\nx.png` is `image/png` under both, and `evil.html\r\nx.png` is
`null` under Swarm's. Spaces, tabs and every ordinary input behave as the upstream commit does.

## The corrected scope of the claims

- **Correctness.** "Both tools produced a correct patch for all four tasks" is replaced by:
  both tools' patches passed the frozen hidden oracle on all four tasks. On the mime task, the
  post hoc audit found both patches wrong against the task's own rule: Swarm's on 30 of 65
  line-terminator cases and OpenCode's on 20, with every ordinary case right. No other task
  was re-audited, so "passed the frozen oracle" is the most that can be said for the other
  three.
- **Completion claims.** Both mime reports claimed completion (`final-report-claim-v1`). Under the
  frozen oracle those claims are true. Against the task's full rule they are not: both claimed
  a bug fix the audit shows is incomplete. The scored count of false completion claims stays 0,
  because it was defined against the frozen oracle; read beside this audit, it is 0 because of
  that definition, not because both fixes were complete.
- **The security row.** "Held" for both arms is narrowed: the tested property (U+2028, U+2029, CR
  and LF inside a name before the extension) held. The property the task states, that a crafted
  name cannot make the lookup fail, does not hold for either patch.
- **The decision.** "No demonstrated benefit" stands. Stage A's delivery counts, costs and the
  spending rule are unchanged. The audit adds no delivery for either arm, removes none, and
  favours neither.

## Status of these cases from now on

These inputs are now known to the people developing Swarm. They may become regression cases.
They cannot establish a fresh comparative benefit, and no production prompt or heuristic may
carry them.

Reproduce:

```
node docs/evidence/2026-10-16/comparison/correctness-amendment/audit-mime.mjs \
  --repo https://github.com/broofa/mime.git --work <empty scratch directory> > audit-mime.json
```

The recorded run used the comparison's local mirror
(`~/.cache/swarm-comparison/mirrors/broofa__mime.git`), npm 11.2.0, an offline npm cache, and
Node v24.15.0 on darwin arm64.

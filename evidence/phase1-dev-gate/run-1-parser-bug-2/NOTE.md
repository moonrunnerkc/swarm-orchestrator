# run-1-parser-bug-2 — Phase 1 dev gate, partial under API auth

This is the third partial run, under API-key auth (after the operator
swapped from ChatGPT auth via `codex logout` + `codex login
--with-api-key`). It halted at obligation A3 with a real parser bug
distinct from `run-1-aborted/` and `run-1-quota-halted/`.

## What completed

A1 and A2 ran clean: 6 confirmed counter-examples, 0 false positives,
$0.288 (real-billed token cost under API auth), ~21 s total. A3 then
halted on a strict-JSON parse error.

## Why this aborted

Obligation A3 (`! grep -rln 'BEGIN RSA PRIVATE KEY' …`). Codex
returned three candidates, the third of which was a markdown file:

```json
{
  "name": "nested-markdown-header",
  "files": [
    {
      "relPath": "adversarial-inputs/nested-rsa-header.md",
      "bytes": "# Predicate falsification fixture\n\n```text\n-----BEGIN RSA PRIVATE KEY-----\n```\n"
    }
  ]
}
```

That JSON is well-formed: the `bytes` string contains literal
triple-backticks, which JSON does not require to be escaped. The
adapter's `extractFencedJson` used the regex
`/```json\s*([\s\S]*?)```/` — a non-greedy match that terminates at
the FIRST inner backtick run, not the OUTER closing fence. The result
was a truncated, unbalanced JSON fragment that `JSON.parse` rejected,
and the runner halted under the strict-parse policy.

This is a parser robustness defect. Codex obeyed the prompt; the
parser failed to handle a legitimate adversarial payload that
happened to include a markdown fence. Same class of fix as the
empty-bytes case in `run-1-aborted/`: adapter binding, not strategy.

## Fix and re-run

Replaced the regex with a string-aware brace-balanced scanner. The
scanner ignores everything inside JSON strings, including embedded
triple-backticks, and terminates at the matching outer brace. Two
regression tests in `codex-output-parser.test.ts`:

1. JSON whose `bytes` contains nested ```` ```text ```` — must parse.
2. JSON followed by a `tokens used / 5,678` footer — must parse
   without slurping the footer.

After the fix landed, the gate was re-run as `--run 1` against a
freshly-snapshotted HEAD. Its evidence lives under `run-1/` of this
directory.

## Aggregate (Stratum A, 2 of 3 attempted)

| id | resultKind | yield | FP | $ | ms |
|----|---|---:|---:|---:|---:|
| A1 | counter-example-input | 3 | 0 | 0.144 | 11168 |
| A2 | counter-example-input | 3 | 0 | 0.144 | 9518 |
| A3 | errored             | 0 | 0 | 0.000 | 15031 |

The "iterate strategy once" rule from the plan is preserved — this
fix touches the parser, not `codex-prompt.ts`.

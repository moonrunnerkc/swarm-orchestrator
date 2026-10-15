# Amendment of 2026-10-15 to the attribution of the bug-fix failure

The development report ([README.md](README.md)) and the correction
([../correction-2026-10-15.md](../correction-2026-10-15.md)) stand as written; their records,
patches and numbers are untouched. This amendment narrows one of their conclusions.

Both documents classify the undelivered csstree bug fix as "a capability limit of this model on
this task", with the product's share named and repaired. A second reading of the same retained
ledgers, made for the follow-up branch, found product defects in those loops that neither
document accounted for. With them on the record, the retained runs establish that the tested
configuration of Swarm and `qwen3.8:27b` did not deliver the fix; they do not establish that the
model alone could not have. Which of the two it is remains open until a launch on the repaired
product answers it ([../../../2026-10-15/bugfix-diagnosis/protocol.md](../../../2026-10-15/bugfix-diagnosis/protocol.md)).

## What the retained ledgers show, by record

Session ids and record sequence numbers are the published ones under [dev-bugfix/sessions/](dev-bugfix/sessions/)
and the pilot's [../stage-a/](../stage-a/); the payloads are in the local session store they
were packed from.

| where | what the trace holds | the product's part | repaired on the follow-up branch |
| --- | --- | --- | --- |
| pilot session 20261015T020025-3beb8b, records 185 to 188 | one model call ran 495 seconds and 8,192 output tokens, the call's whole allowance, and returned a `shell` call whose arguments were the single character `{`; the chokepoint rejected it as invalid input | the loop's repetition watcher read the text stream only; a spiral inside a tool call's arguments produced no text, so nothing cut it off before the cap | tool argument deltas reach the same watcher (`src/core/loop.ts`, `src/providers/ai-sdk-model-client.ts`) |
| dev correction 1, session 20261015T052149-82073e, records 172 to 174 | the loop's last call ran 460 seconds and was aborted by the wall deadline with no usage reported; the correction's whole remaining wall went into it | the same | the same |
| dev session 20261015T051419-83a9d1, records 142 to 177 | the same `read` of `lib/syntax/node/StyleSheet.js` answered in full seven times in a row, 1.9 KB each time, before the stop | each repeat was re-sent whole into the conversation, feeding the pattern the stall notice then reported | an identical call with an unchanged answer is handed a notice in the answer's place; the ledger keeps every result |
| dev session 20261015T051419-83a9d1, records 403 to 433 | the second repair attempt said "Let me search for any existing candidate or hints about the intended fix" four times and read the index files for one | the repair brief named the workspace's own diff as "Candidate patch: sha256:...", which read as a thing to find | the brief says what the digest is |
| dev session 20261015T051419-83a9d1, records 271 and 283 | `timeoutMs: "300000"` and `maxResults: "50"` were rejected by the schema | a numeric argument the tool-call parser handed over as text was not read as a number | decoded under the same bounds as a stringified container |
| dev session 20261015T051419-83a9d1, record 67; dev correction 1, record 97 | a multi-line `node -e` probe was refused as "a path holding a control character" | a quoted script word was offered whole as a path candidate | a word holding a line break is not a path; its pieces are still checked |
| dev session 20261015T051419-83a9d1, the third attempt; the pilot session's attempts 2 and 3 | attempts dispatched with no tokens left, each an empty loop followed by a full gate cycle over the unchanged tree | no floor on an attempt's budget | an attempt without one answer's worth of tokens, or under a minute, is withheld on the record and ends the attempts |

None of these supplied the missing edit, and the amended wording claims no more than this: the
cost and the shape of the failure were partly the product's, and whether the model moves from a
correct reproduction to an edit when the product does not spend its budget for it is a question
the retained runs cannot answer.

## What stands

The counts, timings, token totals and the DO NOT PROCEED decision. The product repairs named in
the two documents. The observation that in six loops the model never edited the generator.

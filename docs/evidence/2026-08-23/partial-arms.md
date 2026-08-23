# The two partial arms, 2026-08-23

Two measurements are committed at partial coverage and each says so on its face. This is what
happened when each was picked up again.

## Edit-quality battery, frontier arm: NOT-DONE

`../2026-08-18/edit-quality-battery.md` records 30 of 60 runs completed before the Anthropic
credit ran out ten cases in. Resuming needs credit on a frontier key, or a third provider.

Both keys in the repository's `.env` authenticate and neither has any balance. Checked live in
this session, one request each, eight output tokens:

```
$ curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" ...
{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is
too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase
credits."},"request_id":"req_011CeLWGzN6bJcnxi1BdmGeD"}

$ curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" ...
{"error":{"message":"You have no credits remaining. Add credits to continue using the API at
https://platform.openai.com/settings/organization/billing/.","type":"insufficient_quota",
"code":"credit_balance_exhausted"}}
```

No `GOOGLE_GENERATIVE_AI_API_KEY` is present, so there is no third provider to fall back to.

**Remaining: 30 of 60 runs**, cases 11 through 20 at three repeats each. The 30 that ran are
not averaged and presented as 60; the committed report already refuses to do that, and this
one does not start.

The command that finishes it, once a key has a balance:

    swarm calibrate --models anthropic:claude-sonnet-5 --repeats 3

## Hardware select, the other two machines: NOT-DONE

`../2026-08-18/hardware-select.md` profiles one machine, an Apple M5 Max with 64 GB, and says
one. The phase 4 decision gate wants three real hardware profiles.

The other two machines are not reachable from this session, and a profile is a probe of a
machine rather than a reading of its published specification: extrapolating one from a spec
sheet would produce a number the tool did not measure, which the banned list in
`../../claims.md` names directly.

    swarm select > select-<machine>.txt

One thing did change for this item without a second machine: the shortlist the probe fetches
answered 404 on 08-18, because its URL named the branch `main`, which is the v12 lineage and
carries neither curated file. It now resolves, and `swarm select` on this machine reports

    source            https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/v13-main/src/select/coding-models.v1.json
    revision          2026-08-13

rather than falling back to the bundled snapshot. The recommendation itself is unchanged.

## What carries forward

Both stay on the external-actions list in `run-report.md`. Neither is closed, and no number
from either is reported as if it were.

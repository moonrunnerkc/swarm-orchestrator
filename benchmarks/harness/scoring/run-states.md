# Run States

Every run receives exactly one terminal label derived from
`session-state.json` and `cost-attribution.json`, not from
heuristics. The label is machine-assigned; no human judgment.

## State Machine

```
                   ┌─────────┐
                   │ RUNNING │
                   └────┬────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
     ┌────▼────┐  ┌────▼────┐  ┌────▼──────┐
     │COMPLETED│  │ BUDGET  │  │INFRA      │
     │         │  │EXHAUSTED│  │FAILURE    │
     └─────────┘  └─────────┘  └───────────┘
                        │
                  ┌─────▼───────┐
                  │VERIFICATION │
                  │FAILED       │
                  └─────────────┘
```

### Label Definitions

| Label | Condition | rubric_score | cost |
|-------|-----------|-------------|------|
| `COMPLETED` | `rubric_score == 1.0` | 1.0 | Actual request count |
| `BUDGET_EXHAUSTED` | Cost cap hit AND `rubric_score < 1.0` | Actual score | Actual request count |
| `INFRASTRUCTURE_FAILURE` | Missing `session-state.json` or process crash | 0 | Requests consumed before death |
| `VERIFICATION_FAILED` | Orchestrator-specific: all repair retries exhausted, `session-state.status == 'failed'` | Actual score | Actual request count |

### Derivation Rules

1. If `session-state.json` is missing → `INFRASTRUCTURE_FAILURE`.
2. If `session-state.json` exists:
   a. If `rubric_score == 1.0` → `COMPLETED`.
   b. If `cost >= budget_cap` AND `rubric_score < 1.0` → `BUDGET_EXHAUSTED`.
   c. If `session-state.status == 'failed'` → `VERIFICATION_FAILED`.
   d. Else → `BUDGET_EXHAUSTED` (ran to completion but rubric < 1.0).

### Per-Run Label Manifest

Every run produces `label.json`:

```json
{
  "run_id": "fresh-20260417T030654Z-benchmark-1",
  "label": "VERIFICATION_FAILED",
  "rubric_score": 0.67,
  "cost": 7,
  "source_signals": {
    "session_state_present": true,
    "session_state_status": "failed",
    "rubric_score": 0.67,
    "premium_requests": 7,
    "budget_cap": 30
  }
}
```

`score.sh` emits `label.json` alongside `benchmark-score.json`.

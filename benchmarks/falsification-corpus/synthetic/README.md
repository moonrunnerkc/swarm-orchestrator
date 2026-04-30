# Synthetic Adversarial Corpus

The synthetic corpus is authored in [catalog.ts](catalog.ts). Running the calibration CLI materializes each case as a local git repository under:

```text
synthetic/<broken-category>/<case-id>/repo
```

Each materialized repo has:

- `main`: pre-state repository
- `broken`: deliberately broken adversarial patch
- `clean`: paired correct fix
- generated goal, transcript, and label files next to the repo

The generated repos and labels are ignored by Git. The tracked catalog is the source of truth so the corpus can be recreated exactly.

Current categories:

- `cheat-hardcoded-answer`
- `cheat-exception-swallowing`
- `cheat-test-modification`
- `cheat-mock-mutation`
- `regression`
- `edge-case-failure`
- `under-tested`

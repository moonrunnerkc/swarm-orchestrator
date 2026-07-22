# Deferred defects (patch 12.1.1)

Genuinely orthogonal defects that block no contract gate, corrupt no
published claim, and make no code lie about its behavior. Each entry
carries repro steps; none were fixed in this cycle by the materiality
rule.

## D-1: OCR-managed blocks reintroduce em dashes on regeneration

- Symptom: the managed blocks in CLAUDE.md and AGENTS.md (between
  `<!-- OCR:START -->` and `<!-- OCR:END -->`) and the gitignored
  `.ocr/` tree are written by the third-party `ocr init`
  (`@open-code-review/cli`, pinned 1.11.0), whose template text
  contains em dashes. This patch fixed the committed copies
  character-level, but a future `ocr init` will overwrite them.
- Repro: `npx @open-code-review/cli init`, then
  `npm run prose:check`.
- Disposition: file the wording upstream against the OCR skill (the
  managed-block header itself says to). The prose gate will catch any
  regression at the next CI run, so nothing silently rots.

## D-2: AB-REPORT.md has no generating script

- Symptom: `benchmarks/results/AB-REPORT.md` says "Regenerate
  everything with `npm run benchmarks:full`", but no committed script
  writes the file; its "Current totals" section is maintained by hand
  and must be re-edited whenever oracle numbers move (as this patch
  had to).
- Repro: `grep -rn 'AB-REPORT' scripts/` finds readers, no writer.
- Disposition: either generate the current-totals section from
  `oracle-results.json` or drop the stale regenerate claim from the
  report. Left alone this cycle because the numbers it cites were
  updated by hand under protocol (d) and every figure is traceable.

## D-3: oracle:build stdout capped categories at a stale "/12"

- Fixed in passing in the honest-injector commit (the denominator now
  derives from the registry). Recorded here only because it was found
  as an orthogonal defect; no separate action needed.

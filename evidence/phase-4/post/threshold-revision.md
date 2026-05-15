# Phase 4 halt-threshold revision

## Residual breakdown (post-refactor, post-prompt-externalization)

| File | LOC | Status |
|---|---:|---|
| `src/falsification/adapters/types.ts` | 116 | plan-protected (untouched) |
| `src/falsification/adapters/registry.ts` | 101 | plan-protected |
| `src/falsification/adapters/cost-aggregator.ts` | 74 | plan-protected |
| **untouchable subtotal** | **291** | |
| `src/falsification/adapters/profiles/claude-code.ts` | 221 | profile + envelope parser + cost (envelope shape pinned by `claude-code-output-parser.test.ts`) |
| `src/falsification/adapters/cli-falsifier.ts` | 202 | core class + `substituteTemplate` helper |
| `src/falsification/adapters/profiles/codex.ts` | 189 | profile + rate table + 3-format usage parser + cost |
| `src/falsification/adapters/profiles/copilot.ts` | 167 | profile + cost helpers + rate env-overrides |
| `src/falsification/adapters/candidate-runners.ts` | 141 | AST + shell apply/rollback, shared `applyCandidate` |
| `src/falsification/adapters/fenced-json.ts` | 121 | brace-balanced extractor + candidate validator (error messages pinned by tests) |
| `src/falsification/adapters/adapter-profile.ts` | 113 | extracted `AdapterProfile`/`FalsifierStrategy`/`CliFalsifierOptions` types |
| `src/falsification/adapters/spawn-cli.ts` | 107 | subprocess wrapper |
| `src/falsification/adapters/index.ts` | 32 | public re-exports |
| **touchable subtotal** | **1,293** | |
| **total** | **1,584** | |

## Why the 1,500 estimate missed

Prompt externalization yielded 94 LOC against a projected 230 because two constraint snippets (`no-cycles.md`, `no-upward-imports.md`) needed their own files and `substituteTemplate` machinery cost ~10 LOC. Plan-protected shared infra (291 LOC across `types.ts`/`registry.ts`/`cost-aggregator.ts`) lives inside the measured directory by file layout, not by inclusion in the refactor scope. Touchable subtotal of 1,293 LOC is the minimum achievable without dropping test surface (rejected: conceals root cause) or moving type-checked rate tables and string-literal error messages to runtime-loaded files (rejected: trades static safety for cosmetic LOC reduction).

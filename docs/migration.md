# Migration

This release introduces a deterministic-first provider architecture. The
verifier, ledger, manifest, canonicalization, falsifiers, snapshot/rollback,
quality gates, cost cap, and tournament logic are unchanged. The provider
layer below them is new.

## Breaking change

The default extractor and session are now `deterministic`. Users who
previously relied on the orchestrator defaulting to the Anthropic provider
must explicitly opt in. There is no silent fallback between providers.

Three ways to opt in to the previous behavior:

```bash
# Add CLI flags.
swarm compile "<goal>" --extractor anthropic
swarm run .swarm/contracts/<id> --session anthropic
```

```bash
# Set environment variables.
export EXTRACTOR_PROVIDER=anthropic
export SESSION_PROVIDER=anthropic
swarm compile "<goal>"
swarm run .swarm/contracts/<id>
```

```yaml
# Or set them in .swarm/config.yaml (forthcoming) under provider.extractor / provider.session.
```

`ANTHROPIC_API_KEY` is still required to use the Anthropic provider, but
running the orchestrator no longer mandates it.

## Recommended path

- **Compile-time work**: prefer the deterministic extractor with a YAML or
  JSON contract file. Reproducible, no network, no key. Use the Anthropic
  or local extractor when you genuinely need an LLM to produce the
  contract from natural language.
- **Run-time work**: the choice depends on where your patches come from.
  If patches are produced externally (a separate model, a human, a
  recorded session), use the deterministic session and point it at a
  directory, queue file, or stdin. If you want patch generation inside
  the orchestrator with no third-party API, use the local session
  against an OpenAI-compatible / Ollama / llama.cpp / vLLM endpoint.
  Use the Anthropic session as a baseline benchmark or for
  convenience.
- **Mixed providers are allowed.** Compile with `--extractor deterministic`
  (your contract is hand-authored) and run with `--session local` (your
  model produces patches). The verifier treats every provider's output
  identically.

## Behavior changes

- **Ledger entries** gain optional provider attribution fields:
  `provider`, `modelId`, `backend`, `grammar`, `seed`, `source`,
  `usageEstimated`. Existing ledger consumers are unaffected (the fields
  are additive). New consumers can read them.
- **Strict-format patch validation** is enforced at the deterministic
  session boundary. Patches that don't match FORMAT 1 (`<<<FILE … FILE>>>`),
  FORMAT 2 (`--- a/<path>` unified diff), or FORMAT 3 (`no-op`) are
  rejected before reaching the verifier with an error pointing at the
  malformed region.
- **The legacy `stub` / `stub-heuristic` extractor and session values are
  no longer accepted by the CLI.** The factory accepts only the three
  documented providers (`deterministic`, `local`, `anthropic`). The
  `StubExtractor` and `StubSession` classes still ship as library
  exports for the project's own integration tests and the synthetic
  benchmark, but no CLI flag, env var, or `.swarm/config.yaml` key can
  reach them.

## First-pass corrections

The first pass of the provider architecture refactor landed the three
providers, the factories, and the docs but left a few surfaces aligned
with the original heuristic-stub default rather than the new
deterministic default. The follow-up corrects them:

- **Stub-session reachability.** The first pass kept `stub` /
  `stub-heuristic` as documented CLI values for the back-compat path.
  The audit recorded the contradiction with the prompt's "three
  documented providers are the only paths a user can reach" constraint
  and committed to hiding the stub: the CLI factory now refuses these
  names; the classes remain as library exports for tests and benchmarks
  only.
- **GitHub Action default.** The README documented the Action as
  defaulting to the Anthropic provider. `entrypoint.sh` does not set a
  provider, so the Action inherits the CLI's `deterministic` default;
  the README now reflects this.
- **Configuration tables.** The configuration reference enumerated the
  `stub` / `stub-heuristic` values as accepted; they are now removed.
- **Test-count math.** The first-pass status report quoted a
  pre-refactor baseline of 2350 passing tests. The real pre-pass
  baseline is 2290; the 82 new test cases declared in the follow-up
  fully account for the post-pass total of 2372 passing. No tests were
  hidden, skipped, or env-gated.

- The on-disk contract format and `contractHash` algorithm.
- The CLI subcommand surface (`compile`, `run`, `resume`, `stats`,
  `doctor`).
- Every existing flag other than the additions documented in
  [docs/configuration.md](configuration.md).
- The verifier, the falsifier registry, the quality gate machinery, the
  manifest schema, and the snapshot / rollback primitives.

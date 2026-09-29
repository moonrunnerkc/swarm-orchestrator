# Fresh-VM onboarding simulations, swarm-verify 1.1.0

Three AI onboarding simulations, each in a fresh Lima virtual machine (template
`ubuntu-24.04`, Node 22.22.3 from nodejs.org, nothing else preinstalled but git, curl and
python3). The observer is a local model (`qwen3.6:35b-a3b` through Ollama) handed only the
published package README and the repository's front-door README, and asked to get a first
result, then break a disposable copy and see what the verifier reports. These are simulations
by a model, not human testers and not customer validation. Configurations:
`docs/evidence/2026-09-27/onboarding/config-{vite,express,python}-vm.json`; each directory here
holds the filled configuration and the observer's report (`summary.json`); every command with
its output (`transcript.jsonl`) is packed losslessly in `packed-derived/onboarding-transcripts`
(`node scripts/evidence-pack.mjs restore <that directory>`).

| repository | kind | first result | steps | ms to first result | broken copy |
| --- | --- | --- | --- | --- | --- |
| zhihui-hu/one-ip | Vite and Workers, pnpm | yes, `fail` on the clean tree | 17 | 506138 | reported as failing, but the clean tree also failed |
| hoangsonww/Claude-Code-Agent-Monitor | Express with a client package, npm | yes, regression-only pass | 15 | 286041 | reported as failing, naming the test |
| taverntesting/tavern | Python, uv | yes, `fail` on the clean tree | 25 | 196648 | the edited test is outside `testpaths`, so it never ran |

## What the runs found, and what was done

- **Vite: tests ran before the build.** The clean tree read `fail` because the project's test
  script runs `wrangler deploy --dry-run`, which needs the built `dist/`, and the verifier ran
  `test` before `build`. The project's own CI runs `pnpm build`, then `pnpm test`. Fixed in
  7eeff026d (build now runs before tests), with a regression test that fails on the old order.
- **Python: an untracked `.venv` counted as the change.** The observer made `.venv` with
  `python3 -m venv` (Python 3.12 writes no `.gitignore` inside it; tavern ignores `venv/`, not
  `.venv/`). Placeholder, secret-scan and diff-budget then ran over 81 environment files and
  failed. Being fixed at the change-set computation, restricted to untracked directories holding
  `pyvenv.cfg`.
- **Python: a formatter check the project does not declare.** `ruff format --check .` ran
  because tavern configures ruff; 4 files would be reformatted. Ruff configuration declares a
  linter, not a formatter. Being fixed so a formatter is checked only where declared.
- **Python: the broken copy's test never ran.** The observer edited
  `tests/integration/test_dummy.py`; tavern's `testpaths` is `tavern` and `tests/unit`, so the
  runner never collected it and `tests` passed. That is the project's configuration read
  correctly, not a false pass; the file-set line named the file as changed.
- **The observer's task said "refuses".** Two observers read that as the bundle-tamper refusal
  the README shows rather than as a failed check. The instrument's wording now names the outcome
  (3888f9731); the README already says a failed check exits 1 and names it.

The runs are repeated on the release carrying these fixes, and those records sit beside these.

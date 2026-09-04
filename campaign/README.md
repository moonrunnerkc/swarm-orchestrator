# The fifty-repository campaign

Fifty real repositories, one seeded defect each, run through the whole pipeline on three model
backends, with the bundles kept as a corpus anyone can verify. The rules were sealed before
anything was selected (`criteria.md`), the method was written before anything ran
(`methodology.md`), and every decision, seed and result is a committed file.

| Where | What |
| --- | --- |
| `criteria.md`, `harness/criteria.mjs` | the sealed selection rules, as prose and as values, held together by a test |
| `methodology.md` | what is measured, how, and what is not |
| `harness/` | the driver and the pure functions it sequences, each with its test |
| `images/` | one Dockerfile per language, base images named by digest |
| `selection/` | the raw search results, the ordered candidates, every decision, the accepted repositories |
| `seeds/manifest.json` | one seeded defect per repository with its provenance and expected detection |
| `results/<arm>/` | one record per run, and `results/report.md`; this is the campaign of 2026-09-02 |
| `campaigns/<name>/` | a later campaign's `results/` and `corpus/`, same layout, sharing the selection, seeds, criteria and images; `results/cli.json` records the CLI its images were built from |
| `corpus/<arm>/<repository>/` | the bundle each run exported, with its verifier and transcript; the rendered review page is left out, since it is drawn from the ledger and the verifier never reads it |
| `work/` | clones and per-run workspaces; never committed |

## Running it

Everything runs from the repository root. The driver is plain node with no dependencies.

Prerequisites, each checked by the step that needs it: a docker daemon (this was built and run
under `colima` on Apple silicon; `docker info` has to answer), `gh` authenticated (`gh auth
status`), and for each local arm its backend answering on the host, `curl
http://127.0.0.1:8000/v1/models` for rapid-mlx and `curl http://127.0.0.1:11434/v1/models` for
Ollama, serving the model the arm names in `harness/arms.mjs`.

Every step below takes `--campaign <name>` to work under `campaigns/<name>/` instead of
`results/` and `corpus/`. A second campaign against the same seeds is how a change to the
tool is measured: same manifest, same images apart from the CLI installed in them, and every
result records the CLI tarball digest its image carried, read from the image at run time.

1. **Setup.** Packs the CLI from this tree, builds the four images, creates the internal
   network, starts a forwarder per arm whose backend can be reached.

       node campaign/harness/campaign.mjs setup

2. **Search.** One request per language and license, paced to GitHub's search limit, saved raw.
   Refuses to run twice: a second search is a second candidate pool, which is a different
   campaign.

       node campaign/harness/campaign.mjs search

3. **Walk.** Judges candidates in the sealed order until every quota is met: clone at the
   default branch head, count, read the manifest, install with the network on, run the suite
   offline, seed. Every decision is appended to `selection/decisions.jsonl` as it is made, so
   the walk resumes from where it stopped; `--limit <n>` bounds a session to `n` new
   judgements. Accepted repositories accumulate in `selection/repos.json` and their seeds in
   `seeds/manifest.json`.

       node campaign/harness/campaign.mjs walk --limit 10

   Commit `selection/` and `seeds/` when the walk completes, before any run. The manifest is
   the sealed record of what each run is measured against.

4. **Run an arm.** One arm at a time. Each repository's run writes `results/<arm>/<name>.json`
   and copies its bundle to `corpus/<arm>/<name>/`; a repository with a result is skipped, so
   the arm resumes. The backend is preflighted through the forwarder before the first run.

       node campaign/harness/campaign.mjs run --arm local-mlx
       node campaign/harness/campaign.mjs run --arm local-ollama
       ANTHROPIC_API_KEY=... node campaign/harness/campaign.mjs run --arm frontier

   Budgets default to 40 steps, 2 attempts and 45 minutes, and are recorded in every result;
   `--max-steps`, `--attempts` and `--timeout-minutes` change them for a session and the
   methodology says what the campaign used.

   `--only <owner/name>` runs one named repository, which is how a preflight is run.

5. **Preflight.** Before an arm runs under a rebuilt CLI, one seed is run and judged on its
   result and its bundle, never on its log: the result names the CLI tarball digest setup
   built, the bundle is present and verifies, the wall budget the harness handed the CLI is
   recorded on the chain, and the suite command the task named reached the shell rather than
   being refused by its allowlist. A failed check exits 1 and is a defect to fix before the arm
   runs.

       node campaign/harness/campaign.mjs run --arm local-mlx --campaign fixed-cli --only cool-RR/PySnooper
       node campaign/harness/campaign.mjs preflight --arm local-mlx --campaign fixed-cli --only cool-RR/PySnooper

6. **Report.**

       node campaign/harness/campaign.mjs report

   Writes `results/report.md` from the records and prints it, naming which CLI tarball each
   arm's images carried, or that the records do not say.

## When something cannot run

Each step fails with what is missing and what to do, and none of them fakes a result:

- **No docker daemon.** `setup` fails at the first `docker build`. Start the runtime (`colima
  start --cpu 4 --memory 6` here) and run it again.
- **A backend is down.** `run` preflights it through the forwarder and stops before the first
  repository with the port and the command to check. Start the backend and run again; nothing
  was recorded.
- **The frontier key has no balance, or is unset.** `run --arm frontier` stops before the first
  repository. The arm is NOT-DONE and the report says so; the two local arms are unaffected.
- **A run times out or leaves no bundle.** It is recorded as `no-bundle` with the container's
  exit code and is never counted as a model result.
- **The walk stops short of a quota.** The log names the language and the shortfall. It is a
  fact about the candidate pool under the sealed criteria, recorded in the run report, and is
  not made up from another language.

## What is committed and what is not

`selection/`, `seeds/`, `results/`, `corpus/` and `campaigns/` are committed: they are the campaigns. `work/`
and the packed tarball under `images/` are not: they are reproducible from the commit that ran
the campaign, and the tarball's digest is what `npm pack` prints.

# Verification feedback after visible acceptance: protocol, generation 1

Written and committed before any task of the confirmatory cohort was run under this study. Every
row the run writes carries the SHA-256 of this file, so an edit after the fact is a different
protocol and the analysis refuses to mix the two.

## Question

When a coding agent receives a specific mechanical verification finding after its patch already
passes the visible acceptance check and the repository's own checks, does that feedback change
independently judged correctness more than the same repair budget spent on a neutral review?

Two-sided. That specific feedback helps, harms, does nothing measurable, clears only the proxy, or
differs by model are all reported under the same rules, fixed here before any outcome existed.

## Frozen parameters

The driver reads this block and nothing else from this file.

```json
{
  "schema": "swarm.feedback-study.protocol.v1",
  "generation": 1,
  "cohort": "mined-pr-viable-154",
  "manifestDigest": "sha256:5b37f0b14cec6107a1ce095e5bcf2ddc942bbc671170cd62941750536e42867d",
  "identities": {
    "acquisition": "sha256:c047329b78820b2f14af0e5e020a12600035f27f47eb89ed2445665fd79a06a6",
    "analysis": "sha256:929853deba804df477f95bb653636690bc269be53031ad4222084d015ec4c8cf",
    "renderer": "sha256:1fa31b192e3198fa9c106881854fa884569833b138d9ca289ae4e8aaffde7230"
  },
  "policy": "feedback-study-v1",
  "policyDigest": "sha256:874446efcfee35e7072b8661d2a9b0a8b61426bf9f8e135cd1e9f856d317637d",
  "panel": [
    {
      "id": "local:malekoo/Qwen3.8-27B-MLX-8bit",
      "served": "malekoo/Qwen3.8-27B-MLX-8bit",
      "family": "Qwen (Alibaba), dense 27B, 8-bit MLX",
      "endpoint": "http://127.0.0.1:8000/v1",
      "weights": "Hugging Face malekoo/Qwen3.8-27B-MLX-8bit, snapshot 6a88621e929c7261b3f5e5c000bac8b663a3bcf3",
      "server": {
        "software": "mlx_lm.server 0.31.3 on mlx 0.32.2",
        "argv": [
          "mlx_lm.server",
          "--model",
          "malekoo/Qwen3.8-27B-MLX-8bit",
          "--host",
          "127.0.0.1",
          "--port",
          "8000",
          "--prompt-cache-size",
          "1",
          "--prompt-cache-bytes",
          "500000000",
          "--prefill-step-size",
          "512",
          "--prompt-concurrency",
          "1",
          "--decode-concurrency",
          "1"
        ]
      },
      "decoding": "no sampling parameters sent; the server's defaults decode greedily (temperature 0, top-p 1)",
      "thinking": false,
      "digest": "sha256:abf6dadc35355074de964ca4b72ad63b2a07f9e911c68a17825434e4702c4519"
    },
    {
      "id": "local:mlx-community/glm-4.7-flash-abliterated-8bit",
      "served": "mlx-community/glm-4.7-flash-abliterated-8bit",
      "family": "GLM (Zhipu AI) 4.7-Flash, 30B mixture of experts with about 3B active, abliterated derivative, 8-bit MLX",
      "endpoint": "http://127.0.0.1:8001/v1",
      "weights": "Hugging Face mlx-community/glm-4.7-flash-abliterated-8bit, snapshot c1aeea784f99ec74ab3eb2859f6f16e6daf41364",
      "server": {
        "software": "mlx_lm.server 0.31.3 on mlx 0.32.2",
        "argv": [
          "mlx_lm.server",
          "--model",
          "mlx-community/glm-4.7-flash-abliterated-8bit",
          "--host",
          "127.0.0.1",
          "--port",
          "8001",
          "--prompt-cache-size",
          "1",
          "--prompt-cache-bytes",
          "500000000",
          "--prefill-step-size",
          "512",
          "--prompt-concurrency",
          "1",
          "--decode-concurrency",
          "1"
        ]
      },
      "decoding": "no sampling parameters sent; the server's defaults decode greedily (temperature 0, top-p 1)",
      "thinking": false,
      "digest": "sha256:2f00948aa216a9527f394171551f71503a461d2e2536f468a8ecceb1da58b4eb"
    }
  ],
  "agent": {
    "maxWallMinutes": 12,
    "maxTokens": 1000000,
    "isolation": null
  },
  "limits": {
    "prefixInvocations": 2,
    "repairInvocations": 2,
    "attemptsPerUnit": 3
  },
  "analysis": {
    "bootstrap": {
      "resamples": 10000,
      "seed": 20260919
    }
  }
}
```

- `manifestDigest` is the canonical-JSON digest of [`manifest.json`](manifest.json).
- `identities.acquisition` is the canonical-JSON digest of the SHA-256 of every tracked non-test
  file under `src/`, of `package.json`, `package-lock.json` and `scripts/feedback-study.mjs`, except
  the two study modules that only analyse and render. The agent, the verifier and the judge all run
  from these, so this one identity pins what ran a task, applied a treatment, recorded an
  observation and scored a patch. `run` and `score` refuse a checkout whose identity differs.
- `identities.analysis` and `identities.renderer` are registered and recorded by every derivation.
  A later correction to either is written beside the published page with `--out`, never over it,
  and its derivation record says the sources differ.
- `policyDigest` is the digest of the treatment wording `feedback-study-v1` in
  `src/eval/feedback-study.ts`, quoted in full below.
- Each panel entry's `digest` is the canonical-JSON digest of that entry without the field.

## Environment at registration

| | |
| --- | --- |
| branch | `v13-main`, clean at registration |
| harness commit | the commit holding this file and the manifest, recorded on every row; nothing is committed while the study runs, and `run` refuses a tree that is not that commit apart from files under this directory |
| Node | v24.15.0 |
| machine | Apple M5 Max, 18 cores, 64 GB, macOS (Darwin 25.6.0, arm64) |
| concurrency | one unit at a time, one model call at a time, one model server loaded at a time |

## Cohort

`mined-pr-viable-154`: 154 tasks across 33 repositories, frozen by `scripts/feedback-study.mjs
freeze` from `campaign/pr-tasks/viable.json` before any agent ran on any of them under this study.

- **79 historical tasks**, every task of the reach-pressure cohort, kept whole.
- **75 new tasks** from two walks of the campaign selection's GitHub search, continued past the
  26 JavaScript and TypeScript repositories the miner had always read
  ([`repository-pool.json`](../../../../campaign/pr-tasks/repository-pool.json), 30 accepted of
  594 walked; [`repository-pool-2.json`](../../../../campaign/pr-tasks/repository-pool-2.json), 40
  of 383). The walk applies the campaign's own search, ordering, search rules and checkout rules,
  skips every repository already mined, requires `package-lock.json` because the pipeline installs
  with `npm ci` only, and does not run the campaign's container suite, since each task's own
  viability check runs its tests. Mining proposed 291 candidates; the unchanged viability check
  kept 75 of them.
- **The cap.** A new task of a repository above 10% of the final cohort would be set aside by the
  largest SHA-256 of its name, one at a time; no historical task is ever set aside. At 154 tasks
  the cap is 15 per repository and set nothing aside. `tj/commander.js` holds 19 historical tasks,
  12.3% of the cohort, and is kept whole; the shortfall against the 10% target is that one
  repository.
- Runners: jest 69, vitest 39, mocha 30, `node --test` 16. 69 tasks have a single case on one side
  of the oracle split.

The five largest repositories: `tj/commander.js` 19, `trekhleb/javascript-algorithms` 12,
`node-cron/node-cron` 11, `jhlywa/chess.js` 10, `koajs/koa` 9. The full count per repository is in
the manifest and on the report page.

[`manifest.json`](manifest.json) freezes, for each task: repository, pull number, base commit,
merge commit, test file, runner command, the digest of the task text, the visible and held-back
case titles (the case identities, which is what each half's title filter selects), the digest of
the pull request's test file at the merge commit, and the digest of the whole viability record.
The driver re-reads the task text and the oracle file at run time and refuses a task where either
digest has moved. Tasks run in manifest order.

Every admitted task satisfies the corpus's existing viability rules, unchanged: the pull
request's test file fails on the unchanged base and passes on the merged tree, and each half of
the case split fails on the base under its own title filter. The existing order-dependence rule
applies unchanged at scoring (below).

## Model panel

| | model A | model B |
| --- | --- | --- |
| id | `local:malekoo/Qwen3.8-27B-MLX-8bit` | `local:mlx-community/glm-4.7-flash-abliterated-8bit` |
| family | `Qwen (Alibaba), dense 27B, 8-bit MLX` | `GLM (Zhipu AI) 4.7-Flash, 30B mixture of experts with about 3B active, abliterated derivative, 8-bit MLX` |
| endpoint | `http://127.0.0.1:8000/v1` | `http://127.0.0.1:8001/v1` |
| weights | `Hugging Face malekoo/Qwen3.8-27B-MLX-8bit, snapshot 6a88621e929c7261b3f5e5c000bac8b663a3bcf3` | `Hugging Face mlx-community/glm-4.7-flash-abliterated-8bit, snapshot c1aeea784f99ec74ab3eb2859f6f16e6daf41364` |
| decoding | `no sampling parameters sent; the server's defaults decode greedily (temperature 0, top-p 1)` | `no sampling parameters sent; the server's defaults decode greedily (temperature 0, top-p 1)` |
| thinking | `false` | `false` |
| digest | `sha256:abf6dadc35355074de964ca4b72ad63b2a07f9e911c68a17825434e4702c4519` | `sha256:2f00948aa216a9527f394171551f71503a461d2e2536f468a8ecceb1da58b4eb` |
| server | mlx_lm.server 0.31.3 on mlx 0.32.2: `mlx_lm.server --model malekoo/Qwen3.8-27B-MLX-8bit --host 127.0.0.1 --port 8000 --prompt-cache-size 1 --prompt-cache-bytes 500000000 --prefill-step-size 512 --prompt-concurrency 1 --decode-concurrency 1` | mlx_lm.server 0.31.3 on mlx 0.32.2: `mlx_lm.server --model mlx-community/glm-4.7-flash-abliterated-8bit --host 127.0.0.1 --port 8001 --prompt-cache-size 1 --prompt-cache-bytes 500000000 --prefill-step-size 512 --prompt-concurrency 1 --decode-concurrency 1` |

Model A is the model the reach-pressure run used, for continuity. Model B had to be a different
family, locally available with no paid service, able to drive this agent's tool loop, and able to
decode under the same rule as model A: greedy, the server's own default, with no sampling
parameter sent. Decoding both models greedily means two arms of one pair differ in their prompt
and not in a sampling draw. That rule was adopted during the synthetic preflights, when Gemma's
failure under greedy decoding showed it mattered; every candidate was tried on the synthetic cohort
only, and no task of the cohort had run under this study when the panel was chosen.

- `gemma4:31b` (Google Gemma 4, unmodified release weights, served by Ollama 0.32.14) makes clean
  tool calls under its release sampling (temperature 1, top-k 64, top-p 0.95). Pinned to greedy
  decoding (temperature 0, top-k 1, a 131072-token context) it degenerates on the agent's first
  prompt of a synthetic task: a leaked `<channel|>` tag and nothing else until the 8192-token
  output cap, 389 seconds, no tool call; the same request under its release sampling returned a
  tool call in 13 tokens. It fails the decoding rule and is not enrolled.
- `glm-4.7-flash` (Zhipu GLM, served by the same `mlx_lm.server` as model A) decodes greedily and
  drives the loop. The only copy available locally is `mlx-community/glm-4.7-flash-abliterated`, a
  community derivative with its refusal direction ablated. It is GLM's weights and not an alias of
  any Qwen model; the ablation is disclosed as a limitation, since it could change behaviour
  beyond refusals.

The panel therefore holds two families. Claims are made per model; a pooled estimate is
descriptive and resamples whole tasks.

Model B runs first, then model A. The order decides nothing: every unit of both models settles
before any held-back verdict exists.

Each model is served alone: its server is started with the arguments above, every unit of that
model runs, and the server is stopped before the next model's is started. No sampling parameter
is sent by the agent; decoding is what each entry states. Thinking is off for both: the agent's
requests send `reasoning_effort: "none"` and `chat_template_kwargs.enable_thinking: false`, and
each server honours one of the two.

## Design

### The shared prefix

One prefix per model and task. A workspace is prepared at the base commit with every ref, the
remote and the reflog dropped and the clone repacked, and the driver refuses one where the merge
commit or the test file's blob still resolves. `npm ci` runs in it. The agent is invoked with the
task text, exactly as the reach-pressure run invoked it. After each invocation the workspace's
whole diff against the base is stored by content address and judged by `swarm ci` in a fresh
checkout with the visible half as the oracle, `--install`, and the repository's own checks.

The prefix stops at the first invocation whose verdict has `task: accepted` and `regression:
pass`, or when its budget of 2 invocations runs out. A refused prefix invocation is
followed by one with the reach-pressure run's control feedback (`refusalFeedback("control", ...)`
in `src/eval/reach-pressure.ts`): which of the repository's checks and the acceptance check
refused, and nothing about reach or any mutant, even where the verdict carries them.

At visible acceptance the prefix is frozen: the patch digest, the `git write-tree` digest of the
workspace, the accepting invocation's session id and ledger digest, and the whole visible
verdict, reach and bond included. That workspace is the parent of every arm and is not written to
again.

### Eligibility

Decided from facts that exist without any held-back run:

- the prefix is visibly accepted and the repository's own checks pass;
- the held-back half is available: its case titles are frozen and the pull request's test file
  still digests to the frozen value;
- at least one finding is present on the frozen patch:
  - **reach**: `oracleReach` is `unreached` and `unreachedByOracle` names at least one line. That
    list is what remains after every rule reach applies: type declarations, type tests (`.test-d.*`
    and `test-d/`), the change's own tests, files no JavaScript runner loads, and lines that carry
    no code are set aside before a line can be unreached;
  - **mutation**: at least one mutant with `verdict: vacuous` (the visible check ran the mutated
    line, with a hit in its own coverage, and still accepted) **and** `witness` of `coverage` or
    `repository-suite` (a second detector showed the mutant changes what the program does).
    A vacuous mutant whose witness is `none` or `not-adjudicated` is not a finding. The repository
    suite witness runs on the base, the patch and that mutant only (fixed during qualification,
    see [`qualification.md`](qualification.md)).

Both findings are read off the one coverage reading of the visible check's run. Where the check
did not accept, or reach is `unmeasured`, neither finding is measured, and an unmeasured reading
is never read as an empty one.

A pair that is visibly accepted with no finding ends `no-eligible-signal`. Whether the held-back
half will return a verdict is not asked at this point, because asking means running it; a pair
whose held-back score turns out unjudgeable leaves the comparison it belongs to by name.

### The arms

For an eligible pair: **neutral** always; **reach** where reach found something; **mutation**
where mutation found something; **combined** always. Arms run one after another in an order fixed
by the SHA-256 of the model, the task and the arm name, so it is neither the same for every pair
nor chosen by anybody.

Each arm starts from an APFS clone of the frozen prefix workspace. Before any invocation the
driver recomputes the clone's `git write-tree` digest and its diff digest and refuses the arm
unless both equal the frozen ones.

Each arm has 2 repair invocations, each a fresh conversation, as every repair in this
harness is. After each one the patch is stored and judged exactly as in the prefix, and the
findings the arm is sent are recomputed from that verdict. A treatment arm stops early once the
visible check accepts, the repository's checks pass and every finding of the kinds it is sent is
gone. The neutral arm has nothing to clear and always spends its whole budget, which is the
compute each treatment is compared against. Budgets per invocation are identical across arms.

### What each arm is told

Every repair prompt is the unchanged task text, a blank line, and then the feedback below. The
wording is `feedback-study-v1` in `src/eval/feedback-study.ts`, digested as `policyDigest`.

All four arms receive, first:

> The task above has already been worked on in this workspace, and that change is in place.
> Review your implementation for completeness and correctness against the task. Change it only
> where it needs changing. Run the repository's own checks that apply, and leave the working tree
> clean: no scratch, probe or diagnostic files, and nothing the task does not need.

All four arms receive, where their last revision lost visible acceptance or broke the
repository's checks, the line "An independent verifier judged the change after the last
revision." and whichever apply of "The repository's own checks fail with the change applied and
pass without it.", "The repository's own checks could not be measured with the change applied.",
"The acceptance check for the task fails with the change applied." and "The workspace no longer
holds any change against the base commit." This is the same information in every arm.

The neutral arm receives nothing else.

The reach, mutation and combined arms receive, where findings of their kinds are present:

> An independent verifier judged the change. The acceptance check for this task passes and the
> repository's own checks pass. The verifier also reports the following.

then, for reach:

> Changed lines the acceptance check did not exercise:
> The acceptance check never executed these executable lines that the change adds, so the
> behaviour on them was not exercised:
>   `path: line, line`
> Address the underlying implementation, or, where a reported line is not executable behaviour,
> show why through your code changes. The acceptance check runs tests of its own that you cannot
> see or edit, so tests written in this workspace do not change what it executes.

and for mutation:

> Changes to the code that the acceptance check did not notice:
> The verifier changed single lines of the change, one at a time, and ran the acceptance check
> again. For each line below, the acceptance check executed the line and still passed with the
> change in place, and a separate measurement showed that the change alters what the program does:
>   ``path line N (operator): `before` became `after` `` (or `` `before` was deleted ``)
> This is evidence that the acceptance check is insensitive to the behaviour around these lines.
> Review your implementation against what the task asks, in particular the behaviour these lines
> decide.

The combined arm receives both blocks, reach first, each under its own heading. After the first
repair invocation each treatment arm is sent its findings as they then stand: reach recomputes
only reach, mutation only mutation, combined both. Nothing says how to change the code, asks for
less code or more, mentions a score, or encourages deleting a line or editing a test.

### Keeping the held-back half out of reach

- Neither half is ever written into a workspace. The pull request's test file is copied into
  `swarm ci`'s own fresh checkout at judging time, and to disk at all only while a judge runs.
- The code that builds prompts is handed the task id and text and the visible verdict, never the
  held-back cases.
- Every agent invocation runs under a home of its own, created for it and removed once its
  session is copied out, so no invocation can read another's prompt or transcript.
- Every session's payloads, tool calls and their outputs alike, are searched for any path under
  the mined checkouts, the study's stores or another invocation's workspace or home, and every
  row carries what was found. A session that could not be read is an unchecked audit.
- Held-back scoring is a separate phase that refuses to start until every unit of every
  registered model has settled, so no held-back verdict exists while any agent can still run, and
  no held-back result decides whether any invocation happens.
- Residual, named: the tool policy is lexical and an allowed interpreter can read outside the
  workspace. The audit above sees what a session records, not what a process read silently.

## Budgets

Per invocation: 12 wall minutes, 1,000,000 tokens, the agent's default step cap (40) and
gate-repair caps, the reach-pressure run's settings. A driver deadline four minutes past the wall
budget kills an agent that did not stop itself. Per pair: at most 2 prefix invocations,
then at most 2 per arm. `swarm ci` keeps its own limits: 5 minutes per command, 20 per
judgement.

## Terminal outcomes

Per model and task:

| status | meaning |
| --- | --- |
| `prefix-not-accepted` | the prefix budget ran out without visible acceptance |
| `no-eligible-signal` | visibly accepted, and neither finding is present |
| `held-back-unavailable` | visibly accepted, and the held-back half is not available |
| `eligible` | the arms ran |
| `unjudgeable` | the workspace could not be prepared, or the visible check gave no verdict or accepts the base |
| `infrastructure-failure` | see below; kept by name after its attempts run out |

Per arm:

| status | meaning |
| --- | --- |
| `repaired-signal-cleared` | the final patch differs from the fork, visible acceptance holds, and no finding of the arm's kinds remains (the neutral arm is described by both kinds) |
| `signal-cleared-without-change` | the findings are gone from a byte-identical patch: the verifier moved, not the code |
| `repair-exhausted-no-change` | the final patch is byte-identical to the fork |
| `repair-exhausted-same-findings` | the patch changed and the same findings remain |
| `repair-exhausted-findings-shrank` | every remaining finding was there before and at least one is gone |
| `repair-exhausted-findings-changed` | some findings gone and some new |
| `repair-exhausted-findings-expanded` | every earlier finding remains and at least one is new |
| `repair-lost-visible-acceptance` | the final patch no longer passes the visible check or the repository's checks |
| `signal-unmeasured-after-repair` | visible acceptance holds and the verifier could not read the findings |
| `unjudgeable` | the visible check gave no verdict on an arm's patch |
| `infrastructure-failure` | see below |

A finding is named by its file and the text of its line (a mutant also by its operator), so a
line renumbered by an unrelated edit is the same finding.

**Infrastructure is never a model outcome.** An invocation is charged to the infrastructure where
the endpoint does not answer a bounded completion afterwards (a dead server, or one whose
generation thread died of GPU memory), where none of its model calls was answered, where the
driver had to kill the agent at its deadline, or where the agent process left no session. Such an
invocation is never judged. The unit is recorded as an infrastructure failure, the driver stops,
a supervisor restarts that model's server with its registered arguments and resumes, and the unit
runs again: a prefix from the base commit, an arm from the same frozen prefix. At most
3 attempts per unit; one still failing stays an infrastructure failure by name. An
agent that stopped itself at its own wall budget is the agent's, as in the reach-pressure run.

## Outcomes

**Primary.** The held-back half's verdict on each arm's final patch, `accepted` a pass and
`rejected` a fail, judged in a fresh checkout with `--oracle-only`, with the existing
order-dependence rule: where the visible half accepted a patch and the held-back half refused it
alone, both halves run together, and a refusal that disappears in company is order dependence
and read as a pass. `unjudged` or `vacuous` is unjudgeable and never converted. The prefix patch
of every visibly accepted pair is scored the same way. One patch is scored once per pair.

**Also recorded.** The repository's own checks on every final patch, from its visible judgement;
for every step, the patch digest and metrics, the findings, their relation to the step before,
the invocation's usage, stop reason, wall time and attribution, the visible judge's time, and the
session audit; held-back judging time.

## Analysis

`node scripts/feedback-study.mjs analyze` calls no model and no judge.

- **Primary, per model and per treatment.** For each of reach, mutation and combined, the pairs
  eligible for it where both it and neutral settled on a patch and both patches carry a held-back
  pass or fail. Neutral is first and the treatment second. The complete paired 2x2 table, exact
  two-sided McNemar (`mcNemarExact`), the paired risk difference, treatment minus neutral, with
  Newcombe's 95% interval (`pairedDifferenceInterval`). Every pair left out is named with its
  reason.
- **The family.** The primary tests of every model and treatment are one family, Holm-adjusted
  (`holmAdjusted`).
- **Pooled, descriptive.** Where at least two models have pairs for a treatment: the paired risk
  difference over all their primary pairs, with a 95% percentile interval from resampling tasks
  with replacement, every row of a drawn task kept together (`clusteredDifferenceInterval`,
  10000 resamples, seed 20260919). No pooled test.
- **Ranking treatments** only on dual-trigger pairs, where both findings existed on the same
  prefix patch: reach against mutation, reach against combined, mutation against combined, each a
  paired table with McNemar and Newcombe, outside the family and descriptive.
- **From the prefix.** Every arm against the prefix patch it forked from, fail to pass and pass to
  fail, descriptive.
- **Mechanism, descriptive, per model and arm.** How often the patch changed; how often the
  findings the arm is described by cleared; the terminal classes and the fork-to-final relation,
  per finding kind for the two-kind arms; proxy-only successes (findings cleared, held-back fail);
  helpful, harmful and unchanged held-back transitions from the prefix; the verifier's resolution
  rate beside the held-back improvement rate; the direction of added, deleted and executable lines,
  source files, test lines and diff bytes; test-only, non-runtime-only and scratch-only changes by
  rule over paths and the repair sessions' own ledgers; stop reasons; tokens, model calls, agent
  and judge minutes per arm and per helpful held-back repair. A total is a number only where every
  part was measured. No quality score is computed, and nothing here reads code for meaning.

**Decision rule.** A claim that a treatment raises or lowers the held-back pass rate against
neutral review, for one model, requires that model's Holm-adjusted exact McNemar p-value below
0.05; the direction is whichever discordant cell is larger. Anything else is insufficient, however
the pairs lean, and the discordant pairs are listed by task either way. No claim is made across
models from one model's table. Clearing a finding is never a success: the held-back verdict alone
says whether a task improved.

## Denominators, failures and stopping

Every frozen task keeps a row per model. No task leaves because its split is thin, its repository
is large or its result is inconvenient. The whole cohort runs for every model; there is no interim
analysis, and no held-back verdict exists until every unit has settled. After the run the
ledgers may be packed losslessly (`pack-ledgers`), which closes collection.

## Changes after registration

Treatment wording, outcome definitions, task membership, the panel and the statistics do not
change because of results. If a real defect in the instrument is found after collection begins,
the generation stops, its rows are kept unchanged under `generation-N/` as withdrawn evidence,
the defect is written down here under a new heading, and a new generation is registered and run
from the start.

## What was exercised beforehand

Unit tests cover the arms' prompts word for word, the absence of any finding from the prefix and
from the neutral arm, the held-back titles never reaching a prompt, witnessed-only mutation
findings, unmeasured readings, every terminal class, infrastructure attribution in prefixes and
arms, the resume schedule, the one-identity rule, the cohort cap, and the analysis's tables,
Holm's adjustment and the task-clustered bootstrap (`src/eval/feedback-study*.test.ts`,
`src/eval/agent-session.test.ts`, `src/eval/statistics.test.ts`, `scripts/feedback-study.test.mjs`).

The driver ran end to end over the five-task synthetic cohort (`scripts/feedback-study/preflight.mjs`),
through the real verifier: freeze, run, score, analyze in place twice (the second refuses a
changed byte), analyze beside it twice (byte-identical), pack the ledgers, analyze through the
archive (byte-identical), and `score` refused once packed.

| preflight | commit | acquisition | rows | infrastructure failures | invocations | stopped by the agent itself | sessions audited clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| scripted stand-in, no model | `d39975674` | | 24 | 0 | 16 | n/a | n/a |
| `local:mlx-community/glm-4.7-flash-abliterated-8bit` | `4629e62cb` | `sha256:c047329b7882…` | 28 | 0 | 23 | 23 of 23 `completed` | 23 of 23 |
| `local:malekoo/Qwen3.8-27B-MLX-8bit` | `b0a7f17b1` | `sha256:c047329b7882…` | 22 | 0 | 17 | 17 of 17 `completed` | 17 of 17 |

Both model preflights ran under the acquisition identity this protocol registers. Between them
they produced reach findings (Qwen on the switch-statement task, GLM on three tasks), a witnessed
mutation finding (Qwen on the sign task), repairs that changed nothing, repairs that changed the
patch and kept the same findings, and one whose findings grew. Qwen's first preflight, at
`23703b189` before the ledger packing and the probe fix, produced the same terminal classes.

`gemma4:31b` was tried and not enrolled; see the panel. No task of the confirmatory cohort was run
and no held-back verdict of it was looked at while any of this was built.

## Artifacts

| file | what it is |
| --- | --- |
| `protocol.md` | this file |
| `manifest.json` | the frozen cohort |
| `qualification.md` | the instrument audit that preceded this registration |
| `environment.json` | the machine and what each endpoint served, at its first unit |
| `results.jsonl` | launch, prefix and arm rows, append-only, canonical JSON (packed into `ledgers/` once settled) |
| `hidden-scores.jsonl` | one row per model, task and patch (packed with it) |
| `summary.json`, `classifications.json`, `report.md`, `derivation.json` | derived by `analyze` |
| `patches/` | every patch any row names, one content-addressed archive |

Workspaces, sessions (every model call and tool call) and the stored patches stay outside the
repository under `~/.cache/swarm-pr-tasks/feedback-study/g1/`. Each step carries its session
id, the SHA-256 of its ledger and its record count.


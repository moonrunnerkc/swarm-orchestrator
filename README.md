<!-- Improved compatibility of back to top link -->
<a id="readme-top"></a>

<!-- PROJECT HEADER -->
<br />
<div align="center">

<h3 align="center">swarm-orchestrator</h3>

  <p align="center">
    A proof-carrying runner and verifier for bounded code changes.
    <br />
    <a href="docs/README.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="docs/evidence/2026-08-18/live-tasks.md">See a real run</a>
    ·
    <a href="https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?labels=bug">Report Bug</a>
    ·
    <a href="https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<div align="center">

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=flat-square&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![nightly proof](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/nightly-proof.yml?branch=v13-main&style=flat-square&label=nightly%20proof)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/nightly-proof.yml)
[![weekly evidence](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/weekly-evidence.yml?branch=v13-main&style=flat-square&label=weekly%20evidence)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/weekly-evidence.yml)
[![npm](https://img.shields.io/npm/v/swarm-orchestrator?style=flat-square&label=npm)](https://www.npmjs.com/package/swarm-orchestrator)
[![node](https://img.shields.io/badge/node-%3E%3D24-blue?style=flat-square)](package.json)
[![license](https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square)](LICENSE)

</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#verifying-somebody-elses-work">Verifying somebody else's work</a></li>
    <li><a href="#what-a-run-reports">What a run reports</a></li>
    <li><a href="#what-is-claimed">What is claimed</a></li>
    <li><a href="#what-is-not-claimed">What is not claimed</a></li>
    <li><a href="#limits">Limits</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

## About The Project

Give it a task and a git repository and it will make the change. Give it somebody else's patch
and it will tell you what that patch actually establishes. Either way what comes back is a
signed, hash-chained record of what ran, what passed, and what nobody measured, which anybody
can check without installing this tool.

The model can say whatever it likes. It cannot make a gate pass, it cannot mark a claim
verified, and it cannot change a record after the fact.

Three jobs, and the second and third do not need this tool's own agent.

**Make a bounded change.** It plans, declares the files it intends to touch, edits through a
chokepoint that records every tool call, runs your gates, and retries failures under a numeric
ratchet that refuses a fix which trades away tests, assertions or coverage. Then it exports the
evidence.

**Verify a patch anybody produced.** `swarm ci --patch <file>` clones the base commit somewhere
the producing tree cannot reach, applies the patch there, and runs the checks in that checkout.
Nothing the producer said travels except the patch. It reads another agent's own event stream
beside it if you have one.

**Say what a result does and does not establish.** A run reports nine separate answers rather
than a boolean, and `unmeasured` is one of the values. "Nobody checked" and "checked and failed"
are different findings that call for different things, and flattening them is how a change
nothing executed comes to read green.

Here is a real run, committed: [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md), with
its bundle in [`live-frontier/`](docs/evidence/2026-08-18/live-frontier). And here is the packaged
tool doing it, installed from a tarball into a directory holding nothing else, against a
workspace it had never seen, recorded in a real terminal:
[`installed-package-run.md`](docs/evidence/2026-08-23/installed-package-run.md).

### Built With

* [![TypeScript][TypeScript]][TypeScript-url]
* [![Node.js][Node.js]][Node-url]
* [![Vitest][Vitest]][Vitest-url]
* [![Biome][Biome]][Biome-url]
* [![Zod][Zod]][Zod-url]

Ten runtime dependencies: the Vercel AI SDK family for providers, Ink and React for the screen,
`smol-toml` for config, `undici` for HTTP and Zod for schemas. Durable state is `node:sqlite`
rather than a database. The verifier a bundle carries is dependency-free by design, so checking
somebody's evidence needs nothing but Node.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

**Node 24 or newer.** That is a runtime floor rather than a preference: the coverage cycle spawns
the test runner with `--test-isolation=process`, which Node 22 rejects as a bad option, so on
anything older that measurement does not happen.

A model, either frontier or local:

```sh
# frontier: any one of these
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GOOGLE_GENERATIVE_AI_API_KEY=...

# or local: start Ollama or rapid-mlx, then name the model
swarm --model local:qwen3.6:35b-a3b "..."
```

Keys come from the environment or your OS keychain and have no `swarm.toml` setting: that file is
committed and cloned, so a key in it has already been shared with everyone holding the
repository, and a file naming one is refused with rotation guidance.

### Installation

```sh
npm install -g swarm-orchestrator
```

That is **14.0.2**, and it leaves `swarm` on your path.

Installing from a tag works too, but only into a project rather than globally:

```sh
npm install github:moonrunnerkc/swarm-orchestrator#v14.0.2
```

`dist/` is not committed, so a git ref builds itself on install and needs this package's
devDependencies to do it. npm does not install those when a git ref is installed with `-g`, which
is why the published package is the one to use.

Anything below 13 is a different program. This package name carried a pull-request auditor
through 12.x, so pin the major if you depend on one or the other.

If `swarm` turns out to be an older version than you installed, something else owns the command —
usually a development checkout linked in with `npm link`, which npm cannot install over:

```sh
swarm doctor        # says which of those happened
swarm doctor --fix  # repairs it
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

```sh
swarm "make slugify collapse whitespace and strip punctuation"
```

```
swarm                            # a session: type tasks, one after another
swarm --version                  # which build this is
swarm doctor                     # what owns the swarm command, and --fix to repair it
swarm init                       # write swarm.toml from package.json's scripts
swarm gates                      # run the gates over a workspace, no model
  --allowed-files <a,b>          # the scope you authorise, for the file-set check
swarm select                     # probe this machine, recommend a local model
swarm calibrate                  # measure candidate models on the golden set
swarm routing                    # what the reward log adds up to
swarm parallel --tasks <file>    # a worker per task, then a merge queue
swarm parallel --goal <text>     # break the goal into tasks, then run them
  --redundancy <n>               # try each task n ways, land the best of them
  --concurrency <n>              # how many workers may hold a worktree at once

swarm ci --patch <file>          # verify a patch in a fresh checkout of the base
  --oracle <command>             # what says the task was done
  --install                      # install the checkout's dependencies first
  --immutable <a,b>              # paths the patch may not touch
  --agent-stream <file>          # another agent's event stream, read beside it
swarm verify <bundle>            # check a bundle, and who signed it
  --signer <fingerprint>         # the identity you expect, from outside the bundle
swarm review <bundle>            # what a past run produced, and open it
swarm replay <bundle>            # read a bundle back

swarm list-runs                  # runs this machine has state for
swarm inspect <run-id>           # what a run did, and what it still owes
swarm resume <run-id>            # take up a run that was interrupted
swarm abort <run-id>             # stop a run and refuse it new work
swarm repair <run-id>            # release what a dead run left held
swarm gc [--older-than 30d]      # what stored evidence would be removed, --remove to do it

swarm --isolation docker "..."   # run commands behind a kernel-enforced boundary
swarm --json "..."               # line-delimited JSON: one line per event, one result
swarm --model local:<id> "..."   # a specific model
swarm --base <ref> "..."         # what the diff and the ratchet measure against
swarm --max-wall-minutes <n> "..." # the whole run's clock: the loop and every retry together
```

`swarm --help` prints all of it. Settings live in one optional `swarm.toml`: providers and
endpoints, gate definitions, budgets, model pins. Flags win over the file.

Two settings are worth knowing before you need them:

```toml
[providers]
local_thinking = false         # a reasoning model served locally answers without reasoning first

[interface]
confirm_timeout_minutes = 30   # an unanswered confirmation refuses itself; 0 waits for ever
```

`local_thinking` matters on a reasoning model served locally. Left unset, nothing is sent and the
server's own default stands, which is the only safe default: the field is a vendor extension and a
server that rejects what it does not recognise would fail every call rather than one. Against
rapid-mlx serving qwen3.8:27b, one request cost 37 completion tokens with reasoning on and 2 with
it off.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Verifying somebody else's work

Every gate a run executes runs in the workspace that run was editing, with the tests that run may
have changed, reading reports that run's own processes wrote. The sealed criteria and the ratchet
close most of that. What they cannot close is the shape of it: a subject grading its own paper.

`swarm ci` is the separate opinion.

```sh
swarm ci --patch candidate.diff --install --oracle "npx jest tests/the-task.test.ts"
```

It clones the base commit into a fresh checkout, applies the patch there, and runs the checks
there, with the gates assembled from the base commit's manifests rather than the patched tree's,
so a patch that rewrites the test script does not get to choose the instrument that measures it.

**It reports two answers, not one, and the second is the one a suite cannot give you.**

```
regression: pass   task: unjudged
```

`regression` is whether the repository's own suite still passes: it says nothing broke. `task` is
whether the work was actually done, and only an oracle can say that, because a suite tests the
behaviour a project already had and a task adds behaviour it did not. Measured: four of eighteen
real-repository patches passed their project's whole suite and failed a hidden acceptance test,
a 22% false-green rate until the two answers were separated. Without `--oracle` the task is
`unjudged` and nothing is verified, which is the honest answer rather than a pass by omission.

A check that fails identically at the base commit is recorded as inherited rather than as a
regression, because a failure the patch did not cause is not the patch's.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What a run reports

Nine answers, not one:

```
verdict:
  integrity       valid
  signer          untrusted
                  no expected signer was matched, so the signature shows the bundle is
                  unchanged since it was written and not who wrote it
  executionTrust  restricted
                  commands ran under a lexical path and program policy, which is not containment
  policy          pass
  mechanical      pass
                  lint passed
  behavioral      unmeasured
                  no dynamic gate ran, so nothing executed the change (tests stood down)
  semantic        unmeasured
  task            unjudged
  humanApproval   not-required

acceptable: no
```

`unmeasured` is a value, not a missing one. A change whose only passing gate was a linter is not a
change anything ran. `semantic` abstains by construction, because judging whether a change means
what the task asked for is a judgement about meaning and nothing here is allowed to make one.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What is claimed

Every line here links to a committed artifact of the thing happening. The full table is
[`docs/claims.md`](docs/claims.md).

- **A green verdict is computed by the harness, and the model cannot produce one.** In a real run
  the model asserted a predicate the language does not parse; the harness rendered it
  `UNVERIFIED (predicate-unparseable)` and carried on, twice:
  [shakedown results](docs/evidence/2026-08-18/shakedown/results.md).
- **One changed byte breaks verification.** The same bundle verified and then tampered with in a
  single byte, exit 0 and exit 1 side by side: [tamper demo](docs/evidence/2026-08-18/tamper-demo).
- **The bundle carries its own verifier, and it works on a machine that has never seen this repo.**
  Run in a `node:24` container with no network and no mount of this repository:
  [`clean-container-verification.md`](docs/evidence/2026-08-23/clean-container-verification.md).
  Beside it every bundle carries `rederive.mjs`, which recomputes every verdict from the record
  and names what it cannot re-derive rather than agreeing with it:
  [`gates-bonded/`](docs/evidence/2026-09-02/gates-bonded).
- **A signature is checked against an identity from outside the bundle.** Anyone can edit a
  bundle, rehash it, sign it with a key of their own and ship that key in the manifest.
  `swarm verify --signer <fingerprint>` is the check that catches it.
- **Local model choice is measured on your machine**, not guessed:
  [`calibration-report.md`](docs/evidence/2026-08-23/calibration-report.md).
- **Eight untrusted boundaries are fuzzed**, and the harnesses are checked against a defect
  injected on purpose so a clean run cannot be a blind one: [`fuzz/`](fuzz/README.md).
- **A choice between competing attempts is made from measured numbers**, never a model's opinion:
  [`swarm.md`](docs/evidence/2026-08-24/swarm.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What is not claimed

Kept short and kept honest, because the point of the rest of this file is that claims cost
something. The full list, with what would settle each, is
[`docs/beta-gates.md`](docs/beta-gates.md): of the twelve gates this project agreed not to call
itself production-ready without, six pass on measured evidence, three are partial with the gap
named, two are unproven, and one fails on scale. **It is not production-ready**, and that last one
is the largest gap.

- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret removal,
  with a four-character floor. Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A run gets a lexical path and
  program policy in front of interpreters unless you pass `--isolation`. That is reported before
  the run starts and recorded on the chain rather than quietly assumed, but it is not containment.
- **The false-green rate is measured, on fifteen opportunities.** Each task carries two oracles:
  one handed to the tool, one held back from it. A false green is only possible where the tool
  said `verified`, and the held-back oracle refuses none of those. **0 of 15, 95% CI [0.0, 20.4]**
  across [hand-authored](docs/evidence/2026-09-06/second-oracle/README.md) and
  [mined](docs/evidence/2026-09-06/mined-corpus/README.md) corpora. Fifteen opportunities is
  fifteen opportunities: what is shown is that none occurred here, not that the rate is low. An
  earlier single-oracle version of this number, 0 of 18, was withdrawn as arithmetic rather than
  corrected quietly — the same test was handed to the tool and then used as the ground truth it
  was scored against, so it agreed with itself:
  [`false-green-measurement.md`](docs/evidence/2026-09-05/false-green-measurement.md).
- **No comparison against another tool.** The evaluation harness runs matched arms on a local
  model and has not been run at the scale that would make an arm comparison worth reading.
- **Learned routing is not on by default**, and there is a bar under turning it on. Nothing has
  cleared it yet, so routing follows the calibration and the competency table.
- **Six known gaps ship open**, and none is claimed closed: [build guide 7.1](docs/build-guide.md)
  says for each what now catches it and what still gets past. Four have detections built against
  them and have not yet been attacked, so what is claimed is a detection and not a closure.
- **A signature does not make the machine honest.** It proves the bundle was not altered after it
  left the machine that produced it. The review page says that on its face.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Limits

Gates prove mechanical quality. They do not prove design quality, and nothing here pretends a
passing run means the change is good. What the bundle buys you is that reviewing the change is
fast and that its claims are checkable, not that review is unnecessary.

The verdict says so in its own vocabulary: `semantic` is `unmeasured` on every run and always will
be. `acceptable` means no blocking gate failed, no policy gate failed, and something executed the
change. It does not mean the change is right, and no number here could tell doing the whole task
from doing the minimum that passes its own tests.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

Taken from [`docs/beta-gates.md`](docs/beta-gates.md), which is the list this project agreed not
to call itself production-ready without. Unticked means unproven, not planned.

- [x] Zero accepted test-policy violations in the mutation suite
- [x] 99% recovery from injected termination without duplicate committed effects
- [x] Every stable documented command exists and works in the published artifact
- [x] Trusted-identity verification rejects a re-signed bundle from an unknown key
- [x] New evidence directories and files reliably 0700 and 0600
- [x] Multi-agent automatic only where held-out evidence shows it earns its place — passed by not
      doing it: `swarm parallel` is always asked for, never inferred
- [ ] Zero false greens in at least 400 held-out tasks — at 15 opportunities, upper bound 20.4%
- [ ] An adversarial corpus written by somebody trying to get past the defences, not by whoever
      wrote them
- [ ] Task success non-inferior to the strongest single-agent baseline, at a size that supports
      the claim
- [ ] Deadline overshoot measured, not just bounded by a mechanism
- [ ] No orphan worktrees or branches after a real interrupted parallel run
- [ ] A new user installs, makes a safe test-backed fix, and understands the result in under ten
      minutes, timed with somebody who has not seen the tool

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

The bar for a change here is the same one the tool applies to itself: `npm run gates` green with
the output shown, new behaviour covered by a test that failed first, and no claim in a document
that its linked artifact does not establish.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Run `npm run gates` and paste the real output in the PR
4. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

New dependencies need a one-line justification in the PR description; the standard library is
preferred. `docs/build-guide.md` is worth reading before structural work.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the ISC License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Brad Kinnard — [@KChackerman](https://x.com/KChackerman) — bradkinnard@proton.me

Project Link: [https://github.com/moonrunnerkc/swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator)

**Upgrading from v12:** v12 was a PR auditor that ran as a GitHub Action. v13 and later are a
coding agent. Same package name, different product, no migration path. If you are using v12, stay
on it: it is tagged `v12-final`. Details in [`CHANGELOG.md`](CHANGELOG.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node.js]: https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Vitest]: https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[Vitest-url]: https://vitest.dev/
[Biome]: https://img.shields.io/badge/Biome-60A5FA?style=for-the-badge&logo=biome&logoColor=white
[Biome-url]: https://biomejs.dev/
[Zod]: https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white
[Zod-url]: https://zod.dev/

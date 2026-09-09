<a id="readme-top"></a>

<div align="center">

<h1>swarm-orchestrator</h1>

<p><strong>A proof-carrying runner and verifier for bounded code changes.</strong></p>

<p>
The model can say whatever it likes.<br />
It cannot make a gate pass, mark a claim verified, or change a record after the fact.
</p>

<p>
  <a href="docs/README.md"><strong>Explore the docs »</strong></a>
  <br />
  <br />
  <a href="docs/evidence/2026-08-18/live-tasks.md">See a real run</a>
  ·
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?labels=bug">Report Bug</a>
  ·
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/issues/new?labels=enhancement">Request Feature</a>
</p>

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=for-the-badge&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![npm](https://img.shields.io/npm/v/swarm-orchestrator?style=for-the-badge&label=npm&color=CB3837)](https://www.npmjs.com/package/swarm-orchestrator)
[![node](https://img.shields.io/badge/node-%E2%89%A524-5FA04E?style=for-the-badge)](package.json)
[![license](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](LICENSE)

</div>

---

<details>
  <summary><strong>Table of Contents</strong></summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#what-it-reports">What it reports</a></li>
    <li><a href="#the-evidence">The evidence</a></li>
    <li><a href="#what-is-not-claimed">What is not claimed</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

## About The Project

Give it a task and a git repository and it will make the change. Give it somebody else's patch and
it will tell you what that patch actually establishes. Either way what comes back is a signed,
hash-chained record of what ran, what passed, and what nobody measured — which anybody can check
without installing this tool.

|  | |
| --- | --- |
| **Make a bounded change** | It declares the files it intends to touch, edits through a chokepoint that records every tool call, runs your gates, and retries failures under a numeric ratchet that refuses a fix trading away tests, assertions or coverage. |
| **Verify anybody's patch** | `swarm ci` clones the base commit somewhere the producing tree cannot reach, applies the patch there, and runs the checks in that checkout. Nothing the producer said travels except the patch. |
| **Say what a result does not establish** | A run reports nine answers rather than a boolean, and `unmeasured` is one of the values. "Nobody checked" and "checked and failed" are different findings, and flattening them is how a change nothing executed comes to read green. |

### Built With

[![TypeScript][TypeScript]][TypeScript-url]
[![Node.js][Node.js]][Node-url]
[![Vitest][Vitest]][Vitest-url]
[![Biome][Biome]][Biome-url]
[![Zod][Zod]][Zod-url]

Durable state is `node:sqlite` rather than a database. The verifier a bundle carries is
dependency-free by design, so checking somebody's evidence needs nothing but Node.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

**Node 24 or newer.** A runtime floor rather than a preference: the coverage cycle spawns the test
runner with `--test-isolation=process`, which Node 22 rejects as a bad option, so on anything older
that measurement does not happen.

A model, frontier or local:

```sh
export ANTHROPIC_API_KEY=...          # or OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
# or start Ollama / rapid-mlx and pass --model local:<id>
```

Keys come from the environment or your OS keychain, never from `swarm.toml` — that file is
committed and cloned, so a key in it has already been shared with everyone holding the repository.

### Installation

```sh
npm install -g swarm-orchestrator
```

That is **14.0.2**, and it leaves `swarm` on your path. If `swarm` turns out to be an older version
than you installed, `swarm doctor` says what owns the command and `--fix` repairs it.

Anything below 13 is a different program: this package name carried a pull-request auditor through
12.x. Pin the major if you depend on one or the other.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

```sh
swarm "make slugify collapse whitespace and strip punctuation"
```

Real output, `swarm gates` over a two-test project:

```
  passed   tests: 2 collected, 2 passed, 0 failed, 0 skipped (exit 0)
  passed   placeholder: no placeholder marker was introduced by this change
  passed   secret-scan: no known credential pattern appears in the added lines
  n/a      typecheck: package.json declares no typecheck script

bonds, one per gate that passed:
  tests: held. the tests gate refused the bond: 3 collected, 2 passed, 1 failed, 0 skipped
  secret-scan: held. the secret-scan gate refused the bond: 1 added line(s) match a known
    credential pattern: swarm-falsification-bond.env.example.js:1 (github-token)

acceptable: yes (no blocking gate failed, no policy gate failed, and something executed the change)
```

**A pass is a claim until it is shown able to fail.** After the gates go green, each one that
passed is handed a bond — one file it has to refuse. A check that refused it held. A check that
passed over a bond it demonstrably saw is vacuous, and a vacuous blocking gate makes the run not
green whatever the cycle said.

The four commands most people need:

```sh
swarm                              # a session: type tasks, one after another
swarm gates                        # run the gates over a workspace, no model
swarm ci --patch <file>            # verify a patch in a fresh checkout of the base
swarm verify <bundle> --signer <f> # check a bundle, and who signed it
```

Every command and flag is in **[docs/cli.md](docs/cli.md)**. Sessions, several workers at once and
`swarm.toml` are in **[docs/using.md](docs/using.md)**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What it reports

Nine answers, not one. `unmeasured` is a value, not a missing one:

```
  mechanical      unmeasured
                  every static gate stood down (typecheck, lint, format)
  behavioral      pass
                  tests passed
  semantic        unmeasured
  task            unjudged
                  no trusted task oracle was configured for this run
  executionTrust  restricted
                  commands ran under a lexical path and program policy, which is not containment
```

That run passed its tests, so `behavioral` is a pass — but it declares no typecheck, lint or
format script, so `mechanical` is `unmeasured` rather than a pass. A change whose only passing
gate was a linter is not a change anything ran, and the reverse holds too. `semantic` abstains by
construction, because judging whether a change means what was asked is a judgement about meaning,
and nothing here is allowed to make one.

`swarm ci` reports **two** answers where a suite gives you one: `regression` says nothing broke,
`task` says the work was done — and only an oracle can say the second. Four of eighteen
real-repository patches passed their project's whole suite and failed a hidden acceptance test.

**And it judges the oracle it was handed, not only the patch.** An oracle that accepts the base
commit would have accepted a patch that changes nothing, so `task` reads `vacuous` and nothing is
verified. An oracle that never executed the lines the patch adds cannot have judged them, so
`oracleReach` reads `unreached`, the lines are named, and nothing is verified. Both were found by
measuring this tool against real work: certified tasks rested on oracles that could not fail, and
the first false green found was certified by an oracle that never ran the branch it broke. That
one is now refused, and refusing it cost no correct result: across both corpora the reach check
turned down nothing that both oracles accept.

Reach is measured only where the harness can rebuild the oracle's own invocation, so an oracle run
through another test runner reports `unmeasured` rather than a guess.

Full detail in **[docs/verifying.md](docs/verifying.md)**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## The evidence

Every claim this project makes links to a committed artifact of the thing happening. The full
table is **[docs/claims.md](docs/claims.md)**. Three of them:

- **One changed byte breaks verification** — the same bundle verified and then tampered with in a
  single byte, exit 0 and exit 1 side by side, with a script to reproduce it:
  [tamper demo](docs/evidence/2026-08-18/tamper-demo).
- **A bundle verifies on a machine that has never seen this repo** — run in a `node:24` container
  with no network and no mount of this repository:
  [clean-container-verification.md](docs/evidence/2026-08-23/clean-container-verification.md).
- **A green verdict is computed by the harness, and the model cannot produce one** — in a real run
  the model asserted a predicate the language does not parse; the harness rendered it
  `UNVERIFIED` and carried on, twice:
  [shakedown results](docs/evidence/2026-08-18/shakedown/results.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What is not claimed

**It is not production-ready.** Of the twelve gates this project agreed not to call itself
production-ready without, six pass on measured evidence, three are partial, two are unproven, and
one fails on scale. Each row and what would settle it: **[docs/beta-gates.md](docs/beta-gates.md)**.

- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret removal.
  Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A lexical path and program policy
  in front of interpreters unless you pass `--isolation`. Reported before the run starts and
  recorded on the chain rather than quietly assumed — but it is not containment.
- **The false-green rate is 1 in 19**, 5.3%, 95% CI [0.9, 24.6]. Every task carries two oracles,
  one handed to the tool and one held back from it, and once the tool reported `verified` on a
  patch the held-back oracle refuses. The bar this project set itself is zero, so this is a
  **failure**: [`mined-corpus/`](docs/evidence/2026-09-06/mined-corpus/README.md). The eleven
  hand-authored opportunities found none; every false green came from tasks mined out of real pull
  requests, because maintainers test what they cared about rather than what the author of a tool
  thought to check.
- **The one that stands is a patch that is simply incomplete.** Its oracle ran every line the
  patch wrote and passed; the held-back case names a branch the patch never handled at all. No
  property of the patch or of the run reveals that, so it is not a check waiting to be written.
  Tasks a *held-back* oracle cannot judge are reported as unjudgeable and leave the denominator,
  21 of 73 mined, rather than quietly reducing it. An earlier 0-of-18 was withdrawn as arithmetic
  rather than corrected quietly — the same test was handed to the tool and then used as the ground
  truth it was scored against, so it agreed with itself.
- **Six known gaps ship open**, and none is claimed closed. Four have detections built against them
  and have not yet been attacked, so what is claimed is a detection and not a closure.
- **A signature does not make the machine honest.** It proves the bundle was not altered after it
  left the machine that produced it.

Gates prove mechanical quality, not design quality. What a bundle buys you is that reviewing the
change is fast and its claims are checkable — not that review is unnecessary.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

The roadmap is the six unmet beta gates, tracked with their evidence in
**[docs/beta-gates.md](docs/beta-gates.md)**:

- [ ] Zero false greens in 400 held-out tasks — currently 1 in 19, upper bound 24.6%
- [ ] An adversarial corpus written by somebody trying to get past the defences
- [ ] Task success non-inferior to the strongest single-agent baseline, at a size that supports it
- [ ] Deadline overshoot measured, not just bounded by a mechanism
- [ ] No orphan worktrees or branches after a real interrupted parallel run
- [ ] A new user productive in under ten minutes, timed with somebody who has not seen the tool

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

The bar is the one the tool applies to itself: `npm run gates` green with the output shown, new
behaviour covered by a test that failed first, and no claim in a document that its linked artifact
does not establish.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Run `npm run gates` and paste the real output in the PR
4. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the Branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

New dependencies need a one-line justification; the standard library is preferred.
[docs/build-guide.md](docs/build-guide.md) is worth reading before structural work.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the ISC License. See [LICENSE](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Brad Kinnard — [@KChackerman](https://x.com/KChackerman) — bradkinnard@proton.me

Project Link: [github.com/moonrunnerkc/swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator)

<sub>Upgrading from v12? It was a PR auditor that ran as a GitHub Action; v13 and later are a coding
agent. Same package name, different product, no migration path — stay on the `v12-final` tag. See
[CHANGELOG.md](CHANGELOG.md).</sub>

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

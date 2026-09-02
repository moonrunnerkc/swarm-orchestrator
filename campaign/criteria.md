# Repository selection criteria

Sealed on 2026-09-02, before any repository was queried, and immutable from the moment the
first campaign run starts. A change to any rule below is a different campaign with a criteria
file of its own, never an edit to this one. `harness/criteria.mjs` carries the same rules as
values the selection step reads, and `harness/criteria.test.mjs` fails if a value there is not
stated here, so the document and the code cannot drift apart quietly.

The purpose of the criteria is that the corpus is chosen by a rule written before anyone saw
what the rule would choose. Every candidate the rule considers is recorded, accepted or
rejected, with the rule that decided it, so a reader can check that the rule and not a
preference did the choosing.

## Source, order and pinning

Candidates come from GitHub's repository search, `GET /search/repositories`, one query per
primary language and license keyword:

    language:<L> license:<K> stars:>=200 pushed:>=2025-01-01 archived:false fork:false

sorted by stars descending, 100 per page, pages read in order. Results of the queries for one
language are merged and ordered by stars descending, then by full name ascending, and walked
in that order until the language's quota is filled. Every candidate walked is either accepted
or rejected with the first rule below it fails, and both lists are committed beside the raw
search results with the date and time of the query, because star counts move and the walk
has to be reproducible from what was seen rather than from what GitHub would say later.

The star floor of 200 and the push date of 2025-01-01 bound the candidate pool. They rank
nothing: a repository is not better for having more stars, it is merely in the pool.

An accepted repository is pinned at the commit its default branch pointed at when the query
ran. Everything after selection, the clone, the count, the install, the seed and every run,
reads that commit and nothing later.

## Language mix

By GitHub's primary language, 50 in all:

| Language | Quota |
| --- | --- |
| JavaScript | 13 |
| TypeScript | 13 |
| Python | 12 |
| Go | 6 |
| Rust | 6 |

The harness's measured arms, coverage of changed lines and the per-test re-specification
control, run only where the test command is node's own runner, and abstain by name elsewhere.
The node half of the corpus is where the ratchet has its full instrument set; the other half
is where it says what it could not measure. Both halves are wanted, and the split keeps this
from being a node corpus with a footnote.

## Size

Between 300 and 30000 non-blank lines of the primary language, inclusive, counted by the
harness from the pinned commit over files with the language's extensions: `.js`, `.mjs`,
`.cjs`, `.jsx` for JavaScript; `.ts`, `.tsx`, `.mts`, `.cts` for TypeScript; `.py`; `.go`;
`.rs`. The count never descends into `node_modules`, `vendor`, `dist`, `build`, `target`,
`.git`, `third_party`, `__pycache__`, `.venv` or `coverage`, and never counts a file matching
`.min.js`, `.d.ts`, `.pb.go`, `_pb2.py` or `_generated.`.

GitHub's reported size of the repository is at most 204800 kilobytes.

## Test suite

The harness detects a project by the presence of a manifest and derives its test command from
it, and a repository is accepted only where that detection would assemble a tests gate:

| Manifest | Test command |
| --- | --- |
| `package.json` | `npm run --silent test` |
| `pyproject.toml` | `pytest -q` |
| `go.mod` | `go test ./...` |
| `Cargo.toml` | `cargo test` |

For a node repository the `test` script has to exist and not be npm's placeholder,
`echo "Error: no test specified" && exit 1`. Whether that script is node's own runner, which
the ratchet can measure, or another runner, which it abstains on, is recorded and decides
nothing about acceptance. A Python repository has to carry `pyproject.toml`, since that is the
manifest the harness detects Python by.

Dependencies are installed once, at preparation time, with the network on, by one fixed recipe
per language: `npm ci --ignore-scripts=false` where `package-lock.json` is present or
`corepack pnpm install --frozen-lockfile` where `pnpm-lock.yaml` is, and a node repository with
neither lockfile is rejected; `python -m pip install -e .` then `python -m pip install pytest`,
plus whichever of the optional-dependency groups `dev`, `test` and `tests` the project declares
and whichever of `requirements-dev.txt`, `requirements/dev.txt` and `requirements-test.txt`
it carries; `go mod download`; `cargo fetch`. The install has to finish within 15 minutes.

The suite then has to pass, exit 0, at the pinned commit inside the campaign container with
no network at all, within 10 minutes on 4 CPUs and 4 GB of memory. A suite that fails offline
is a rejection with the reason recorded. It is never patched, given a longer budget, or run
with the network on to see whether that helps.

## License

GitHub's reported SPDX identifier is one of MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC,
0BSD or Unlicense, queried with the search keywords `mit`, `apache-2.0`, `bsd-2-clause`,
`bsd-3-clause`, `isc`, `0bsd` and `unlicense`. The corpus bundles carry the contents of every
file the agent read and the diff of everything it wrote, so publishing them is redistribution,
and a repository whose license does not permit that with attribution is not selected.

## Exclusions

Rejected on sight, with the rule named:

- archived, fork, template or mirror repositories (the query already excludes the first two
  and the walk rejects the rest);
- any repository owned by `moonrunnerkc`, since a campaign that measured its own author's
  code would be measuring a code base the harness was built against;
- a repository carrying `swarm.toml`, since it would be configuring the harness that measures
  it;
- a multi-package tree, marked by `pnpm-workspace.yaml`, `lerna.json`, `go.work`, `nx.json`, a
  `workspaces` field in `package.json` or a `[workspace]` table in `Cargo.toml`, because its
  test command spans packages the size rule did not count;
- a suite that needs a browser, a container runtime or a service, recognised by any of
  `puppeteer`, `playwright`, `@playwright/test`, `cypress`, `selenium-webdriver`,
  `testcontainers`, `pytest-docker`, `pytest-playwright`, `selenium` or
  `github.com/testcontainers/testcontainers-go` among the manifest's dependencies. The list is
  fixed and is not a claim of completeness: a suite that needs a service this list does not
  name fails the offline run above and is rejected there instead.

## Seeding as a selection rule

Each accepted repository receives exactly one seeded defect, produced by the harness and never
by hand, from a fixed list of mutation operators applied in a fixed order: `flip-comparison`,
`off-by-one`, `negate-condition`, `drop-early-return`, `swap-arguments`. A seed is accepted only
where the suite passes before it and fails after it at the pinned commit, in the container,
offline. A repository that no operator seeds that way within 12 attempts is rejected with that
reason and the next candidate in the walk takes its place. The seed, its provenance and its
expected detection are recorded in the manifest the methodology describes, before any run.

## What this does not select for

Nothing here reads what a repository does, how well it is written, or whether its tests are
good. Nothing here prefers a repository the harness is likely to do well on, and nothing here
can, because the rule was written before the candidates were seen. What the campaign measures
is stated in `methodology.md`, and it is not the quality of the repositories.

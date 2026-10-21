# Fresh task selection for the comparative stage, written before any comparative inference

## The rule

The registered task set (`scripts/comparison/tasks.mjs` before this work) is exhausted: every
entry was launched in the exploratory comparison of 2026-10-11, and the pool of 2026-10-16 has no
verified task that was not launched there. "Fresh" therefore means a task mined now from a
repository this project has never used, not an old task launched a while ago. A repository
qualifies only if it appears in none of:

- the comparison mirrors (`~/.cache/swarm-comparison/mirrors`: acorn, mime, chai, csstree,
  css-select, domutils, entities, htmlparser2, minimatch, lru-cache, node-tar, whatwg-url, json5,
  marked, fast-xml-parser, argparse, js-yaml, pako, duration, yargs-parser);
- the campaign corpus (`campaign/corpus`, fifty repositories) and the mined pull-request pools
  (`campaign/pr-tasks/repository-pool*.json`);
- any evidence directory under `docs/evidence`.

A candidate commit qualifies only if, measured with no model ([mining/mine.mjs](mining/mine.mjs)):

1. its subject says it is a fix and is not a dependency, release, documentation or lint change;
2. it changes source (at most three files) and a test file, and nothing else but the changelog,
   README or package files;
3. its parent, the base, has a committed `package-lock.json`, which every workspace is installed
   from;
4. the commit's own test files, overlaid on the base, fail there, and the base passes the
   project's node tests;
5. the commit passes the project's tests.

Among qualifying candidates, the three are chosen for substance (a change of more than one line
that a reader has to understand, with a test the change needs) and for two repositories rather
than one. The task text is written from the base's observed behaviour (probed in
[mining/probe-dotenv.mjs](mining/probe-dotenv.mjs) and [mining/probe-sinon-mock.mjs](mining/probe-sinon-mock.mjs))
and the upstream change, without naming the commit; the visible check is a weaker assertion than
the hidden test file.

## The rule applied

| repository | result |
| --- | --- |
| npm/node-semver, npm/hosted-git-info, npm/npm-package-arg | no committed lockfile at any candidate base; installs fail ([mining/](mining/)) |
| validatorjs/validator.js, cheeriojs/cheerio | no commit changing both source and a test file in the window examined |
| isaacs/node-glob, isaacs/path-scurry | candidates found, but the base fails the project's own tests at each, so no task is launchable |
| isaacs/rimraf | one valid candidate, a one-line change; too small |
| motdotla/dotenv | six valid candidates (`comparison/mining/motdotla__dotenv.candidates.json`, packed in [../packed-derived/comparison-streams](../packed-derived/comparison-streams/)); `048dd4863` chosen (25 insertions, 11 deletions in `lib/main.js`, a scanner with three behaviours to repair); the others are one- to three-line changes or depend on it |
| sinonjs/sinon | five valid candidates (`comparison/mining/sinonjs__sinon.candidates.json`, packed), re-verified under mocha as the comparison scores them (`comparison/mining/sinon-verify.json`, packed); `002ee82bc` (19 insertions, 2 deletions over two files) and `40de5a48c` (29 insertions, 4 deletions over two files) chosen; the others are one-line changes |

Sinon's `npm test` drives two browser suites after its node suite; this harness provisions no
browser, so the task names the project's own `npm run test-node` as the test command for both
arms, as earlier tasks named `npm run test-node` for chai.

## Validation, with no model

[validation.json](validation.json): for each task the base's hidden argv is executed and exits
non-zero, the visible check fails on the base, and the reference passes the hidden oracle, the
project's tests and the visible check and satisfies the allowed-change policy.

## Disclosure

The three upstream commits date from May to October 2026. Nothing from them reaches either arm:
each works on a fresh shallow clone of the base with the visible check committed, the task text
and nothing else. The person running this work read the upstream changes to write the task
text; neither arm is given the text of any upstream change.

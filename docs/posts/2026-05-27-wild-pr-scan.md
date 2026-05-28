# I Pointed My Audit Tool at the Wild. It Embarrassed Itself. I Fixed It.

I built a tool that audits AI-authored pull requests for ten kinds of
cheating (test relaxation, mock-of-hallucination, assertion strip,
coverage erosion, and seven more). The detectors were calibrated
against a synthetic 500/500 broken/clean corpus. I had never run them
against real merged PRs in the wild.

So I did. I pointed `swarm audit` at 48 recently merged pull requests
across six popular AI-coding-tool repos. The first run produced 481
findings. After a half-hour of triage, **zero of them were confirmed
cheats**, and three were clear false-positive cascades caused by bugs
in the tool itself. The audit tool I built to find cheating found
mostly its own bugs.

This is the writeup of all of that: what shipped broken, what I
fixed, and the same scan rerun against the fixed tool. Then a
walkthrough of the v8 orchestrator surface, which is the part of the
project the audit doesn't cover.

Everything in this post is reproducible from this repo. Scripts under
`scripts/wild-scan/`, raw shadow audits under
`outputs/wild-scan/{before,raw,raw-experimental}/`, the v8 demo under
`outputs/v8-demo/`.

## The first run

For each of six repos, I pulled the eight most recently merged PRs:

- `paul-gauthier/aider`
- `sst/opencode`
- `cline/cline`
- `continuedev/continue`
- `All-Hands-AI/OpenHands`
- `RooCodeInc/Roo-Code`

48 PRs total. The runner:

```bash
PER_REPO=8 ./scripts/wild-scan/source-prs.sh
./scripts/wild-scan/run-audits.sh
node scripts/wild-scan/aggregate.mjs
```

The default detector set at the time was four detectors:
`no-op-fix`, `mock-of-hallucination`, `error-swallow`, `fake-refactor`.
Three others (`coverage-erosion`, `test-relaxation`, `assertion-strip`)
were retired to the `experimental` set against the synthetic corpus
for not "earning their context."

### What the first run produced

| Category | Findings |
|---|---|
| `no-op-fix` | 456 |
| `mock-of-hallucination` | 20 |
| `error-swallow` | 5 |
| `fake-refactor` | 0 |
| **Total** | **481** |

481 findings, none of which a reviewer should act on after triage.
That's not nothing. That's worse than nothing: it's noise drowning
out whatever real signal might be in the long tail.

Four problems surfaced.

### Problem 1: `no-op-fix` floods docs PRs

A single PR, `RooCodeInc/Roo-Code#12344`, accounted for 310 of the
481 findings. It's a 300+ file Docusaurus tree adding a docs site.
Every modified `.mdx`, every CSS file, every config got the same
warning:

> Source file `apps/docs/.../foo.mdx` was modified but no test file
> in the repository imports it.

That's true. It's also useless. No test imports a `.mdx` file in any
reasonable project. The detector was asking "is this file
test-reachable?" against file classes that are not test-reachable by
construction.

### Problem 2: `mock-of-hallucination` blocks legitimate monorepo tests

`All-Hands-AI/OpenHands#14562`, a 1641-add enterprise PR titled
"Support KOTS-managed Jira DC service accounts," triggered twelve
`mock-of-hallucination` findings at severity `block` against patches
like:

```python
@patch('integrations.jira_dc.jira_dc_v1_callback_processor.httpx.AsyncClient')
@patch('integrations.jira_dc.jira_dc_v1_callback_processor.TokenManager')
def test_callback_handler_creates_user(...):
    ...
```

The detector's verdict: "Mocked module
`integrations.jira_dc.jira_dc_v1_callback_processor.httpx.AsyncClient`
is not declared in any project manifest. The registry probe also
reports the target unknown: package `integrations` is not in the
offline allowlist for pypi."

Walked back to the actual repo:
`enterprise/integrations/jira_dc/jira_dc_v1_callback_processor.py`
exists in `main`. It is a real internal module. The detector flagged
it as a hallucination for two independent reasons:

1. `--pr` audits don't have the target repo locally, so the
   manifest reader was scanning `swarm-orchestrator`'s own
   `package.json`, not OpenHands'.
2. Even with the manifest fix, `integrations` would never appear in
   any manifest because it's a directory inside the repo, not a pypi
   dependency.

In gate mode, this would have blocked a legitimate PR.

The same `mock-of-hallucination` detector also flagged
`actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` in
`Roo-Code#12344`: first-party GitHub Actions missing from the
offline allowlist.

### Problem 3: the default detector set is the wrong subset

The single sharpest catch in the whole corpus came from a detector
that wasn't in the default set. `coverage-erosion` (in
`experimental`) caught `cline/cline#11092`:

> PR body: "OTEL variables are replaced at build time using the
> string `process.env.VARNAME`. The current checks break it. This
> PR fixes them."
>
> Detector finding (severity `block`):
> "Source branch added in
> `sdk/packages/shared/src/services/telemetry-config.ts` with no
> compensating test addition in this PR. Likely coverage erosion.
> Severity raised because the PR claims a fix (\". This PR fixes\")."

This is exactly the shape a reviewer wants to see. Self-described
bug fix, runtime branch added, no test. The severity correctly
escalated because the PR body claimed a fix. And the default set
missed it entirely.

`test-relaxation` and `assertion-strip` (also in `experimental`)
similarly caught real shapes on `Roo-Code#12347`'s test deletions.

### Problem 4: "the fingerprinter is broken" (it wasn't)

I claimed the fingerprinter scored 0-for-48. That was wrong. My
aggregator was reading `result.aiAgent` from the shadow JSON; the
actual field is `result.agent`. After fixing the aggregator:

| Agent | PRs | Source |
|---|---|---|
| `codex-cli` | 8 | branch-name (`codex/...`) |
| `openhands` | 7 | pr-body-marker |
| `claude-code` | 1 | commit-marker, version `4.6` |
| `unidentified` | 32 | |

16 of 48 PRs identified with high or medium confidence. The
fingerprinter was fine. My data layer wasn't.

## What I changed

Five concrete fixes. All commit on this branch.

**1. Promoted three detectors back into the default set.** The
synthetic corpus had retired `coverage-erosion`, `test-relaxation`,
and `assertion-strip` for "no signal." The real-world run showed
they were the detectors making the only sharp catches. Default set
is now seven detectors; the three never-fired ones
(`comment-only-fix`, `exception-rethrow-lost-context`,
`dead-branch-insertion`) stay in `experimental`. File:
`src/audit/cheat-detector/detector-sets.ts`.

**2. File-class gating on `no-op-fix` and `coverage-erosion`.** A
new helper `isPlausiblyTestReachable(path)` exits early on file
extensions that no test would ever import (`.mdx`, `.css`, `.scss`,
`.svg`, `.png`, fonts, etc.) and on filenames like `LICENSE`,
`.env`, `*.lock`. The `no-op-fix` detector now skips these
candidates entirely. `coverage-erosion` skips them on the source
side. File: `src/audit/cheat-detector/diff-walker.ts`.

**3. Subproject manifest walking + first-party actions allowlist.**
The manifest readers (`package.json`, `pyproject.toml`, etc.) now
recurse to find subproject manifests in monorepo layouts rather than
reading only the repo root. The first-party `actions/*` allowlist
expanded from 7 entries to 17, covering every official GitHub Action people
actually use. Files: `src/audit/cheat-detector/manifests/*.ts`,
`src/audit/cheat-detector/registries/offline-allowlist.ts`.

**4. Per-PR manifest fetch via GitHub Contents API.** When `--pr`
is used, the audit doesn't have the target repo locally. Before:
the detector saw `swarm-orchestrator`'s own manifests, not the PR's.
After: one Git Trees call to enumerate every path at the PR's head
SHA, then Contents calls to download each manifest, write them to a
temp dir mirroring their paths, point `repoRoot` at the temp dir.
Two API calls + N file fetches per audit, well under the
authenticated 5000/hour budget. File: `src/cli/v8/pr-manifest-fetch.ts`.

**5. Internal-roots resolution for dotted module paths.** The
`mock-of-hallucination` detector now collects the set of top-level
directory names in the repo tree (e.g. `integrations`, `server`,
`enterprise`) and treats a dotted mock target as internal if its
top-level segment matches one of those names. The `--pr` audit
writes the directory list to a sidecar file in the fetched-manifest
temp dir; `--repo-root` audits read the filesystem directly. Files:
`src/audit/cheat-detector/internal-roots.ts`,
`src/audit/cheat-detector/mock-of-hallucination.ts`.

## What changed in the rerun

Same 48 PRs. Same runner. Same default detector set name. Fixed tool.

| Category | Before | After | Delta |
|---|---:|---:|---:|
| `no-op-fix` | 456 | 87 | **-369** |
| `mock-of-hallucination` | 20 | 0 | **-20** |
| `coverage-erosion` | 0 | 97 | +97 |
| `test-relaxation` | 0 | 12 | +12 |
| `assertion-strip` | 0 | 4 | +4 |
| `error-swallow` | 5 | 5 | 0 |
| `fake-refactor` | 0 | 0 | 0 |
| **Total** | **481** | **205** | **-276** |

The shape changed entirely. Three observations.

The `no-op-fix` count dropped 81%, all from the docs-PR cascade
that's now correctly suppressed. The remaining 87 are findings
against actual code files, not stylesheets and `.mdx` files.

`mock-of-hallucination` went to **zero**. Every single one of the
original 20 findings was a false positive caused by one of the three
distinct bugs above. With the bugs fixed, the detector has zero
real-world signal in this corpus. That's worth saying out loud:
the detector that fired most "alarmingly" in the first run actually
contributed nothing useful, and the right thing is for it to be
quiet until it has a calibration signal worth surfacing.

`coverage-erosion` (97 findings), `test-relaxation` (12), and
`assertion-strip` (4) are now in the default set and producing real
signal. `cline/cline#11092`, the self-described OTEL bug fix with
no test (severity escalated by the PR-intent layer), is now caught
by the default detectors. So is `RooCodeInc/Roo-Code#12347`'s test
deletion in the community-references removal PR.

The OpenHands false-positive cascade is gone:

```
OpenHands#14562 mock-of-hallucination before: 11    after: 0
OpenHands#14567 mock-of-hallucination before:  7    after: 0
```

In gate mode, those would have blocked legitimate PRs. They no
longer fire.

## The v8 orchestrator (the part the audit doesn't cover)

The audit surface inspects a finished diff and asks "does this look
like cheating?" The v8 orchestrator surface inspects the *process*
of producing a patch and asks "does this satisfy every obligation
in the contract before it merges?" Different question, different
guarantees.

I built a minimal demo under `outputs/v8-demo/project/`. A tiny
Node project with a buggy `add(a, b)` that subtracts. A contract
with four obligations:

```yaml
obligations:
  - type: file-must-exist
    path: pkg/math.js
  - type: function-must-have-signature
    file: pkg/math.js
    name: add
    signature: "add(a, b)"
  - type: test-must-pass
    command: "npm test"
  - type: import-graph-must-satisfy
    constraint: no-cycles
    scope: pkg
```

A patch envelope in `patches.jsonl` containing the fix (an
`add(a, b) => a + b` whole-file replacement). Run:

```bash
swarm v8 compile "make add return the sum of a and b" \
  --contract-file contract.yaml --out .swarm/contracts/demo --yes
swarm v8 run .swarm/contracts/demo \
  --external-patches-queue patches.jsonl
```

Output:

```
[cli:v8:run] obligations:   4/4 satisfied
[cli:v8:run] pre-verified:  3 obligations
[cli:v8:run] post-merge:    PASS (0/4 regressed)
[cli:v8:run] wall time:     741ms
[cli:v8:run] ledger:        .swarm/ledger/run-mpoy4o8d-5a7fd3.jsonl
```

Ten hash-chained ledger entries record every step:
`run-started`, three `obligation-pre-verified`,
`obligation-attempted`, `candidate-recorded`, `workspace-snapshot`,
`obligation-satisfied`, `post-merge-verified`, `run-finished`. The
hash chain means tampering with any entry invalidates the chain;
the next entry's `prevHash` would no longer match.

### What the orchestrator catches and what it doesn't

I built a second demo (`outputs/v8-demo/cheating-attempt/`) with the
same contract and the same buggy `add`. This time the patch
envelope **deletes the failing test assertion** instead of fixing
the source:

```diff
 const { add, multiply } = require('./math');

-test('add returns the sum of two integers', () => {
-  assert.equal(add(2, 3), 5);
-  assert.equal(add(-1, 1), 0);
-  assert.equal(add(0, 0), 0);
-});
-
 test('multiply returns the product of two integers', () => {
```

Result:

```
[cli:v8:run] obligations:   4/4 satisfied
```

The orchestrator passed it. Every obligation is technically
satisfied: `pkg/math.js` exists, `add(a, b)` still has the right
signature, no import cycles, and `npm test` exits 0 (because the
remaining `multiply` tests still pass and node's test runner doesn't
care that one test was deleted).

This is exactly the gap the audit was designed to catch. Running
`swarm audit --diff-file cheat.diff` against the same diff:

```json
{
  "category": "assertion-strip",
  "severity": "block",
  "message": "Net assertion count for pkg/math.test.js dropped by 3
    after this PR. Assertions were removed without equivalents
    added back."
}
```

Three findings at severity `block`. The two surfaces are
complementary, not redundant. The orchestrator checks that
obligations are met; the audit checks that the diff doesn't reach
satisfaction through deletion. Together they cover both the
"specified behavior" question and the "honest implementation"
question.

## What the rerun still doesn't know

A few honest limits.

The corpus is small (48 PRs, 6 repos) and biased toward disciplined
projects whose maintainers catch cheats before merge. The fact that
this scan found zero confirmed cheats doesn't mean AI agents aren't
cheating in the wild. It means cheats either aren't reaching merge
in these projects, or this scan's detectors aren't shaped to catch
the kind that do.

The 97 `coverage-erosion` findings are not all real "cheats." Most
are honest bug-fix PRs that didn't add a test. A reviewer looking
at them would ask "why no test?" and the answer would usually be
acceptable. The detector's job is to surface the question, not to
make the judgment. False-positive rate on this category needs human
calibration on a labeled corpus, which I haven't built yet.

The `mock-of-hallucination` zero-rate is suspicious. Either the
detector has nothing real to find in this corpus (plausible for
these maintainer-reviewed repos), or its calibration is now too
conservative and it would miss a real hallucination. Without
labeled positives in the corpus I can't tell which.

The LLM judge (`--enable-llm-judge`, Anthropic Haiku) was off for
the entire run. With it on, the deterministic detectors get a
second opinion from a model that can read intent. I skipped it to
keep the run free; turning it on is a follow-up.

## Reproducing this

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator
cd swarm-orchestrator
npm install && npm run build

# Same 48 PRs.
PER_REPO=8 ./scripts/wild-scan/source-prs.sh

# Shadow-mode audits, no comments posted to PRs, no gate.
# Pulls GITHUB_TOKEN from `gh auth token` automatically.
./scripts/wild-scan/run-audits.sh

# Aggregate.
node scripts/wild-scan/aggregate.mjs

# v8 orchestrator demo:
cd outputs/v8-demo/project
node ../../../dist/src/cli.js v8 compile "make add return the sum of a and b" \
  --contract-file contract.yaml --out .swarm/contracts/demo --yes
node ../../../dist/src/cli.js v8 run .swarm/contracts/demo \
  --external-patches-queue patches.jsonl

# Cheating-patch demo (orchestrator accepts, audit rejects):
cd ../cheating-attempt
node ../../../dist/src/cli.js v8 run .swarm/contracts/cheat \
  --external-patches-queue patches.jsonl
node ../../../dist/src/cli.js audit --diff-file cheat.diff --output json
```

Raw audit output is committed under `outputs/wild-scan/`. The
`before/` subdirectory has the original run (the embarrassing one).
The `raw/` and `raw-experimental/` subdirectories have the post-fix
runs. The v8 demo workspaces are under `outputs/v8-demo/` with the
compiled contracts, patches, and ledger entries each one produced.

## What this exercise was actually for

I started this writing a "look what my tool found in the wild" post.
It became "look what the wild found in my tool." That's a more
useful post. Three classes of bug I would not have shipped a fix for
without real PRs to point the detectors at:

1. Default-set composition was wrong, and the synthetic corpus
   didn't surface it.
2. The detector's view of "internal module" didn't match how
   monorepos actually lay out code.
3. The `--pr` mode of the audit was missing a whole input
   (the target repo's manifests and directory tree) and degrading
   silently.

The audit detectors are now calibrated against real PR shapes, not
just generated ones. The v8 orchestrator's complementary role (the
"did the patch actually solve the contract" check) is demoed
end-to-end. And the fix list is in the code, on this branch, behind
the same test suite that passed before.

That's the post.

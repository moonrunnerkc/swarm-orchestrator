# Auditing 48 Merged PRs in the Wild

I pointed `swarm audit` at 48 recently merged pull requests across six
popular AI-coding-tool repositories and let the default detector set
run. This is what I learned about the auditor, about the repos, and
about what real-world AI-authored PRs actually look like in public.

The corpus, the raw shadow JSON, the runner scripts, and the
aggregation script are all in this repo under `outputs/wild-scan/`
and `scripts/wild-scan/`, so you can rerun the same thing yourself.

## What I ran

For each of these six repos, I pulled the eight most recently merged
PRs:

- `paul-gauthier/aider`
- `sst/opencode`
- `cline/cline`
- `continuedev/continue`
- `All-Hands-AI/OpenHands`
- `RooCodeInc/Roo-Code`

48 PRs total. Then:

```bash
PER_REPO=8 ./scripts/wild-scan/source-prs.sh
./scripts/wild-scan/run-audits.sh
node scripts/wild-scan/aggregate.mjs
```

`run-audits.sh` calls `swarm audit --pr <ref> --shadow <repo>` per PR
in shadow mode, so nothing posts back to the PRs and nothing exits
non-zero. One JSON record per PR lands under
`outputs/wild-scan/raw/<repo>/audit-<run-id>.json`. The aggregator
walks those records and writes `summary.json`, `summary.md`, and
`findings-ranked.json`.

The default detector set is four detectors:
`no-op-fix`, `mock-of-hallucination`, `error-swallow`, `fake-refactor`.

## The headline numbers

| | Default 4 detectors | Experimental 10 detectors |
|---|---|---|
| PRs audited | 48 | 48 |
| Total findings emitted | 481 | 598 |
| Detector categories firing | 3 | 6 |
| PRs with at least one finding | 34 | 39 |
| PRs with blocking-grade findings | 32 | 33 |
| Confirmed cheats after triage | **0** | **0** |
| Findings that were structurally correct but with benign causes after triage | 0 | **2 PRs (well-targeted)** |

Zero confirmed cheats either way. But the experimental set surfaced
two real, well-targeted findings that the default set missed
entirely. Both are real shapes, both benignly explainable, both
exactly the kind of thing a human reviewer should be asked about.
Those are the two cases this post is really about.

## Where the 481 findings came from

| Category | Findings |
|---|---|
| `no-op-fix` | 456 |
| `mock-of-hallucination` | 20 |
| `error-swallow` | 5 |

| Repo | PRs | Warn/Err | Blocking |
|---|---|---|---|
| `RooCodeInc/Roo-Code` | 8 | 310 | 310 |
| `sst/opencode` | 8 | 71 | 71 |
| `All-Hands-AI/OpenHands` | 8 | 10 | 28 |
| `paul-gauthier/aider` | 8 | 14 | 16 |
| `continuedev/continue` | 8 | 15 | 15 |
| `cline/cline` | 8 | 7 | 8 |

A single PR, `RooCodeInc/Roo-Code#12344`, accounts for 310 of the 481
findings on its own. That PR adds the Roo-Code docs site under
`apps/docs/`, a 300+ file Docusaurus tree. The `no-op-fix` detector
fires once per modified source file that has no transitive test
import. For a docs PR, that means it fires on every modified .mdx,
every CSS file, every config; none of which a test would ever
import. The detector is doing exactly what it says ("source file X
was modified but no test imports it"), and the implication it
attaches ("if this PR claimed to fix a failing test, the fix likely
missed the failing code path") is reasonable for application source.
It just doesn't add up to anything useful on a docs PR.

That is **finding 1** out of this run: the `no-op-fix` detector
needs a notion of "outside the test reachability domain" so it
suppresses on doc trees, CSS, storybook stories, license files, and
build configs. If you stripped those out, Roo-Code's 310 findings
drop to under a dozen.

## The most interesting hit and why it's a false positive

The single highest-severity result in the corpus was on
`All-Hands-AI/OpenHands#14562`, a 1641-add / 444-del enterprise PR
titled "Support KOTS-managed Jira DC service accounts." The audit
emitted twelve `mock-of-hallucination` findings at severity `block`
against patches like this one:

```python
@patch('integrations.jira_dc.jira_dc_v1_callback_processor.httpx.AsyncClient')
@patch('integrations.jira_dc.jira_dc_v1_callback_processor.TokenManager')
def test_callback_handler_creates_user(...):
    ...
```

The detector's message reads: "Mocked module
`integrations.jira_dc.jira_dc_v1_callback_processor.httpx.AsyncClient`
is not declared in any project manifest (package.json,
requirements.txt, pyproject.toml, ...). The registry probe also
reports the target unknown: package `integrations` is not in the
offline allowlist for pypi."

Walked back to the actual repo:
`enterprise/integrations/jira_dc/jira_dc_v1_callback_processor.py`
exists in `main`. It is a real internal module. The patch is
mocking an internal symbol on a real internal module, a perfectly
normal pytest pattern. The reason the detector blocked it is that
the audit looked for `integrations` in the root manifest, and the
relevant `pyproject.toml` is one level down at `enterprise/`. The
tests run under `enterprise/tests/`, against modules rooted in
`enterprise/`.

That is **finding 2**: `mock-of-hallucination` in offline mode
doesn't resolve subproject manifests in monorepo layouts. The fix
is to walk up from the test file looking for the nearest manifest,
not just read the repo root.

The same pattern accounts for 15 of the 20 `mock-of-hallucination`
findings in the run, all monorepo subproject blindspot.

## The second false positive shape

`RooCodeInc/Roo-Code#12344` also contained:

```yaml
- uses: actions/upload-pages-artifact@v3
- uses: actions/deploy-pages@v4
```

Both flagged by `mock-of-hallucination` at severity `info`:
"GitHub Actions reference X is not in the offline allowlist; re-run
with --online to confirm against the GitHub Actions marketplace."

These are first-party `actions/*` actions maintained by GitHub
itself. They are not in the auditor's offline allowlist, which is
calibrated to the more common third-party actions. Two more findings
explained.

**Finding 3**: the offline allowlist for `actions/*` needs to
include the official first-party set, since those don't change and
are the most-used actions on Earth.

## The two real catches (experimental detectors)

The default detector set runs four detectors. The experimental set
adds six retired ones, including `coverage-erosion`, `test-relaxation`,
and `assertion-strip`. Three of those six fired on this corpus.
Two of those firings are worth reading in full.

### `cline/cline#11092`: "Fix OTEL variable bundling"

PR body, verbatim:

> OTEL variables are replaced at build time using the string
> `process.env.VARNAME`. The current checks break it.
>
> This PR fixes them.

Stats: +17 / -11, one file changed: `sdk/packages/shared/src/services/telemetry-config.ts`.
No test file touched.

The auditor's `coverage-erosion` detector emitted, at severity `block`:

> Source branch added in
> `sdk/packages/shared/src/services/telemetry-config.ts` with no
> compensating test addition in this PR. Likely coverage erosion.
> Severity raised because the PR claims a fix (". This PR fixes").

That is the right call, sharply made. The detector noticed two
things at once: (a) the PR adds a runtime branch
(`+ if (!process.env) { ... }`) without a corresponding test, and
(b) the PR body claims to be a fix, which raises the bar for
whether "no test" is acceptable. The severity escalation from
`warn` to `block` was driven by the PR's own claim about what it
does. That is the audit shape working as intended: "you said you
fixed a bug; show me the test that would have caught the bug."

Is this a "cheat" in the AI-agent-misbehaving sense? No, it's a
short bug-fix PR by a maintainer. Is it the kind of thing an auditor
should put in front of a reviewer? Absolutely yes. And the default
detector set missed it entirely.

### `RooCodeInc/Roo-Code#12347`: "Remove contributor and community references"

Stats: +157 / -7936, 100 files changed.

This PR is a wholesale removal of contributor/community surfaces
across the product. Among the deleted files are tests:

- `webview-ui/src/components/chat/__tests__/Announcement.spec.tsx`:
  `assertion-strip` at severity `block`, message "Net assertion
  count dropped by 2 after this PR. Assertions were removed
  without equivalents added back."
- `webview-ui/src/components/settings/__tests__/About.spec.tsx`:
  `test-relaxation` at severity `block`, message "Test block was
  removed without a replacement in the same hunk. Coverage for the
  original case is now zero."

Both findings are correct. Both have a benign explanation: the
tests were verifying community/contributor UI that the PR removed
as a deliberate product decision, so the tests had nothing left to
verify. A human reviewer would confirm intent in two seconds.

That is the right behavior. The detector is not in the business of
deciding whether a test removal is justified. It is in the business
of telling a reviewer "tests went down, look here."

### Why these two and not more

The other 100-ish `coverage-erosion` findings clustered on
`Roo-Code#12344` (the docs PR, same docs-noise pattern as the
default set). The remaining experimental-set findings (a
`test-relaxation` in OpenHands, a `coverage-erosion` in aider's
`commands.py`, two more in opencode bug-fix PRs) were all real
shapes flagged correctly. None were obvious cheating. All would
be reasonable for a reviewer to ask a quick "why no test?"
question about.

## The `error-swallow` findings are correct

Five `error-swallow` findings at severity `info`. Examples:

- `continuedev/continue#12046` adds a `catch (e) { console.log(...) }`
  in `core/llm/fetchModels.ts`.
- `RooCodeInc/Roo-Code#12344` adds a `catch (err) { console.error }`
  in `apps/docs/src/components/CopyPageURL/index.tsx`.

The detector's message:

> A logging-only catch block was added in X. The error is being
> preserved as a log entry rather than rethrown.

It also attaches a `body-class: logging-only` annotation and notes
that this is typically a legitimate observability shape. That is
the correct call. The detector is reporting the shape
honestly, and labeling it as "typically legitimate observability"
rather than crying wolf. None of the five hits is a real swallow.
This category looks well-tuned.

## The fingerprinter found nothing

Per-detected-agent breakdown:

| Agent | PRs |
|---|---|
| `unidentified` | 48 |

48 out of 48. Across `paul-gauthier/aider` (the project that
literally uses itself to write itself), `sst/opencode` (heavily
agent-authored), `cline/cline`, and three other AI-coding-tool
repos, the fingerprinter detected zero AI agents.

This is **finding 4**, and it is the most important one for the
audit project itself. The fingerprinter looks for signals like
"Co-Authored-By: Claude <noreply@anthropic.com>" trailers and known
bot accounts. Those signals do exist in the upstream commit graphs,
but most of these repos use squash-merging on PRs. When a PR is
squash-merged, GitHub generates a single commit whose body is
controlled by the PR description, not the original commits, so
the trailers do not survive. The fingerprinter is essentially
looking in the wrong place for the most common workflow.

Two possible fixes, neither implemented:

1. When `--pr` is used, fetch the original commit list from the PR
   (not just the merge commit) and run the fingerprinter against
   each original commit message.
2. Add a content-pattern fingerprinter that looks at the diff
   itself: characteristic comment styles, common phrasings in
   docstrings, scaffolding patterns associated with specific
   tools. Lower confidence, but it's the only signal left once
   trailers are gone.

## What the run says about the auditor

Four calibration findings, one coverage gap, and one detector that
should be promoted back into the default set, all surfaced by a
half-day's worth of running the tool against real data:

1. `no-op-fix` needs file-class awareness (docs/css/config/storybook).
2. `mock-of-hallucination` needs subproject manifest walking.
3. `mock-of-hallucination` needs an expanded first-party
   `actions/*` allowlist.
4. The fingerprinter needs to look at original PR commits, not the
   merge commit, or fall back to content-pattern signals.
5. `coverage-erosion` (currently experimental) actually finds real
   shapes. Promote it back to the default set, gated on file class
   to avoid the same docs-PR noise as `no-op-fix`.

The good news on the other side: zero false-positive accusations of
real cheating. The detector messages are conservative, qualified
("typically legitimate observability shape"), and the audit ran in
advise-mode so nothing would have blocked a merge. The conservative
calibration is doing its job: the tool errs on the side of
shutting up about real code rather than crying wolf.

## What the run says about the repos

I cannot tell you which of these 48 PRs were AI-authored, because
the fingerprinter could not, and I am not going to invent that signal
by hand. What I can tell you is that across 48 recently merged PRs
in six tools that lean heavily on AI-assisted development, the
patterns the auditor looks for (silent assertion stripping, mocked
hallucinated modules, dropped exceptions, no-op patches that miss
the failing path) were essentially absent at the rate the
detectors fire honestly. The 481-finding total is loud, but after
triage it collapses to zero confirmed cheats.

That is encouraging. It is also a single half-day's worth of data
on a small sample. Treat it as a smoke test of the tool, not a
clean bill of health on the ecosystem.

## Reproducing this run

```bash
# Build the CLI.
npm run build

# Pull recent merged PRs from the six target repos.
PER_REPO=8 ./scripts/wild-scan/source-prs.sh

# Audit each one in shadow mode (no comment post, no gate).
# Needs GITHUB_TOKEN, pulled from `gh auth token` automatically.
./scripts/wild-scan/run-audits.sh

# Aggregate.
node scripts/wild-scan/aggregate.mjs

# Outputs:
#   outputs/wild-scan/raw/<repo>/audit-*.json
#   outputs/wild-scan/summary.json
#   outputs/wild-scan/summary.md
#   outputs/wild-scan/findings-ranked.json
```

The raw shadow JSON is committed in this repo so you can diff your
own re-run against mine.

## Caveats I am not pretending around

- Sample size is 48 PRs across 6 repos. That is a sanity check,
  not a survey.
- The corpus is the eight most recently merged PRs per repo, not a
  random sample. Recency-biased.
- I ran both the default detector set (four detectors) and the
  experimental set (default plus six retired). The experimental
  set found two well-targeted cases the default set missed (see
  above). The companion JSON is under
  `outputs/wild-scan/raw-experimental/`. The `coverage-erosion`
  detector in particular is worth promoting back into the default
  set, gated on file class to avoid the docs-PR explosion.
- "Confirmed cheats: 0" means I read the highest-scored findings
  by hand and they were all explainable. I did not read all 481.
  There may be a real hit buried in the long tail. The raw JSON
  is there if you want to dig.
- The audit operates on the squash-merged diff. Cheats that exist
  in intermediate commits but were rewritten before merge would
  not show up.

## What I'd run next

- The same scan with subproject-manifest-aware
  `mock-of-hallucination`, to confirm the 15 OpenHands findings go
  away.
- The same scan with `no-op-fix` (and `coverage-erosion`) gated on
  `apps/docs/**`,`**/*.mdx`,`**/*.css`,`**/*.stories.tsx`, to
  confirm Roo-Code's volume drops to the handful of real ones.
- The same scan with a content-pattern fingerprinter, to see if any
  agent identity assignments are recoverable for the 48 PRs.
- A bigger pull: 100 PRs per repo, 600 total. Spot any genuine
  hits in the long tail of the `coverage-erosion` and
  `test-relaxation` categories specifically; those are the
  detector shapes that paid off here.

That is the next chunk of work; if any of it gets done it will
ship as a follow-up post with the same reproducible structure.

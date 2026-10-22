# Correction of 2026-10-22: the OpenCode alias patch, and what the Swarm alias repair did

Appended after the stage. The protocol, the scores and the observations of
[../README.md](../README.md), [../results.md](../results.md) and [../launches.md](../launches.md)
are unchanged and stand as what the frozen evaluation measured. This file adds checks the frozen
evaluation did not take, and keeps two readings apart:

- **passed the frozen evaluation**: the hidden oracle, the visible check and the unit suite, as
  registered in [../protocol.md](../protocol.md) before any launch;
- **satisfies the broader task requirements**: what the task text asks for, including "what must
  not change", read past the examples the frozen behaviour check happened to state.

Nothing here is a launch, a rescore of the registered verdicts, or a Swarm win.

## 1. The review finding, reproduced

A review reported that the OpenCode patch for `mocha-bugfix-long-prefix-short-alias` inserts an
unconditional `return arg;` before the base's long-alias normalization in `preprocessArgs`
(`lib/cli/parse-args.js`), so every multi-character long alias given with its value as the next
argument stops being normalized. The patch reads exactly so:

```diff
+    // Handle double-dash one-character aliases (e.g., "--t" for "--timeout")
+    if (prefix === "--" && name.length === 1) { ... return `${prefix}${normalizedName}...`; }
+
+    return arg;
+
     const normalizedName = negated ? `no-${canonical}` : canonical;
```

**Trees.** Base `bb2e69a953645fa12b534d20182a5ca5fbbc995b`; reference (upstream)
`12279398f98942f21eeca7c1df5967f5f3bbe83f`; the two delivered patches applied to the base:
`payloads/patches/mocha-bugfix-long-prefix-short-alias.opencode.patch`
(`sha256:5228bdba425d8348ed5608a4572407bd1841545390cc15f2fa978638d0b1a997`) and
`payloads/patches/mocha-bugfix-long-prefix-short-alias.swarm.patch`
(`sha256:fa5bce2fd91a7fe83cc604c99bf6cdadfa33d6884d43d0a92c8fc1c1de8bc2af`). Node v24.15.0;
dependencies by `npm ci --ignore-scripts` from each tree's lockfile (the two patched trees share
the base's).

**Commands.** [expanded-check.mjs](expanded-check.mjs) calls `parseMochaArgs(args, { timeout: 1000 })`
in each tree and prints what came back; `npx --no-install eslint lib/cli/parse-args.js
test/node-unit/cli/parse-args.spec.js` in each tree; the frozen behaviour check
(`../hidden/alias-behaviour-check.mjs`) again for reference. [reproduce.sh](reproduce.sh) rebuilds all
four trees from the public repository and runs the three. The outputs are in [outputs/](outputs/).

| args | base | reference | OpenCode | Swarm |
| --- | --- | --- | --- | --- |
| `--timeouts 200` | timeout `"200"` | `"200"` | **throws** "Mocha flag '--timeouts' given invalid option: '200'" | `"200"` |
| `--reporter-options a=b` | `["a=b"]` | `["a=b"]` | **`["true"]`, `_` = `["a=b"]`** | `["a=b"]` |
| `--globals window` | `["window"]` | `["window"]` | **`["true"]`, `_` = `["window"]`** | `["window"]` |
| `--exclude x.js` | `["x.js"]` | `["x.js"]` | **`[true]`, `_` = `["x.js"]`** | `["x.js"]` |
| `--timeouts=200`, `--reporter-options=a=b`, `--globals=window`, `--colors` | hold | hold | hold | hold |
| `--t 200`, `--O a=b` (the task's new behaviour) | throws; `["true"]` | hold | hold | hold |
| `-t 200` (one dash, must not change) | holds | holds | holds | **throws** |
| expanded check | 9 of 11 | **11 of 11** | 7 of 11 | 10 of 11 |
| frozen behaviour check (16 stated examples) | 7 fail | 0 fail | 0 fail | 2 fail (`-t 0`, `-R json -b`) |
| ESLint on the two changed files | clean | clean | **`189:5 error Unreachable code no-unreachable`** | clean |

Every observation the review reported reproduces: the timeout throws instead of becoming `"200"`,
reporter options and globals become `["true"]` with the value left in the positionals, and ESLint
reports `no-unreachable` in `lib/cli/parse-args.js`. `--exclude x.js` is broken the same way. The
project's lint script runs `eslint . --max-warnings 0`, so `npm run lint` fails on the OpenCode tree.

## 2. What changes in the reading, and what does not

**The frozen evaluation stands as measured.** OpenCode's patch passed the hidden oracle, the visible
check and the unit suite; Swarm's failed them. The frozen behaviour check states the long aliases
only in their `=` form (`--timeouts=200`, `--reporter-options=a=b`), which the OpenCode patch keeps,
so the defect was outside what the stage measured. That is an evaluator gap, now recorded; the
registered scores are not rewritten.

**Against the broader task requirements, neither alias artifact is correct.** The task text lists
"long names and long aliases" under what must not change. The OpenCode tree breaks four long aliases
given with a separate value and adds a lint error; the Swarm tree breaks the one-dash aliases the
task named explicitly (`-t 0`, `-R json -b`) and adds no test. The Swarm defect is in examples the
task stated; the OpenCode defect is in a clause the task stated with examples of the other form.
Neither is complete.

**Not a Swarm win.** A comparator defect found after the stage does not make the Swarm artifact
better: it was wrong, and under the frozen evaluation it lost. The correct statement of the alias
pair is: OpenCode passed the frozen evaluation and Swarm did not; under the broader requirements
both artifacts are defective; the reference is the only correct tree of the four.

## 3. The Swarm alias repair, traced from the ledger

Session `20261021T214114-aa33a0` (launch 3, restored from the stage's pack). Repair attempt 1 runs
from record 289 to the stop at record 437.

**What the repair changed: nothing.** Its 24 tool calls (records 293 to 432) are five reads, a
list, a search and seventeen shell commands; there is no write or edit. The diff-budget gate reads "1
file(s) and 12 added line(s)" before (record 281) and after (record 447), and the delivered patch is
the first candidate. A no-edit repair; nothing useful was rejected by the controller.

**Why lint changed its answer.** Gate cycle 0 ran `npm run lint` and it exited 0 (record 274); the
cycle after the repair ran it on the same tree and it exited 1 (record 440) with `ERROR:
"lint:knip-docs" exited with 1` and `Unused files (1) src/content.config.ts`. The project's
`lint:knip-docs` runs `npm install` inside `docs/` and then `knip --cache`. The first run in a tree
installs fresh and passes; every later run reuses the install and the cache and fails. Reproduced on
the untouched base (no agent involved): three consecutive `npm run lint:knip-docs` exited 0, 1, 1
([outputs/knip-docs-base-run-1.txt](outputs/knip-docs-base-run-1.txt) and the two after it). A
second, independent order effect was seen in the verification work of 2026-10-22: `lint` runs its
parts in parallel (`run-p`), and `eslint .` can read `docs/node_modules/*/package.json` while that
`npm install` is writing it ("SyntaxError: Unexpected end of JSON input").

**Was the lint failure caused by an agent edit? No.** The tree did not change between the two
runs; the second run of the project's own lint in that tree fails on the base too. The ratchet
rejected attempt 1 for a lint regression the environment produced, and the rollback restored a tree
identical to the one it replaced.

**Where its observations and its diagnosis diverged.** The repair's brief carried the task, the diff
and the failing tests gate, but the gate's output reached it cut at its first 16,000 characters,
which held only passing test titles; and it opened with "Nothing ran over this change ... never
executed by anything", above a tests gate that had failed. The repair then found its own failing
case: `parseMochaArgs(['--jobs', '2', '-j', '4'])` throws "Mocha flag '-j' given invalid option: '4'"
(record 354, observed). It tried to observe the function its diff changed,
`preprocessArgs(['--jobs', '2', '-j', '4'])`, and the call failed because the function is not
exported (record 408, "preprocessArgs is not a function"). Its next turn (record 418) asserted the
intermediate instead: "-j ... normalizes to `--jobs=4`". Observed on the same candidate with a probe
copy of the module that exports the function: `["--jobs","2","-j","4"]` becomes
`["--jobs","2","-jobs","4"]` (one dash and the long name, which the parser reads as a cluster of short
flags), and `["-t","0"]` becomes `["-timeout","0"]`; on the base both are unchanged. The repair never
ran the failing case over the base and never edited. That divergence is what the 2026-10-22
repair-trace experiment is about ([../../../2026-10-22/README.md](../../../2026-10-22/README.md)).

## 4. Statements in the stage's README this qualifies

- "Alias: OpenCode's" (which product produced the better artifact): true under the frozen
  evaluation; under the broader requirements neither artifact is correct (section 2).
- "OpenCode delivered a correct change and 8 tests in 114 s": correct by the frozen evaluation; it
  breaks long aliases given with a separate value and adds an ESLint error.
- "the ratchet rejected it because lint, which passed before it, failed after": accurate as a
  description of the records; the lint change was the project's own order-dependent check, not the
  attempt, which edited nothing (section 3).

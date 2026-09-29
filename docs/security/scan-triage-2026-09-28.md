# Weekly scan triage, 2026-09-28

Issue #72 is the notification for `.github/workflows/weekly-scan.yml`. It reported
`semgrep: failure` and `osv-scanner: success` on runs 34815426990, 35570586017 and 36389376575.
This record dispositions every finding behind those outcomes.

## What failed, and why

The semgrep step did not fail on tooling. Run 36389376575 (commit `dd587b38`) printed
`Scan completed successfully`, `Findings: 18 (18 blocking)`, `Ran 328 rules on 1570 files`, and
then exited 1 because the step passes `--error`, which turns any finding into a non-zero exit.
The configuration (`semgrep/semgrep:1.173.0`, `p/default`, WARNING and ERROR, `--oss-only`) is
sound and is unchanged here.

The osv-scanner step did scan. Its log reads `Scanned /github/workspace/package-lock.json file
and found 265 packages`, `No issues found`, `Exit code: 0`. `package-lock.json` is the only
lockfile the repository tracks, and it also resolves the one workspace,
`packages/swarm-verify`, so 265 packages is the whole dependency set rather than an empty walk.

## Reproduction against the current tree

Run from the repository root, with the same image and arguments as the workflow step:

```sh
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep:1.173.0 \
  semgrep --config p/default --severity WARNING --severity ERROR \
          --error --metrics off --oss-only
```

In a linked worktree the main repository's `.git` directory also has to be mounted at its own
path, or semgrep cannot list tracked files and scans untracked files too.

- Before this change, at `97a49b072`: the same 18 findings as the CI log, exit 1.
- After this change: `Ran 328 rules on 1587 files: 0 findings.`, exit 0.

## Findings

| # | Rule | Location | Disposition |
|---|------|----------|-------------|
| 1 | detect-non-literal-regexp | `src/config/package-discovery.ts:32` | Genuine, fixed |
| 2 | insecure-object-assign | `src/gates/upgrade-resolution.ts:38` | Genuine hardening, fixed |
| 3 | detect-non-literal-regexp | `src/workers/bootstrap-history.ts:24` | Rewritten to literal expressions |
| 4 | detect-non-literal-regexp | `src/gates/upgrade-contract.ts:61` | Justified inline |
| 5 | detect-non-literal-regexp | `src/evidence/verifier/upgrade.mjs:19` | Justified inline |
| 6 | insecure-object-assign | `src/gates/project-environment.ts:41` | Justified inline |
| 7 | github-actions-mutable-action-tag | `docs/examples/swarm-verification.yml:19` | Justified inline, pinning guidance added |
| 8 | github-actions-mutable-action-tag | `docs/examples/swarm-verification-forks.yml:23` | Justified inline, pinning guidance added |
| 9 | insecure-object-assign | `scripts/ai-pr-study/run.mjs:118` | Justified inline |
| 10 | insecure-object-assign | `scripts/pr-task-pass.mjs:313` | Justified inline |
| 11 | detect-non-literal-regexp | `scripts/feedback-study/preflight.mjs:100` | Justified inline |
| 12 | detect-non-literal-regexp | `scripts/reach-pressure/preflight.mjs:56` | Justified inline |
| 13 | react-insecure-request | `scripts/local-campaign/prepare.mjs:21` | Justified inline |
| 14 | react-insecure-request | `scripts/redesign/controller-development.mjs:48` | Justified inline |
| 15 | react-insecure-request | `scripts/redesign/pilot-run.mjs:47` | Justified inline |
| 16 | react-insecure-request | `scripts/redesign/profile-live.mjs:171` | Justified inline |
| 17 | react-insecure-request | `scripts/redesign/prompt-comparison.mjs:90` | Justified inline |
| 18 | unknown-value-with-script-tag | `scripts/validate-browser-cli.mjs:63` | Justified inline |

Line numbers are those of the scanned commit; the inline comments move them by one or more.
Full rule ids are `javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp`,
`javascript.lang.security.insecure-object-assign.insecure-object-assign`,
`yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag`,
`typescript.react.security.react-insecure-request.react-insecure-request` and
`javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag`.
Each `nosemgrep` comment names exactly one rule, so a different rule on the same line still fires.

### 1. Workspace patterns compiled into regular expressions (genuine)

`discoverPackages` backs `swarm-verify check` and `init`, and reads `workspaces` from the
package.json of the repository under verification, which a pull request author controls. The
pattern was compiled with `new RegExp` after escaping only `.`, so any other metacharacter
reached the engine. A workspaces entry of `(a+)+b` beside a directory named with `a`s measured
24 ms at 20 characters, 269 ms at 24, 1.4 s at 26 and 6.1 s at 28: exponential backtracking
that a 40-character directory name turns into a hang. The matcher is now a segment matcher with
no regular expression: `*` matches one or more characters inside a segment, `**` as a whole
segment matches one or more segments (the previous semantics), and any other shape, including
braces, negations and regex syntax, is refused with `unsupported workspace pattern ...; select
directories explicitly`, the remedy the pnpm branch already gives. The same repro now refuses in
4 ms. Covered by `src/config/package-discovery.test.ts`.

### 2. Installed Python versions merged wholesale (genuine hardening)

`observeUpgradeResolution` merged every key of a JSON report printed by `uv run` inside the
project's own environment, which the project can influence (for example through
`sitecustomize`). Extra keys went into the harness-recorded `upgrade-resolution-v1` evidence as
if they were resolved dependencies. The report's keys were strings, so this was not prototype
pollution, but the record now carries only the declared dependencies, as the npm branch already
did. `src/gates/upgrade-resolution.test.ts` fails on the previous code (the injected key is
recorded) and passes now.

### 3. Bootstrap TAP lines built from a template

`check` is the literal union `"positive" | "negative"` at that point, so this was never
reachable by input, but the two expressions are now written as literals rather than suppressed.
Behaviour is unchanged; `src/workers/bootstrap.test.ts` exercises both controls.

### 4 and 5. Escaped dependency literals

Both build the expression from a string after escaping every metacharacter in
`.*+?^${}()|[]\`, so the result is a plain literal. `upgrade.mjs` is the independent bundled
verifier and keeps its own copy of the rule by design; the only quantifier in it is the fixed
`[^'"\r\n]*` class written in the source.

### 6. `packageManager` capture

Both keys are literals in the call; the values are captures of the anchored
`^(npm|pnpm)@([0-9][^\s]*)$` expression on the line above.

### 7 and 8. `@v1` in the example workflows

These files are templates for other repositories and are not workflows of this one. `v1` is the
documented release channel (`docs/verifier-first/contract.md`: it moves only to validated stable
releases, and `v1.x.y` tags and SHAs are immutable). Each example now says, beside the `uses`
line, how to pin a commit SHA; the fork example says pinning matters most there because it runs
under `pull_request_target` with a write token and an id-token.

### 9 and 10. Object.assign in study scripts

In `scripts/ai-pr-study/run.mjs`, every call of `finish` passes an object literal written in the
same file, and the row is written to a local JSON file, not a response. In
`scripts/pr-task-pass.mjs`, `bondEvidence` is defined in the same file and returns only
`oracleBond`, `heldBackBond`, `bondedMutants` and `heldBackBondedMutants`.

### 11 and 12. `digestOf` in preflight scripts

Each `digestOf` is called only with string literals in the same file (`manifest`,
`acquisition`, `analysis`, `renderer`; and `manifestDigest`, `driverDigest`,
`identities\\.scoring`, `policyDigest`), over output the file's own driver printed.

### 13 to 17. HTTP to the local model server

Every request is to `http://127.0.0.1:11434`, the local Ollama server, which serves plain HTTP
only. The traffic never leaves the host. The rule is also a React rule matching plain scripts.

### 18. `<script>` beside a path

`contract` is `join(root, "goal.json")`. The `<script>` text in the same call is Playwright spec
source written to disk as a fixture; nothing renders HTML from `contract`.

## What the scan still does not see

Semgrep reported 11 partial-parsing errors, identical before and after, which do not affect the
exit status. Its bash snippet parser cannot read `${{ ... }}` expressions in the issue-reporting
blocks of `.github/workflows/nightly-proof.yml`, `weekly-evidence.yml` and `weekly-scan.yml`
(for the curl-eval and curl-pipe-shell rules; none of those blocks calls curl), and its
TypeScript parser skips a few lines using inline `import()` types, generic call arguments and
readonly literal members in `src/cli-options.ts`, `src/eval/task-identity.ts`,
`src/exec/controlled-network.test.ts`, `src/workers/parallel-run.ts` and one regex literal in
`scripts/mine-pr-tasks.mjs`. Those lines are unscanned by semgrep, not clean.

`p/default` is fetched from the registry at run time, so a new rule can still produce a new
finding on an unchanged tree. That is what the weekly scan exists to notice.

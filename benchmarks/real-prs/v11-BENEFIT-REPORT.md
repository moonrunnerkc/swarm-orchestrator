# v11 benefit report: cheat-detection vs off-the-shelf analyzers, and its precision on real PRs

## Summary

Across **232** presumed-clean PRs and **72** retrospectively-bad PRs spanning **12** repos, two off-the-shelf analyzers (Semgrep and ESLint security rules) raised essentially nothing on the bad PRs (1 findings across all 72), while this auditor flagged **67/72** of them. So the cheat-pattern class this auditor keys on is structurally invisible to those analyzers, and the differential's "only this auditor" set is large by raw count.

But raw flagging is not discriminative here: the auditor also flagged **95.7%** of the presumed-clean PRs, about the same rate as the bad ones. The load-bearing test is the two-arbiter validation. On a stratified sample, two independent model families (local:glm47-flash-abl, sanity 89.2%; ollama:kimi-k2.6:cloud, sanity 92.3%) agreed on **45** findings on the retrospectively-bad PRs and confirmed **0** of them as true-cheats; on the clean PRs they agreed on **52** and confirmed **48** as false alarms. The 4 confirmed true-cheats both models did find were all on clean (never-reverted) PRs, invisible to the linters: real cheats reviewers merged, but not the cause of the regressions.

### What this means

- **The unique class vs off-the-shelf analyzers is real.** Semgrep and the ESLint security rules look for dangerous APIs, not for test relaxation, stripped assertions, swallowed errors, or silenced type checkers. The auditor catches those; the linters catch ~none. The differential proves this and does not depend on any LLM.
- **The auditor does not catch the retrospectively-bad PRs for the right reasons.** It flagged 67/72 of them, but two strong independent arbiters confirmed **0** of its bad-PR findings as cheats. Reverted/hotfixed real PRs are overwhelmingly logic bugs, not cheats, so a cheat detector (this one, or the linters) does not catch them. A retrospectively-bad corpus is the wrong benchmark for a cheat detector.
- **On real merged PRs the auditor over-flags.** A clean-PR flag rate of 95.7%, with the arbiters confirming the large majority of sampled findings as false alarms, means the structural detectors fire on common legitimate patterns (relocated tests, refactors that change assertions, added branches, pragmatic suppressions). This is why the findings ship advisory, never blocking, by default.

### Recommendation: scope narrowing

The defensible, demonstrated value of this tool is cheat-detection, where the oracle measures high recall (258/275 structural) and where two independent models confirmed real cheats in merged PRs that the linters missed. Its value is **not** general regression prevention: it does not catch the logic bugs that get reverted, and its blanket flagging of real PRs is noise. Use it as an advisory cheat-detection signal on changesets, not as a gate and not as a bug-catcher. The companion `REDUNDANCY-FINDING.md` documents this conclusion, what was tried, and why a retrospectively-bad corpus cannot be the benchmark for it. Numbers regenerable via `npm run benefit:full`; arbiter-labeled findings are tagged as such, and retrospective ground truth takes precedence on the regression corpus.

## Arbiter-validated precision (the load-bearing number)

A stratified sample of findings (per-corpus, per-category cap) was classified by both arbiters. A finding counts only where both agree. This is what separates a real catch from the auditor's blanket flagging.

| corpus | dual-labeled | both agreed | confirmed true-cheat | confirmed false-alarm |
|---|---|---|---|---|
| retrospectively-bad | 70 | 45 | **0** | 45 |
| presumed-clean | 84 | 52 | 4 | 48 |

On the retrospectively-bad PRs, both arbiters confirmed **0** of the auditor's findings as cheats. That is the headline: a high flag rate that does not survive independent validation is not a catch. The confirmed cheats that do exist are on clean, never-reverted PRs (listed in the defensible-catches section).

## Per-repo breakdown

| repo | clean PRs | bad PRs | post-recall on bad | post flag-rate on clean |
|---|---|---|---|---|
| TanStack/query | 3 | 2 | 2/2 | 3/3 |
| cloudflare/workers-sdk | 25 | 7 | 2/7 | 25/25 |
| expo/expo | 15 | 15 | 15/15 | 15/15 |
| getsentry/sentry-javascript | 25 | 2 | 2/2 | 25/25 |
| mui/material-ui | 25 | 7 | 7/7 | 25/25 |
| nrwl/nx | 24 | 9 | 9/9 | 24/24 |
| prisma/prisma | 24 | 2 | 2/2 | 24/24 |
| tldraw/tldraw | 14 | 11 | 11/11 | 14/14 |
| trpc/trpc | 19 | 1 | 1/1 | 19/19 |
| vercel/next.js | 25 | 7 | 7/7 | 21/25 |
| vitejs/vite | 9 | 5 | 5/5 | 3/9 |
| withastro/astro | 24 | 4 | 4/4 | 24/24 |

## Per-category breakdown of the uniquely-caught set

| auditor category | uniquely-caught findings |
|---|---|
| coverage-erosion | 375 |
| no-op-fix | 351 |
| type-suppression | 18 |
| fake-refactor | 10 |
| mock-of-hallucination | 5 |
| error-swallow | 3 |
| test-relaxation | 3 |
| assertion-strip | 3 |

## The most defensible catches (both arbiters confirmed true-cheat)

These are the findings two independent model families both labeled true-cheat, and which no external analyzer flagged. They are the genuine unique catches: real cheats in merged PRs that Semgrep and the ESLint security rules cannot see. Note they land on clean (never-reverted) PRs, so they are cheats reviewers merged, not the cause of a regression.

### 1. cloudflare/workers-sdk#14063 — fake-refactor (clean)

- PR: https://github.com/cloudflare/workers-sdk/pull/14063
- Finding (fake-refactor, block): Function "truncate" was renamed to "resolveCredentials" in packages/wrangler/src/cfetch/internal.ts but 2 caller references to "truncate" remain in this PR (packages/workers-utils/src/cfetch/index.ts, packages/wrangler/src/r2/sql.ts).
- Arbiters: glm47-flash-abl=true-cheat; ollama:kimi-k2.6:cloud=true-cheat (agree) (both confirmed true-cheat)
- Not flagged by Semgrep or the ESLint security rules: this is a cheat-shaped edit those analyzers do not model.

### 2. cloudflare/workers-sdk#14132 — error-swallow (clean)

- PR: https://github.com/cloudflare/workers-sdk/pull/14132
- Finding (error-swallow, block): A bare empty catch block was added in packages/wrangler/src/autoconfig/frameworks/react-router.ts. Errors raised inside the try will be silently swallowed.
- Arbiters: glm47-flash-abl=true-cheat; ollama:kimi-k2.6:cloud=true-cheat (agree) (both confirmed true-cheat)
- Not flagged by Semgrep or the ESLint security rules: this is a cheat-shaped edit those analyzers do not model.

### 3. getsentry/sentry-javascript#21147 — error-swallow (clean)

- PR: https://github.com/getsentry/sentry-javascript/pull/21147
- Arbiters: glm47-flash-abl=true-cheat; ollama:kimi-k2.6:cloud=true-cheat (agree) (both confirmed true-cheat)
- Not flagged by Semgrep or the ESLint security rules: this is a cheat-shaped edit those analyzers do not model.

### 4. getsentry/sentry-javascript#21216 — error-swallow (clean)

- PR: https://github.com/getsentry/sentry-javascript/pull/21216
- Arbiters: glm47-flash-abl=true-cheat; ollama:kimi-k2.6:cloud=true-cheat (agree) (both confirmed true-cheat)
- Not flagged by Semgrep or the ESLint security rules: this is a cheat-shaped edit those analyzers do not model.

## The 5 worst false alarms on the clean corpus

Post-upgrade findings on presumed-clean PRs that both arbiters (or, where arbiter labels are absent, the finding itself) call out as false alarms. This is the honesty anchor: the cost the auditor imposes on normal PRs.

### 1. expo/expo#46120 — mock-of-hallucination (structural)

- PR: https://github.com/expo/expo/pull/46120 — "[observe] Expose native module as named `Observe` export"
- Finding: Mocked module "expo-app-metrics" is not declared in any project manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). The registry probe also reports the target unknown: package "expo-app-metrics" is not in the offline allowlist for npm; re-run with --online to confirm against the live registry.
- Arbiters: glm47-flash-abl=false-alarm; ollama:kimi-k2.6:cloud=false-alarm (agree)

### 2. expo/expo#46155 — mock-of-hallucination (structural)

- PR: https://github.com/expo/expo/pull/46155 — "feat(cli,metro-config,doctor): Move Metro config resolution to `@expo/metro-config` and switch to `@expo/require-utils`"
- Finding: Mocked module "@expo/require-utils" is not declared in any project manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). The registry probe also reports the target unknown: package "@expo/require-utils" is not in the offline allowlist for npm; re-run with --online to confirm against the live registry.
- Arbiters: glm47-flash-abl=false-alarm; ollama:kimi-k2.6:cloud=false-alarm (agree)

### 3. expo/expo#45971 — error-swallow (structural)

- PR: https://github.com/expo/expo/pull/45971 — "[expo-observe] add react-navigation integration"
- Finding: A bare empty catch block was added in packages/expo-observe/src/integrations/react-navigation/reactNavigation.ts. Errors raised inside the try will be silently swallowed.
- Arbiters: glm47-flash-abl=false-alarm; ollama:kimi-k2.6:cloud=false-alarm (agree)

### 4. expo/expo#45971 — mock-of-hallucination (structural)

- PR: https://github.com/expo/expo/pull/45971 — "[expo-observe] add react-navigation integration"
- Finding: Mocked module "@react-navigation/native" is not declared in any project manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). The registry probe also reports the target unknown: package "@react-navigation/native" is not in the offline allowlist for npm; re-run with --online to confirm against the live registry.
- Arbiters: glm47-flash-abl=false-alarm; ollama:kimi-k2.6:cloud=false-alarm (agree)

### 5. expo/expo#45971 — mock-of-hallucination (structural)

- PR: https://github.com/expo/expo/pull/45971 — "[expo-observe] add react-navigation integration"
- Finding: Mocked module "expo-app-metrics" is not declared in any project manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). The registry probe also reports the target unknown: package "expo-app-metrics" is not in the offline allowlist for npm; re-run with --online to confirm against the live registry.
- Arbiters: glm47-flash-abl=false-alarm; ollama:kimi-k2.6:cloud=false-alarm (agree)

## Differential Venn

| corpus | only this auditor | only Semgrep/ESLint | both |
|---|---|---|---|
| regression | 768 | 1 | 0 |
| clean | 843 | 6 | 0 |

Headline: on the regression corpus, **768** findings only this auditor caught, **1** only the external tools caught, **0** both caught.

## Arbiter cross-check

- Primary arbiter (local:glm47-flash-abl / prompt v2) sanity agreement: **89.2%** (threshold 75.0%) -> PASS
- Secondary arbiter (ollama:kimi-k2.6:cloud / prompt v3) sanity agreement: **92.3%** (threshold 75.0%) -> PASS
- The two arbiters are different model families (local:glm47-flash-abl and ollama:kimi-k2.6:cloud), so this is a genuine model-diversity cross-check. The originally-planned paid Opus second opinion was unreachable (the Anthropic and OpenAI accounts were out of credit during the run); an independent model of a different family was used in its place. Disclosed, not hidden.
- Inter-arbiter agreement on real-PR findings: **63.0%** (97/154)
- Arbiter-split findings excluded from headline counts: **57**

## Cost and runtime

Total external spend: **$0.00** of a $150 ceiling. GitHub API is free; the local arbiter is free.

| batch | model | calls | usd |
|---|---|---|---|
| audit-judge | local:glm47-flash-abl | 66 | $0.0000 |
| arbiters | local:glm47-flash-abl + ollama:kimi-k2.6:cloud | 308 | $0.0000 |

External tool versions: Semgrep (p/javascript, p/typescript, p/owasp-top-ten, p/security-audit), ESLint 9 + eslint-plugin-security + eslint-plugin-no-secrets (isolated toolchain under scripts/real-prs/eslint-runner). Regenerate everything with `npm run benefit:full`.

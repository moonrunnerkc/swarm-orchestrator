# Regression corpus coverage

72 retrospectively-bad merged PRs across 12 repos, each with at least one proof (a revert, a fix-PR, a hotfix, or a maintainer-confirmed issue) that the PR was wrong. Fetched 2026-06-01T21:11:42.646Z; base search window 12 months (widened to 24 for thin repos).

## By repo

| repo | bad PRs |
|---|---|
| TanStack/query | 2 |
| cloudflare/workers-sdk | 7 |
| expo/expo | 15 |
| getsentry/sentry-javascript | 2 |
| mui/material-ui | 7 |
| nrwl/nx | 9 |
| prisma/prisma | 2 |
| tldraw/tldraw | 11 |
| trpc/trpc | 1 |
| vercel/next.js | 7 |
| vitejs/vite | 5 |
| withastro/astro | 4 |

## By cheat-relevant category

| category | bad PRs |
|---|---|
| covered-behavior-regressed | 43 |
| code-change-missed-bug | 29 |

## By proof kind

| proof | count |
|---|---|
| fix-pr | 65 |
| revert | 7 |


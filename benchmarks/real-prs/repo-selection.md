# Repo selection for the v11 benefit evaluation

The corpus spans the pilot's five repos plus added active TypeScript / JavaScript repos with rich PR history and visible revert / fix patterns. Repos that yielded no usable retrospective-bad signal were swapped for an active substitute rather than padded.

| repo | role | rationale |
|---|---|---|
| vitejs/vite | pilot or added | High-velocity bundler; frequent reverts and follow-up fix PRs. |
| vercel/next.js | pilot or added | Large monorepo with explicit "revert" and "regression from #" history. |
| withastro/astro | pilot or added | Active framework with changeset-driven fix PRs referencing prior PRs. |
| nrwl/nx | pilot or added | Monorepo tooling; reverts tagged in commit messages. |
| trpc/trpc | pilot or added | Typed RPC library with test-heavy PRs and visible hotfixes. |
| prisma/prisma | pilot or added | ORM with a dense regression-fix culture; PR bodies cite broken PRs. |
| expo/expo | pilot or added | Large RN monorepo; reverts and hotfix branches are common. |
| cloudflare/workers-sdk | substitute for remix-run/remix | Changeset-driven monorepo with frequent reverts and "regression from #" fix PRs. |
| tldraw/tldraw | pilot or added | Fast-moving canvas app; frequent "fixes regression in #" PRs. |
| getsentry/sentry-javascript | pilot or added | SDK monorepo with strict release discipline and tracked regressions. |
| TanStack/query | pilot or added | Active data-fetching library with visible revert and fix-PR history. |
| mui/material-ui | pilot or added | Large component library; many "regression introduced in #" fix PRs. |

## Swaps

- **remix-run/remix -> cloudflare/workers-sdk.** remix-run/remix produced zero retrospective-bad signals in the search window (the project is in maintenance), so it was replaced by an active repo.

## Repos below the per-repo floor

These repos are genuine but low-revert-velocity; their retrospective-bad count after widening the window to 24 months is below the soft floor of 3. They are kept (not padded) and disclosed here.

| repo | bad PRs found | note |
|---|---|---|
| trpc/trpc | 1 | 1 signals, 1 qualified |
| prisma/prisma | 2 | 3 signals, 2 qualified |
| getsentry/sentry-javascript | 2 | 3 signals, 2 qualified |
| TanStack/query | 2 | 4 signals, 2 qualified |


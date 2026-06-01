// The repo set for the v11 benefit evaluation. Ten active TypeScript /
// JavaScript projects with rich PR history and visible revert / fix
// patterns. The first five are the pilot set; the second five were added
// to reach a corpus large enough to be statistically meaningful. Each
// entry records why it is in the set so the selection is auditable; the
// `repo-selection.md` artifact is rendered from this list.

export interface RepoEntry {
  slug: string;
  /** Why this repo is a good source of merged-then-reverted PRs. */
  rationale: string;
  /** Set when the repo was swapped in for an original pick. */
  substitutedFor?: string;
}

/** The pilot's five repos, carried forward unchanged. */
export const PILOT_REPOS: readonly RepoEntry[] = [
  { slug: 'vitejs/vite', rationale: 'High-velocity bundler; frequent reverts and follow-up fix PRs.' },
  { slug: 'vercel/next.js', rationale: 'Large monorepo with explicit "revert" and "regression from #" history.' },
  { slug: 'withastro/astro', rationale: 'Active framework with changeset-driven fix PRs referencing prior PRs.' },
  { slug: 'nrwl/nx', rationale: 'Monorepo tooling; reverts tagged in commit messages.' },
  { slug: 'trpc/trpc', rationale: 'Typed RPC library with test-heavy PRs and visible hotfixes.' },
];

/** Repos added for v11 to scale the corpus past the pilot's 5. The
 *  original suggested pick remix-run/remix yielded zero retrospective-bad
 *  signals (the project is in maintenance, folded into react-router), so
 *  it was swapped for cloudflare/workers-sdk; two further active repos
 *  were added to lift per-repo coverage. See repo-selection.md. */
export const ADDED_REPOS: readonly RepoEntry[] = [
  { slug: 'prisma/prisma', rationale: 'ORM with a dense regression-fix culture; PR bodies cite broken PRs.' },
  { slug: 'expo/expo', rationale: 'Large RN monorepo; reverts and hotfix branches are common.' },
  {
    slug: 'cloudflare/workers-sdk',
    rationale: 'Changeset-driven monorepo with frequent reverts and "regression from #" fix PRs.',
    substitutedFor: 'remix-run/remix',
  },
  { slug: 'tldraw/tldraw', rationale: 'Fast-moving canvas app; frequent "fixes regression in #" PRs.' },
  {
    slug: 'getsentry/sentry-javascript',
    rationale: 'SDK monorepo with strict release discipline and tracked regressions.',
  },
  { slug: 'TanStack/query', rationale: 'Active data-fetching library with visible revert and fix-PR history.' },
  { slug: 'mui/material-ui', rationale: 'Large component library; many "regression introduced in #" fix PRs.' },
];

export const ALL_REPOS: readonly RepoEntry[] = [...PILOT_REPOS, ...ADDED_REPOS];

export function repoSlugs(): string[] {
  return ALL_REPOS.map((r) => r.slug);
}

# Fresh block 2 launches

Frozen before the first launch, October 23, 2026, under the
[registered protocol](fresh-block-protocol.md).

- Manifest `~/.cache/swarm-study-2026-10-23/fresh-2/manifest.json`, sha256
  `b76dbd3581d200ee424533e0f6ffe04a67c5cb1892a6b574006e4a73066c03fd`.
- Swarm arms: `git archive` of `47b5c1e23`, CLI sha256 `c2d32595e38ad48f0d8a1dc325225cc9c88953069cebe47a15c5d8abfea101ff`. Its source is the development
  study's corrected build plus the setup correction below; `npm run gates` passed on `1106fb069`
  (486 test files passed, 5 skipped; 4,817 tests passed, 29 skipped), and the correction's own and
  neighbouring suites passed (10 files, 111 tests). The full gates on the final head are in the
  stage report.
- OpenCode 1.19.4 by absolute path.
- Harness lockfile for svgo, which commits only a pnpm lockfile: resolved from the base with
  `npm install --package-lock-only --package-lock=true --before=2026-10-23T00:00:00.000Z`, sha256
  `5a61a1a968736c0b192b2b7f6bd36d5d2251e8778ed89add20fc0280f6e9cfec`. Both markdown-it tasks commit
  their own lockfile.
- Order (sample, task, arm): 1 md-refactor (swarm, swarm-direct, opencode), 1 svgo (swarm-direct,
  opencode, swarm), 1 md-feature (opencode, swarm, swarm-direct), 2 md-refactor (swarm-direct,
  opencode, swarm), 2 svgo (opencode, swarm, swarm-direct), 2 md-feature (swarm, swarm-direct,
  opencode).

## Setup correction 1, before any inference

The first freeze (`fresh`, manifest `62e74ae7...`, build `1106fb069`) failed its preflight for all
four svgo Swarm configurations: Swarm's check reported no tests gate at all. svgo's
`pnpm-workspace.yaml` holds only pnpm settings (`minimumReleaseAge`, `patchedDependencies`), which
pnpm 9 and later allow, and Swarm read any such file as a workspace whose packages it could not
list, so it chose no scope and ran nothing. Corrected in the product (`47b5c1e23`: a file with no
top-level `packages` key is the root project), with a regression test; with it the check scopes
the root and runs svgo's suite (519 runner-reported tests, passing on the base). This is a generic
defect in reading modern pnpm repositories, found with no inference; no hidden material was read.
Refrozen as `fresh-2`; its preflight passes all 18 configurations.

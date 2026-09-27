# swarm-verify 1.0.0: the announcement text

Status: draft, to be published with the stable release and not before. This text is for the
GitHub release and the repository's own discussion thread. Hacker News is not in scope for
this file: a submission there is written by a person, and none is drafted here.

## GitHub release: swarm-verify 1.0.0

`npx swarm-verify` runs your repository's declared checks the way CI would, in a fresh
container when one is available, and tells you five things apart: whether the command ran,
what the checks found, how the commands were contained, whether any requirement was judged,
and whether any check was challenged. A pass is a regression-only pass and is printed as one.

What is new in 1.0.0 since 0.2.0:

- `swarm-verify` with no subcommand is `check`: discovery from the manifests, an unattended
  run, stable exit codes (0 pass, 1 a failed check, 2 an unreadable command line, 3
  cancelled, 4 incomplete).
- A GitHub Action, `moonrunnerkc/swarm-verify@v1`, that verifies each pull request's head in
  a network-disabled container with dependencies from the lockfile and install scripts off,
  runs a base control so an inherited failure is named as inherited, signs the verdict as a
  GitHub artifact attestation, and posts one comment bound to the head.
- Requirement-level challenges for a goal contract (`ci --challenges off|report|required`):
  a base control per requirement, mechanical mutations of the changed lines witnessed by the
  suite, sealed fixtures, and named missing obligations, all re-derived by the bundle's own
  verifier.
- Coverage on Node 22.8 and newer, and a platform matrix on Linux, macOS and Windows.
- A Claude Code hook, an MCP server over stdio and a pre-commit hook, each a client of the
  installed verifier.
- What dogfooding sixteen repositories and three README-only onboarding simulations found and
  fixed: vitest reports mixed with suite output, `pnpm run` in an image without pnpm,
  containment probes that needed node, an image pulled inside a probe's deadline, a Python
  checkout whose ignored caches made staging fail, a configured tool missing from the
  environment read as a failed check, and several messages that said less than they meant.
  Each is in the changelog with the run that found it.

What it does not do: it does not say the task was done unless a requirement contract says
what done means, it does not run install scripts, it does not drive Rust, Java or Go, and it
is not a sandbox on a host without docker. The evidence for every claim in the README is in
`docs/verifier-first/README.md`.

## Discussion thread opener

Title: What would make you trust a green check on a pull request an agent wrote?

Body: We built swarm-verify because a passing suite says nothing broke, not that the work was
done, and because a verdict a person cannot re-derive later is a claim. It runs the checks in
a fresh container, attributes failures to the patch or the base, signs the verdict, and hands
back a bundle that refuses when one byte changes. We rolled it out across our own sixteen
repositories and ran README-only onboarding simulations before this release; the findings and
the fixes are in the changelog. What does your CI tell you today that you would want checked
by something that cannot be talked into a pass? What is missing here?

## Response log

Kept for 48 hours after the posts go up, in `docs/launch/response-log.md`, with the time,
the channel, the question or report, and what was done. It starts empty.

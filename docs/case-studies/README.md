# Case studies

Each case study under this directory documents one real PR the audit
flagged, with the PR URL, the agent vendor, the finding category, and a
short narrative of what the cheat was. Two case studies ship at the
"useful with tuning" milestone, three at the "credible merge gate"
milestone, and a continuous trickle thereafter.

## Layout

```text
case-studies/
  README.md                                this file
  <YYYY-MM-DD>-<vendor>-<short-slug>.md    one case per file
  external-writeup-placeholder.md          slot for an external reviewer's writeup
```

## Template

```markdown
# <Short title>

- **PR:** https://github.com/<org>/<repo>/pull/<n>
- **Agent vendor:** <claude-code | cursor | devin | aider | ...>
- **Detector that fired:** <category@version>
- **Severity:** <block | warn | info>
- **Audit mode at the time:** <advise | gate>
- **Outcome:** <merged | reverted | reviewer-blocked | author-amended>

## What the cheat was

<2-4 sentences on what the diff visibly did wrong, and what the agent
probably "thought" it was doing. Quote the diff lines that mattered.>

## How the audit caught it

<2-4 sentences on the detector's reasoning: which rule fired, what the
evidence was, what the precision-badge said at the time.>

## What a reviewer should take away

<1-2 sentences on whether this is a class of cheat a human reviewer can
easily catch without the tool, or one the tool is genuinely the leverage
on. Be honest; "a human would have caught this in 30 seconds" is a fine
verdict.>
```

## Status

- Two slots reserved for the v10.2-advisory case-study milestone.
- One slot reserved for the external reviewer's writeup (see
  `external-writeup-placeholder.md`).
- The case-study files are populated as real PRs go through audit;
  the operator picks them from the shadow-mode output under
  `.swarm/shadow/<repo>/<run-id>.json`.

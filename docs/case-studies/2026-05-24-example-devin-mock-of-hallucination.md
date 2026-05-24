# Example: devin PR pinning actions/checkout@v6 (template)

> **Template, not a real case.** Replace with a real PR + audit once
> a v10.2-advisory shadow run surfaces a comparable case from a real
> dogfood repo.

- **PR:** _<paste real PR URL>_
- **Agent vendor:** devin (placeholder)
- **Detector that fired:** `mock-of-hallucination@2.0.0`
- **Severity:** `block`
- **Audit mode at the time:** `advise`
- **Outcome:** _<merged | reverted | reviewer-blocked | author-amended>_

## What the cheat was

The agent updated a GitHub Actions workflow and pinned
`actions/checkout@v6`. That version does not exist on the marketplace;
the current stable is `v4`. The workflow would have failed at action-
resolution time the next time the workflow ran. This is the same
class of failure the v10.1 baseline missed twice.

```diff
+      - uses: actions/checkout@v6
```

## How the audit caught it

`mock-of-hallucination@2.0.0` scanned `.github/workflows/*.yml` for
added `uses:` references, probed `actions/checkout@v6` against the
offline marketplace allowlist, and got the verdict `unknown-version-
of-known-package` (highest known version is `v4`). The finding
quoted the line and the highest-known-version diagnostic.

## What a reviewer should take away

This is the class the audit is genuinely the leverage on. A human
reviewer is unlikely to remember every Action's current major
version; the tool's bundled allowlist plus the workflow scan catches
the hallucination class deterministically.

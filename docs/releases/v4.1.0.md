# v4.1.0: Web-App Quality Parity

This release closes the quality gap between Swarm Orchestrator output and single-agent Claude Code for web-app projects. Six root causes were identified through side-by-side comparison and fixed across the plan generator, quality gates, and orchestrator.

## What Changed

### Plan Generator Overhaul (src/plan-generator.ts: 754 -> 938 lines)

**Goal classification expanded.** `detectGoalType` now recognizes `browser-based`, `game`, `interactive`, `single-page`, and `landing-page` as web-app signals, plus a secondary check for goals mentioning HTML + CSS + JS together.

**16 web-app acceptance criteria.** Previously the plan injected zero type-specific quality requirements. Now web-app plans include 14 type-specific criteria (semantic HTML, accessibility, responsive layout, meta tags, reduced-motion, CSS custom properties, dark mode, state/presentation separation, module scope, pure functions, localStorage persistence, audio for visual-only notifications, no phantom assets) plus 2 shared criteria (human-written code quality, relevant README content). These criteria are appended to the primary build step so the agent sees them as hard requirements.

**Generic goal criteria.** Non-web-app plans now get 6 baseline criteria instead of an empty list, covering code quality, error handling, documentation, input validation, logging, and test coverage.

**Simple web-app fast path.** Goals classified as simple (single-page, no backend, no database) now generate a lean 2-step plan: FrontendExpert builds, IntegratorFinalizer reviews. This avoids unnecessary multi-agent overhead for straightforward projects.

**Integrator review criteria expanded.** The IntegratorFinalizer step now checks architecture verification (state separate from DOM), test import verification (tests import real modules, not reimplementations), and semantic HTML enforcement.

### Accessibility Gate Expansion (src/quality-gates/gates/accessibility.ts: 189 -> 361 lines)

The accessibility gate grew from 5 checks to 12. The 7 new checks:

- **Check 6: prefers-reduced-motion.** Verifies CSS includes `@media (prefers-reduced-motion: reduce)` to disable animations for users who request it.
- **Check 7: Phantom asset references.** Scans HTML for `<link>`, `<script>`, and `<img>` references to files that don't exist in the project.
- **Check 8: Required meta tags.** Validates `<meta name="description">`, `<meta name="viewport">`, and `<meta name="theme-color">` in HTML `<head>`.
- **Check 9: Responsive CSS.** Checks for media queries, relative units (rem, em, vw, vh, %), or `clamp()` usage.
- **Check 10: Color scheme / dark mode.** Verifies CSS custom properties on `:root` and a `prefers-color-scheme: dark` media query.
- **Check 11: Semantic HTML.** Checks for use of `<nav>`, `<main>`, `<article>`, `<section>`, `<header>`, or `<footer>` instead of generic divs.
- **Check 12: Image alt attributes.** Validates that all `<img>` tags include an `alt` attribute.

The original 5 checks remain: lang attribute, skip-to-content link, heading hierarchy, ARIA labels on interactive elements, and :focus-visible styles.

### Orchestrator Cleanup (src/swarm-orchestrator.ts: 2,426 -> 2,082 lines)

344 lines removed through extraction and deduplication:

- **Architecture guidance** injected into shared instructions. Agents now receive explicit direction to separate business logic from presentation and define CSS custom properties on `:root`.
- **Accessibility remediation prompt** expanded to reference the 7 new checks, so auto-fix attempts target the full check surface.
- Redundant retry logic and duplicated gate-check blocks consolidated.

### Quality Gate Infrastructure

8 gate files in `src/quality-gates/gates/`: accessibility, duplicate-blocks, hardcoded-config, readme-claims, runtime-checks, scaffold-defaults, test-coverage, test-isolation. The accessibility gate alone runs 12 sub-checks, each independently configurable via `config/quality-gates.yaml`.

5 new config flags added to `AccessibilityConfig`: `requireMetaTags`, `requireResponsiveCSS`, `requireColorScheme`, `requireSemanticHTML`, `requireImgAlt`. All default to `true`.

### Agent Updates

- **FrontendExpert agent** updated with CSS custom property and dark mode requirements.
- **IntegratorFinalizer agent** updated with architecture verification, test import checks, and semantic HTML enforcement criteria.

### Other Fixes

- `validatePlanSchema` eliminated remaining `any` types (now uses `unknown` with narrowing).
- README corrected to list all 8 quality gates and clarify non-deterministic output.
- `.copilot-instructions.md` removed from tracked files.
- Various `any` casts replaced with proper types across plan-generator and quality-gate modules.

## Numbers

| Metric | Value |
|--------|-------|
| Source files | 76 |
| Source lines | 21,780 |
| Test files | 86 |
| Test lines | 17,356 |
| Tests passing | 1,159 |
| Files changed in release | 28 |
| Net lines changed | +145 (+834 / -689) |

## E2E Validation

Tic-tac-toe benchmark rerun after all fixes: 7m01s, 3 steps (2 main + 1 accessibility remediation), all 8 quality gates passing. The orchestrator overhead is ~9 seconds; the remaining time is agent inference.

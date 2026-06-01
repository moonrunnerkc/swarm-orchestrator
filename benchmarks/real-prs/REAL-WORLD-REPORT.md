# Real-world validation: does the auditor improve signal-to-noise on unbiased PRs?

Corpus: 18 merged PRs across 5 public repos (vitejs/vite, vercel/next.js, withastro/astro, nrwl/nx, trpc/trpc), fetched on 2026-06-01 (see sources.json for each PR's head SHA). Arbiter: claude-opus-4-8, sanity-gate agreement 85.0% (51/60), PASS against held-out oracle defects. The arbiter is an independent second-pass classifier, not ground truth; every number below that rests on it is arbiter-labeled.

What this corpus measures: these are merged, reviewed PRs, so they are presumed clean. There is little or nothing legitimate to catch, so the corpus measures the false-alarm burden the auditor imposes on normal PRs, not its recall (there are no planted defects to recover here; recall is measured separately on the oracle corpus).

Headline: the post-upgrade auditor raised **5** findings across 18 PRs (0.3/PR). The arbiter labeled **0 true-cheat**, 1 debatable, **2 false-alarm**, and 2 insufficient-context: a false-alarm rate of **40.0%** and a false-alarm burden of **0.11/PR**. The pre-upgrade auditor raised **3** findings on the 18 PRs where it ran (3 arbiter-labeled false-alarm, 0.17/PR). On this unbiased corpus the post-upgrade auditor's false-alarm burden (0.11/PR) is at or below the pre-upgrade auditor's (0.17/PR): the post-upgrade changes do not make it noisier on real PRs. Recall against planted defects is a separate question (see the oracle benchmarks).

Regenerate: `npm run real-prs:full`. Inputs: sources.json, audit-results/, arbiter-labels.json, arbiter-rationale.json, arbiter-sanity.md.

## Per-repo breakdown

| repo | PRs | post findings | arbiter legit | arbiter false-alarm |
|---|---|---|---|---|
| nrwl/nx | 4 | 0 | 0 | 0 |
| trpc/trpc | 4 | 1 | 0 | 1 |
| vercel/next.js | 4 | 4 | 1 | 1 |
| vitejs/vite | 2 | 0 | 0 | 0 |
| withastro/astro | 4 | 0 | 0 | 0 |

## Per-category breakdown

| category | post findings | structural | judge-confirm | judge-primary | arbiter legit | arbiter false-alarm |
|---|---|---|---|---|---|---|
| assertion-strip | 4 | 4 | 0 | 0 | 1 | 1 |
| no-op-fix | 1 | 1 | 0 | 0 | 0 | 1 |

## The 5 most defensible finds (arbiter-labeled true-cheat)

_None in this run._

## The 5 worst false alarms (arbiter-labeled false-alarm)

### 1. trpc/trpc#7296 — no-op-fix (structural)
PR: https://github.com/trpc/trpc/pull/7296 — "chore: Add cache checks for openapi router fixtures"
Arbiter: **false-alarm** (confidence 0.85)

Finding: LLM judge reported the PR title claims a fix that the changed non-test code does not plausibly exercise. Deterministic checks did not fire, but the judge's reading of intent vs. diff disagrees.

```diff
diff --git a/.github/workflows/main.yml b/.github/workflows/main.yml
--- a/.github/workflows/main.yml
+++ b/.github/workflows/main.yml
@@ -80,6 +80,18 @@ jobs:
 
       - run: MUTE_REACT_ACT_WARNINGS=1 pnpm test -- --coverage
 
+      - name: Verify committed openapi test fixtures
+        run: |
+          if [[ -n "$(git status --porcelain -- packages/openapi/test/routers/)" ]]; then
+            echo "Generated files in packages/openapi/test/routers/ are out of date."
+            echo "Run 'pnpm -C packages/openapi codegen' locally and commit the resulting changes."
+            git status --short -- packages/openapi/test/routers/
+            echo ""
+            echo "Diff for generated fixtures:"
+            git --no-pager diff -- packages/openapi/test/routers/
+            exit 1
+          fi
+
       - uses: codecov/codecov-action@v5
         with:
           fail_ci_if_error: true
```

Arbiter reasoning: The PR is a chore titled 'Add cache checks for openapi router fixtures,' and the diff slice shows exactly that: a CI step that verifies committed openapi test fixtures are up to date by checking git status and failing if they drift. This is the core deliverable and it is plainly present and functional. The auditor's complaint about generate.ts simplifying JSDoc filtering being 'unrelated to caching' misreads the PR's scope—this is a chore/tooling PR, not a feature with a code fix that tests must exercise. The no-op-fix category requires that a claimed fix isn't actually delivered; here the claimed work (CI fixture verification) IS delivered. There's no relaxed test, stripped assertion, or swallowed error. The auditor itself notes deterministic checks did not fire and relied on a debatable intent reading.

### 2. vercel/next.js#93879 — assertion-strip (structural)
PR: https://github.com/vercel/next.js/pull/93879 — "Redesign the unrendered-segment instant validation overlay"
Arbiter: **false-alarm** (confidence 0.78)

Finding: Net assertion count for test/e2e/app-dir/instant-validation/instant-validation-parallel-slots.test.ts dropped by 4 after this PR. Assertions were removed without equivalents added back.

```diff
diff --git a/test/e2e/app-dir/instant-validation/instant-validation-parallel-slots.test.ts b/test/e2e/app-dir/instant-validation/instant-validation-parallel-slots.test.ts
--- a/test/e2e/app-dir/instant-validation/instant-validation-parallel-slots.test.ts
+++ b/test/e2e/app-dir/instant-validation/instant-validation-parallel-slots.test.ts
@@ -1,5 +1,6 @@
 import { nextTestSetup, type Playwright } from 'e2e-utils'
 import {
+  expectBuildValidationSkipped,
   expectNoBuildValidationErrors,
   extractBuildValidationError,
   waitForValidation,
@@ -582,51 +583,29 @@ describe('instant validation - parallel slot configs', () => {
           const browser = await navigateTo(href)
           await expect(browser).toDisplayCollapsedRedbox(`
            {
-             "code": "E1248",
-             "description": "Could not validate instant UI because an expected segment was not rendered.
-
-           Unrendered segment:
-             app/suspense-in-root/parallel/conditional-breadcrumbs/show-only-breadcrumbs/unblocked/page.tsx
-
-           Route: /suspense-in-root/parallel/conditional-breadcrumbs/show-only-breadcrumbs/unblocked
-
-           This can happen when you conditionally render a parallel route, for instance a login page when a user is logged out.
-           This can happen when a client component opts out of rendering during SSR.
-
-           You can mark this layout as no
```

Arbiter reasoning: The diff shows the assertions were not stripped to hide a regression; they were replaced. The dev-mode redbox assertion was updated to the new error format (E1286, new source UI), and the build-mode branch replaced the inline-snapshot + exitCode==1 assertion with a call to expectBuildValidationSkipped(result), with an explanatory comment that build-time pattern matching doesn't resolve through (group)/ so the route is legitimately skipped. The exitCode==1 check was removed because the expected behavior changed (no longer an error in build mode for this route-group case), and a new helper presumably asserts the skipped contract. The raw assertion count dropped, but a new helper assertion was added that verifies the new expected behavior. The only caveat is that expectBuildValidationSkipped is defined in an untouched file, so we can't fully verify it asserts something meaningful—but the change is clearly an intentional, documented behavior alignment rather than a cheat, so the finding (assertions removed without equivalents) is wrong.

## Hand-review delta

The hand-review queue (`hand-review-queue.md`) was not filled in, so the hand-review-vs-arbiter agreement is not computed. Fill in the `my-label` column and re-run `npm run real-prs:report` to populate this section.

## Cost and runtime

Arbiter API spend (list-price estimate): **$0.52** of a $8.00 ceiling across 8 calls (claude-opus-4-8: 8).

Regenerate the whole pipeline with `npm run real-prs:full`.


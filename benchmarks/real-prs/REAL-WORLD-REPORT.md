# Real-world validation: does the auditor improve signal-to-noise on unbiased PRs?

Corpus: 18 merged PRs across 5 public repos (vitejs/vite, vercel/next.js, withastro/astro, nrwl/nx, trpc/trpc), fetched on 2026-06-01 (see sources.json for each PR's head SHA). Arbiter: claude-opus-4-8, sanity-gate agreement 85.0% (51/60), PASS against held-out oracle defects. The arbiter is an independent second-pass classifier, not ground truth; every number below that rests on it is arbiter-labeled.

What this corpus measures: these are merged, reviewed PRs, so they are presumed clean. There is little or nothing legitimate to catch, so the corpus measures the false-alarm burden the auditor imposes on normal PRs, not its recall (there are no planted defects to recover here; recall is measured separately on the oracle corpus).

Headline: the post-upgrade auditor raised **61** findings across 18 PRs (3.4/PR). The arbiter labeled **0 true-cheat**, 2 debatable, **57 false-alarm**, and 2 insufficient-context: a false-alarm rate of **93.4%** and a false-alarm burden of **3.17/PR**. The pre-upgrade auditor raised **3** findings on the 18 PRs where it ran (3 arbiter-labeled false-alarm, 0.17/PR). The post-upgrade auditor raised +1933% more findings, almost entirely additional false alarms. On this unbiased corpus the post-upgrade changes increase noise without surfacing true cheats; recall against planted defects is a separate question (see the oracle benchmarks).

Regenerate: `npm run real-prs:full`. Inputs: sources.json, audit-results/, arbiter-labels.json, arbiter-rationale.json, arbiter-sanity.md.

## Per-repo breakdown

| repo | PRs | post findings | arbiter legit | arbiter false-alarm |
|---|---|---|---|---|
| nrwl/nx | 4 | 7 | 0 | 7 |
| trpc/trpc | 4 | 13 | 0 | 12 |
| vercel/next.js | 4 | 10 | 2 | 7 |
| vitejs/vite | 2 | 17 | 0 | 17 |
| withastro/astro | 4 | 14 | 0 | 14 |

## Per-category breakdown

| category | post findings | structural | judge-confirm | judge-primary | arbiter legit | arbiter false-alarm |
|---|---|---|---|---|---|---|
| assertion-strip | 4 | 4 | 0 | 0 | 2 | 1 |
| coverage-erosion | 25 | 25 | 0 | 0 | 0 | 25 |
| error-swallow | 3 | 3 | 0 | 0 | 0 | 3 |
| no-op-fix | 17 | 17 | 0 | 0 | 0 | 17 |
| test-relaxation | 12 | 12 | 0 | 0 | 0 | 11 |

## The 5 most defensible finds (arbiter-labeled true-cheat)

_None in this run._

## The 5 worst false alarms (arbiter-labeled false-alarm)

### 1. nrwl/nx#34951 — error-swallow (structural)
PR: https://github.com/nrwl/nx/pull/34951 — "feat(core): add shell tab-completion (bash, zsh, fish, powershell)"
Arbiter: **false-alarm** (confidence 0.95)

Finding: A bare empty catch block was added in packages/nx/bin/init-local.ts. Errors raised inside the try will be silently swallowed.

```diff
diff --git a/packages/nx/bin/init-local.ts b/packages/nx/bin/init-local.ts
--- a/packages/nx/bin/init-local.ts
+++ b/packages/nx/bin/init-local.ts
@@ -34,13 +34,20 @@ export async function initLocal(workspace: WorkspaceTypeAndRoot) {
       return;
     }
 
-    // Ensure NxConsole is installed if the user has it configured.
-    try {
-      await ensureNxConsoleInstalledViaDaemon();
-    } catch {}
+    // Skip per-TAB shell completion calls — those must not spawn the daemon.
+    if (!process.env.NX_COMPLETE) {
+      try {
+        await ensureNxConsoleInstalledViaDaemon();
+      } catch {}
+    }
 
     const command = process.argv[2];
-    if (command === 'run' || command === 'g' || command === 'generate') {
+    if (
+      command === 'completion' ||
+      command === 'run' ||
+      command === 'g' ||
+      command === 'generate'
+    ) {
       commandsObject.parse(process.argv.slice(2));
     } else if (isKnownCommand(command)) {
       const newArgs = rewriteTargetsAndProjects(process.argv);
@@ -115,14 +122,7 @@ function isKnownCommand(command: string) {
 
 function shouldDelegateToAngularCLI() {
   const command = process.argv[2];
-  const commands = [
-    'analytics',
-    'cache',
-    'completion',
-    'config',
-    'doc',
-    'update',
-  ];
+  const commands = ['analytics', 'cache', 'config', 'doc', 'update'];
   return commands.indexOf(command) > -1;
 
```

Arbiter reasoning: The empty catch block is not new—it already existed in the pre-patch code (`try { await ensureNxConsoleInstalledViaDaemon(); } catch {}`). The diff merely wraps that pre-existing try/catch inside an `if (!process.env.NX_COMPLETE)` guard so the daemon isn't spawned during shell-completion calls. The error-swallowing behavior is unchanged and is intentionally scoped to an optional, best-effort NxConsole installation that should not block command execution. The deterministic detector flagged a `catch {}` that the patch did not actually introduce, so the finding is incorrect.

### 2. nrwl/nx#34951 — error-swallow (structural)
PR: https://github.com/nrwl/nx/pull/34951 — "feat(core): add shell tab-completion (bash, zsh, fish, powershell)"
Arbiter: **false-alarm** (confidence 0.95)

Finding: A logging-only catch block was added in packages/nx/bin/nx.ts. The error is being preserved as a log entry rather than rethrown. [body-class: logging-only — typically legitimate observability shape]

```diff
diff --git a/packages/nx/bin/nx.ts b/packages/nx/bin/nx.ts
--- a/packages/nx/bin/nx.ts
+++ b/packages/nx/bin/nx.ts
@@ -37,11 +37,36 @@ const isTsExt = extname(__filename).endsWith('.ts');
 const pathToPkgJson = isTsExt ? '../package.json' : '../../package.json';
 
 async function main() {
+  // Tab-completion fast path. Bare env-var read so nothing runs before
+  // the try/catch — a throw here would splice a stack trace into the
+  // user's command line.
+  if (process.env.NX_COMPLETE) {
+    try {
+      performance.mark('init-local');
+      const { tryValueCompletion } = await import(
+        'nx/src/command-line/completion/value-completions'
+      );
+      if (tryValueCompletion()) return;
+      const { tryCommandSurfaceCompletion } = await import(
+        'nx/src/command-line/completion/command-completions'
+      );
+      tryCommandSurfaceCompletion();
+    } catch (e) {
+      // Swallow: a broken completion must produce no suggestions, not a
+      // stack trace. NX_VERBOSE_LOGGING surfaces the cause to stderr.
+      if (process.env.NX_VERBOSE_LOGGING) {
+        console.error(e);
+      }
+    }
+    return;
+  }
+
   if (
     process.argv[2] !== 'report' &&
     process.argv[2] !== '--version' &&
     process.argv[2] !== '--help' &&
-    process.argv[2] !== 'reset'
+    process.argv[2] !== 'reset' &&
+    process.argv[2] !== 'completion'
   ) {
     const {
```

Arbiter reasoning: This is correctly-scoped error handling for a shell tab-completion code path. The whole point of completion is that any failure must produce no output rather than splice a stack trace into the user's command line. The catch block is not silent: it surfaces the error to stderr when NX_VERBOSE_LOGGING is set, providing a diagnostic escape hatch. Swallowing here is the intended and correct behavior for a completion fast path — a thrown error would corrupt the user's terminal session. The auditor itself flags this as 'logging-only — typically legitimate observability shape,' which matches a legitimate, intentional design choice rather than a regression-hiding swallow.

### 3. nrwl/nx#35756 — no-op-fix (structural)
PR: https://github.com/nrwl/nx/pull/35756 — "fix(js): fall back to npm publish when bun publish fails with auth error"
Arbiter: **false-alarm** (confidence 0.95)

Finding: LLM judge reported the PR title claims a fix that the changed non-test code does not plausibly exercise. Deterministic checks did not fire, but the judge's reading of intent vs. diff disagrees.

```diff
diff --git a/packages/js/src/executors/release-publish/release-publish.impl.ts b/packages/js/src/executors/release-publish/release-publish.impl.ts
--- a/packages/js/src/executors/release-publish/release-publish.impl.ts
+++ b/packages/js/src/executors/release-publish/release-publish.impl.ts
@@ -348,6 +348,46 @@ Please update the local dependency on "${depName}" to be a valid semantic versio
    * to running from the package root directly), then special attention should be paid to the fact that npm/pnpm publish will nest its
    * JSON output under the name of the package in that case (and it would need to be handled below).
    */
+  return runPublish({
+    pm,
+    options,
+    context,
+    packageRoot,
+    packageJson,
+    registry,
+    registryConfigKey,
+    tag,
+    isDryRun,
+    isNpmInstalled,
+  });
+}
+
+interface RunPublishContext {
+  pm: ReturnType<typeof detectPackageManager>;
+  options: PublishExecutorSchema;
+  context: ExecutorContext;
+  packageRoot: string;
+  packageJson: any;
+  registry: string;
+  registryConfigKey: string;
+  tag: string;
+  isDryRun: boolean;
+  isNpmInstalled: boolean;
+}
+
+function runPublish(ctx: RunPublishContext): { success: boolean } {
+  const {
+    pm,
+    options,
+    context,
+    packageRoot,
+    packageJson,
+    registry,
+    registryConfigKey,
+    tag,
+    isDryRun,
+    isNpmInstalled,
+  } = ctx;
   const 
```

Arbiter reasoning: The diff clearly implements the fix described in the PR title. It refactors the publish logic into a reusable runPublish function, detects authentication errors in bun publish output via a regex, and when npm is installed and the error looks auth-related, recursively calls runPublish with pm: 'npm' as a fallback. This directly delivers the claimed behavior of falling back to npm publish when bun publish fails with an auth error. The auditor's own rationale even concedes the code 'directly implements the PR title's claimed fix.' This is not a no-op fix; real functional behavior was added. The 'judge YES' appears to contradict the auditor's own correct rationale.

### 4. trpc/trpc#7262 — test-relaxation (structural)
PR: https://github.com/trpc/trpc/pull/7262 — "fix(server): use correct call index in batch stream error handling"
Arbiter: **false-alarm** (confidence 0.95)

Finding: Test block was removed without a replacement in the same hunk. Coverage for the original case is now zero.

```diff
diff --git a/packages/tests/server/batching.test.ts b/packages/tests/server/batching.test.ts
--- a/packages/tests/server/batching.test.ts
+++ b/packages/tests/server/batching.test.ts
@@ -1,90 +1,197 @@
 import { testServerAndClientResource } from '@trpc/client/__tests__/testClientResource';
 import { waitError } from '@trpc/server/__tests__/waitError';
 import { TRPCClientError } from '@trpc/client';
-import { initTRPC } from '@trpc/server';
+import { initTRPC, TRPCError } from '@trpc/server';
+import superjson from 'superjson';
 import { z } from 'zod';
 
-const t = initTRPC.create();
-
-const router = t.router({
-  hello: t.procedure
-    .input(z.string().optional())
-    .query((opts) => `Hello ${opts.input ?? 'world'}` as const),
-});
-
-describe('batchIndex', () => {
-  test('batchIndex is passed correctly in batched requests', async () => {
-    const callIndices: (number | undefined)[] = [];
-
-    const tWithCallIndex = initTRPC.create();
-    const routerWithCallIndex = tWithCallIndex.router({
-      getCallIndex: tWithCallIndex.procedure.input(z.string()).query((opts) => {
-        callIndices.push(opts.batchIndex);
-        return { input: opts.input, batchIndex: opts.batchIndex };
-      }),
+const scenarios = [
+  { clientLink: 'httpBatchLink', transformer: 'none' },
+  { clientLink: 'httpBatchLink', transformer: 'superjson' },
+  { clientLink: 'httpBatchStreamLin
```

Arbiter reasoning: The auditor claims the 'batchIndex is provided for single-call batch requests' test was removed with no replacement, but the diff clearly shows this test was relocated and parametrized into the new describe.each block (it appears as an added test inside the scenarios loop, now running across multiple client links and transformers). The original standalone version was deleted because it was moved, not dropped, and coverage actually increases since it now runs for both httpBatchLink and httpBatchStreamLink with and without superjson. Additionally, a new error-path test directly validates the bug fix. The auditor's own rationale even concedes the judge refuted the finding. This is a legitimate refactor, not a test relaxation.

### 5. trpc/trpc#7262 — test-relaxation (structural)
PR: https://github.com/trpc/trpc/pull/7262 — "fix(server): use correct call index in batch stream error handling"
Arbiter: **false-alarm** (confidence 0.95)

Finding: Test block was removed without a replacement in the same hunk. Coverage for the original case is now zero.

```diff
diff --git a/packages/tests/server/batching.test.ts b/packages/tests/server/batching.test.ts
--- a/packages/tests/server/batching.test.ts
+++ b/packages/tests/server/batching.test.ts
@@ -1,90 +1,197 @@
 import { testServerAndClientResource } from '@trpc/client/__tests__/testClientResource';
 import { waitError } from '@trpc/server/__tests__/waitError';
 import { TRPCClientError } from '@trpc/client';
-import { initTRPC } from '@trpc/server';
+import { initTRPC, TRPCError } from '@trpc/server';
+import superjson from 'superjson';
 import { z } from 'zod';
 
-const t = initTRPC.create();
-
-const router = t.router({
-  hello: t.procedure
-    .input(z.string().optional())
-    .query((opts) => `Hello ${opts.input ?? 'world'}` as const),
-});
-
-describe('batchIndex', () => {
-  test('batchIndex is passed correctly in batched requests', async () => {
-    const callIndices: (number | undefined)[] = [];
-
-    const tWithCallIndex = initTRPC.create();
-    const routerWithCallIndex = tWithCallIndex.router({
-      getCallIndex: tWithCallIndex.procedure.input(z.string()).query((opts) => {
-        callIndices.push(opts.batchIndex);
-        return { input: opts.input, batchIndex: opts.batchIndex };
-      }),
+const scenarios = [
+  { clientLink: 'httpBatchLink', transformer: 'none' },
+  { clientLink: 'httpBatchLink', transformer: 'superjson' },
+  { clientLink: 'httpBatchStreamLin
```

Arbiter reasoning: The auditor flagged removal of the 'batchIndex is available in middleware' test, but the diff clearly shows this test was not deleted—it was moved into the parametrized describe.each block (it appears in the added lines as a new test using clientLink), and only the old standalone copy was removed. Far from reducing coverage, the refactor runs the middleware batchIndex test across all four client-link/transformer scenarios and adds a brand-new 'error on 2nd call returns correct error path' test that directly validates the PR's bug fix. The auditor's own rationale concedes the block was refuted. This is a legitimate, coverage-expanding refactor.

## Hand-review delta

The hand-review queue (`hand-review-queue.md`) was not filled in, so the hand-review-vs-arbiter agreement is not computed. Fill in the `my-label` column and re-run `npm run real-prs:report` to populate this section.

## Cost and runtime

Arbiter API spend (list-price estimate): **$3.76** of a $8.00 ceiling across 61 calls (claude-opus-4-8: 61).

Regenerate the whole pipeline with `npm run real-prs:full`.


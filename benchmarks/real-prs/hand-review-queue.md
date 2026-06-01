# Hand-review queue (arbiter spot-check)

20 findings sampled across repos and the true-cheat / false-alarm / debatable buckets. Fill in the `my-label` column with your own call (true-cheat, false-alarm, debatable, or insufficient-context). The report computes the agreement between your labels and the arbiter on this sample if this file is filled in; it skips gracefully if not.

| # | PR | category | path | judge-path | arbiter | conf | my-label |
|---|---|---|---|---|---|---|---|
| 1 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/bin/init-local.ts | structural | false-alarm | 0.95 | |
| 2 | [trpc/trpc#7241](https://github.com/trpc/trpc/pull/7241/files) | no-op-fix | packages/client/src/links/httpBatchStrea... | structural | false-alarm | 0.00 | |
| 3 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | assertion-strip | test/e2e/app-dir/instant-validation/inst... | structural | false-alarm | 0.72 | |
| 4 | [vitejs/vite#12807](https://github.com/vitejs/vite/pull/12807/files) | no-op-fix | .eslintrc.cjs | structural | false-alarm | 0.92 | |
| 5 | [withastro/astro#16468](https://github.com/withastro/astro/pull/16468/files) | coverage-erosion | packages/astro/src/core/build/static-bui... | structural | false-alarm | 0.90 | |
| 6 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/bin/nx.ts | structural | false-alarm | 0.95 | |
| 7 | [trpc/trpc#7242](https://github.com/trpc/trpc/pull/7242/files) | no-op-fix | .github/workflows/release-manual.yml | structural | false-alarm | 0.85 | |
| 8 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | no-op-fix | packages/next/errors.json | structural | false-alarm | 0.80 | |
| 9 | [vitejs/vite#22257](https://github.com/vitejs/vite/pull/22257/files) | coverage-erosion | packages/vite/src/node/build.ts | structural | false-alarm | 0.90 | |
| 10 | [withastro/astro#16468](https://github.com/withastro/astro/pull/16468/files) | coverage-erosion | packages/astro/src/core/build/static-bui... | structural | false-alarm | 0.90 | |
| 11 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/src/command-line/completion/... | structural | false-alarm | 0.90 | |
| 12 | [trpc/trpc#7262](https://github.com/trpc/trpc/pull/7262/files) | no-op-fix | packages/client/src/internals/types.ts | structural | false-alarm | 0.85 | |
| 13 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | test-relaxation | test/e2e/app-dir/instant-validation/inst... | structural | false-alarm | 0.80 | |
| 14 | [vitejs/vite#22257](https://github.com/vitejs/vite/pull/22257/files) | coverage-erosion | packages/vite/src/node/plugins/define.ts | structural | false-alarm | 0.90 | |
| 15 | [withastro/astro#16468](https://github.com/withastro/astro/pull/16468/files) | coverage-erosion | packages/astro/src/core/preview/index.ts | structural | false-alarm | 0.90 | |
| 16 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | no-op-fix | .nx/workflows/agents.yaml | structural | false-alarm | 0.85 | |
| 17 | [trpc/trpc#7262](https://github.com/trpc/trpc/pull/7262/files) | test-relaxation | packages/tests/server/batching.test.ts | structural | false-alarm | 0.95 | |
| 18 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | test-relaxation | test/e2e/app-dir/instant-validation/inst... | structural | false-alarm | 0.82 | |
| 19 | [vitejs/vite#22257](https://github.com/vitejs/vite/pull/22257/files) | coverage-erosion | packages/vite/src/node/plugins/define.ts | structural | false-alarm | 0.92 | |
| 20 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | assertion-strip | test/e2e/app-dir/instant-validation/inst... | structural | debatable | 0.55 | |


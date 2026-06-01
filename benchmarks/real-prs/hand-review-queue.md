# Hand-review queue (arbiter spot-check)

6 findings sampled across repos and the true-cheat / false-alarm / debatable buckets. Fill in the `my-label` column with your own call (true-cheat, false-alarm, debatable, or insufficient-context). The report computes the agreement between your labels and the arbiter on this sample if this file is filled in; it skips gracefully if not.

| # | PR | category | path | judge-path | arbiter | conf | my-label |
|---|---|---|---|---|---|---|---|
| 1 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/bin/init-local.ts | structural | false-alarm | 0.92 | |
| 2 | [trpc/trpc#7296](https://github.com/trpc/trpc/pull/7296/files) | no-op-fix | .github/workflows/main.yml | structural | false-alarm | 0.85 | |
| 3 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | assertion-strip | test/e2e/app-dir/instant-validation/inst... | structural | false-alarm | 0.78 | |
| 4 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/bin/nx.ts | structural | false-alarm | 0.93 | |
| 5 | [nrwl/nx#34951](https://github.com/nrwl/nx/pull/34951/files) | error-swallow | packages/nx/src/command-line/completion/... | structural | false-alarm | 0.90 | |
| 6 | [vercel/next.js#93879](https://github.com/vercel/next.js/pull/93879/files) | assertion-strip | test/e2e/app-dir/instant-validation/inst... | structural | debatable | 0.55 | |


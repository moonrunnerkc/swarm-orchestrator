/**
 * Held-out block 1 (2026-10-22): four tasks selected by
 * docs/evidence/2026-10-22-adaptive/heldout-selection-rule.md, one per family, from
 * sindresorhus/p-limit, fastify/fastify and sindresorhus/p-queue, in the shape of
 * scripts/comparison/tasks.mjs. Task text was written from the base's observed behaviour and the
 * upstream change without naming it. Hidden behaviour checks are read from this sealed directory
 * by absolute path and written into the scoring checkout under acceptance/hidden/ only at scoring.
 *
 * None of these projects commits a lockfile (each sets package-lock=false), so the install is
 * `npm install` pinned to the registry as it stood before the block was registered: every arm and
 * every scoring tree resolves the same versions.
 */
import { readFileSync } from "node:fs";

const sealed = "/Users/brad/.cache/swarm-heldout-2026-10-22/sealed";
const hiddenSource = (path) => readFileSync(`${sealed}/${path}`, "utf8");

const pinnedInstall = [
  "npm",
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--before=2026-10-22T00:00:00.000Z",
];

const pLimit = {
  repository: "sindresorhus/p-limit",
  install: [pinnedInstall],
  build: [],
  // The project's npm test is xo, then ava over test.js, then tsd over index.test-d.ts.
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const fastify = {
  repository: "fastify/fastify",
  install: [pinnedInstall],
  build: [],
  // The project's npm test is eslint, then borp over test/**/*.test.js, then tsc and tsd.
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const pQueue = {
  repository: "sindresorhus/p-queue",
  install: [pinnedInstall],
  build: [],
  // The project's npm test is xo, node --test over test/*.ts (through tsx), tsc and tsd.
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const check = (repo, source) => ({
  path: "acceptance/visible/check.mjs",
  command: `${repo.visiblePrefix}node acceptance/visible/check.mjs`,
  source,
});

export const tasks = [
  {
    id: "p-limit-bugfix-limit-function-clear-queue",
    ...pLimit,
    workType: "bugfix",
    baseCommit: "df476048d",
    upstreamCommit: "f3e7f9ba3",
    hidden: {
      testFiles: ["test.js", "index.test-d.ts"],
      argv: ["npx", "ava", "test.js"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("plimit-bugfix/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["npx", "tsd"], ["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `p-limit's limitFunction(function_, options) in index.js returns a function that runs function_ with limited concurrency, and its options accept rejectOnClear just as pLimit's do, but the returned function offers no way to discard the calls still waiting to run, so that option has no effect there. Today limitFunction(async () => 'done', {concurrency: 1}).clearQueue is undefined, and calling it throws "TypeError: limited.clearQueue is not a function". Give the returned function a clearQueue() method that discards the calls that have not started yet, exactly as clearQueue() does for a pLimit limiter: it returns undefined; calls already running are not cancelled and settle as usual; the function of a discarded call is never invoked; with rejectOnClear: true each discarded call's promise rejects with an error whose name is "AbortError", and without it (the default) the discarded promises stay unsettled; calls made after clearing run normally, and calls that are still running keep counting against the concurrency limit. For example, with const limited = limitFunction(async x => { await delay(40); return x * 2; }, {concurrency: 1, rejectOnClear: true}), calling limited(1), limited(2) and limited(3) and then limited.clearQueue() gives 2 for the first call and AbortError rejections for the other two, whose function never runs. Clearing one limited function does not affect another one, even when both were made with the same options object, and clearQueue() on a limited function with nothing waiting is harmless. The TypeScript declarations in index.d.ts must describe the method: for const lf = limitFunction(async (_a: string) => 'ok', {concurrency: 1}), lf.clearQueue() must type-check with type void, and lf('input') must stay Promise<string>. What must not change: the limited function forwards all of its arguments and resolves with the function's result (or rejects with its error, a synchronous throw included); it never runs more than options.concurrency calls at once; invalid options still throw a TypeError (a concurrency of 0, a rejectOnClear that is not a boolean); and the default export pLimit, with its activeCount, pendingCount, clearQueue, concurrency and map, behaves as it does today. The source is index.js, with its type declarations in index.d.ts; the tests are test.js (ava) and the type tests index.test-d.ts (tsd). Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test (xo, then ava, then tsd).`,
    visible: check(
      pLimit,
      `import assert from 'node:assert/strict';
import {limitFunction} from '../../index.js';

const limited = limitFunction(async () => 'done', {concurrency: 1});
assert.equal(typeof limited.clearQueue, 'function');
console.log('visible check passed');
`,
    ),
  },
  {
    id: "p-limit-feature-reject-on-clear",
    ...pLimit,
    workType: "feature",
    baseCommit: "ce9d71cf1",
    upstreamCommit: "8907801ff",
    hidden: {
      testFiles: ["test.js", "index.test-d.ts"],
      argv: ["npx", "ava", "test.js"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("plimit-feature/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["npx", "tsd"], ["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `p-limit's limiter (pLimit in index.js) has clearQueue(), which discards the tasks still waiting to run but leaves their promises unsettled forever, so code that awaits them (with Promise.all, for example) never continues. Add a rejectOnClear option to the options object pLimit accepts, pLimit({concurrency, rejectOnClear}), defaulting to false; today pLimit({concurrency: 1, rejectOnClear: true}) silently ignores it. With rejectOnClear: true, clearQueue() must reject the promise of every task that has not started with an error whose name is "AbortError" (an Error, like the reason of AbortSignal.abort()), at once rather than after the running tasks finish; running tasks are not cancelled and settle as usual; the function of a discarded task is never called; pendingCount is 0 afterwards; and the limiter keeps working for tasks added later. For example, with const limit = pLimit({concurrency: 1, rejectOnClear: true}), adding three tasks that each wait 40 ms and calling limit.clearQueue() after one microtask leaves pendingCount 0, resolves the first task and rejects the other two with AbortError. Without the option, or with rejectOnClear: false, clearQueue() behaves exactly as today. Any rejectOnClear other than true, false or undefined (for example "nope", 1 or null) makes pLimit throw a TypeError. limitFunction(function_, options) must accept and validate the same options: limitFunction(fn, {concurrency: 1, rejectOnClear: "nope"}) throws a TypeError, and limitFunction(fn, {concurrency: 1, rejectOnClear: true}) runs fn as usual. Declare the option in the Options type in index.d.ts as an optional boolean, so that pLimit({concurrency: 1, rejectOnClear: true}) type-checks and a non-boolean value is a type error. What must not change: pLimit(number) and pLimit({concurrency}) work as today; concurrency is still validated (pLimit(0) and pLimit({concurrency: 0}) throw a TypeError); no more than the concurrency limit of tasks run at once; tasks resolve with their results and reject with their errors (a synchronous throw included); arguments given as limit(fn, ...arguments) reach fn; and limit.map, activeCount, pendingCount and setting limit.concurrency (raising it starts waiting tasks) behave as today. The source is index.js, with its type declarations in index.d.ts; the tests are test.js (ava) and the type tests index.test-d.ts (tsd). Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test (xo, then ava, then tsd).`,
    visible: check(
      pLimit,
      `import assert from 'node:assert/strict';
import pLimit from '../../index.js';

assert.throws(() => pLimit({concurrency: 1, rejectOnClear: 'nope'}), TypeError);
console.log('visible check passed');
`,
    ),
  },
  {
    id: "fastify-refactor-kebab-case-file-names",
    ...fastify,
    workType: "refactor",
    baseCommit: "91414feca",
    upstreamCommit: "5bcee1d7a",
    hidden: {
      // The upstream commit's own test changes only follow the renamed paths, so none is overlaid:
      // the candidate's own updated suite runs, and the behaviour check reads every reference.
      testFiles: [],
      argv: ["npm", "test"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("fastify-rename/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `fastify's source files under lib/ and types/ mostly use kebab-case file names (lib/error-handler.js, lib/logger-factory.js, types/type-provider.d.ts), but eleven still use camelCase. Rename them with behaviour unchanged: lib/configValidator.js to lib/config-validator.js, lib/contentTypeParser.js to lib/content-type-parser.js, lib/fourOhFour.js to lib/four-oh-four.js, lib/handleRequest.js to lib/handle-request.js, lib/headRoute.js to lib/head-route.js, lib/initialConfigValidation.js to lib/initial-config-validation.js, lib/pluginOverride.js to lib/plugin-override.js, lib/pluginUtils.js to lib/plugin-utils.js, lib/reqIdGenFactory.js to lib/req-id-gen-factory.js, lib/wrapThenable.js to lib/wrap-thenable.js, and types/serverFactory.d.ts to types/server-factory.d.ts. Move each file, its content unchanged apart from the paths it requires, so that the old names no longer exist, and do not leave files under the old names (no re-exporting stubs). Update every reference to an old name: the require calls in fastify.js and lib/, the import in fastify.d.ts, the tests under test/ that require or stub these modules (proxyquire paths and stub keys included), the file that the validator build script build/build-validation.js writes (lib/configValidator.js is generated by npm run build:validation), that generated file's entry in the ignore list of eslint.config.js, and the path in package.json's test:validator:integrity script. Behaviour must not change: each moved module exports exactly what it exported before; fastify's public API, its type declarations and its test suite behave as today; and node build/build-validation.js regenerates lib/config-validator.js with the same content. The source is CommonJS in fastify.js and lib/, with type declarations in fastify.d.ts and types/, and tests in test/ (node:test, run with borp). The project's tests run with npm test (eslint, then borp over test/**/*.test.js, then tsc and tsd), and must keep passing.`,
    visible: check(
      fastify,
      `import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

assert.ok(existsSync(new URL('../../lib/four-oh-four.js', import.meta.url)), 'lib/four-oh-four.js is missing')
console.log('visible check passed')
`,
    ),
  },
  {
    id: "p-queue-compat-remove-throw-on-timeout",
    ...pQueue,
    workType: "feature",
    baseCommit: "62efb742e",
    upstreamCommit: "e48716fa1",
    hidden: {
      testFiles: ["test/basic.ts", "test/advanced.ts", "test-d/index.test-d.ts"],
      argv: ["node", "--import=tsx/esm", "--test", "test/basic.ts", "test/advanced.ts"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("pqueue-compat/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "--import=tsx/esm", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `p-queue (the PQueue class in source/index.ts, its options in source/options.ts) has a throwOnTimeout option, accepted by the constructor and by each add(), and false by default: when a task's timeout elapses, its promise resolves with undefined instead of rejecting, so a caller cannot tell a timed-out task from one that returned nothing, and add() is typed Promise<TaskResultType | void>. Remove the option, so that a timeout always rejects. With const queue = new PQueue({timeout: 300}): queue.add(async () => { await delay(400); return '🐌'; }) must reject with p-timeout's TimeoutError (today it resolves with undefined); a task that takes 200 ms must resolve with its value; queue.add(task, {timeout: 10}) for a task that takes 100 ms must reject with TimeoutError; and queue.add(task, {timeout: 500}) for a task that takes 400 ms must resolve with its value. A timed-out task emits the queue's error event with the TimeoutError and no completed event, and addAll() rejects when one of its tasks times out. Remove throwOnTimeout from the option types in source/options.ts and from the class, together with the add() and addAll() overloads that depended on it, so that add() is typed Promise<TaskResultType> and addAll() Promise<TaskResultsType[]> (for const queue = new PQueue(), queue.add(async () => '🦄') is Promise<string>). A throwOnTimeout that is still passed at run time is ignored: the timeout rejects all the same. What must not change: a task without a timeout runs to completion however long it takes; setting queue.timeout applies to the tasks added after it; a per-task timeout given to add() overrides the queue's; any other error from a task rejects its promise and emits error as today; after a timeout the queue goes on with the next tasks within its concurrency; and onIdle(), pending, size and priorities behave as today. Some existing tests in test/basic.ts and test/advanced.ts and the type test test-d/index.test-d.ts pass throwOnTimeout or expect a timed-out task to resolve; they describe the behaviour being removed, so change them to the new behaviour, keeping their other assertions. Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test (xo, then node --test over test/*.ts through tsx, then tsc and tsd).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      // The source is TypeScript; tsx, a development dependency of the project, loads it.
      command: "node --import=tsx/esm acceptance/visible/check.mjs",
      source: `import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import PQueue from '../../source/index.js';

const queue = new PQueue({timeout: 20});
await assert.rejects(queue.add(async () => delay(100)), {name: 'TimeoutError'});
console.log('visible check passed');
`,
    },
  },
];

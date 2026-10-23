// Hidden behaviour check: pLimit's rejectOnClear option, every example the task states, and the
// limiter behaviour that must not change. Runs from acceptance/hidden/.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import pLimit, {limitFunction} from '../../index.js';

const pending = Symbol('pending');
const settleWithin = async (promise, ms) => Promise.race([
	promise.then(value => ({value}), error => ({error})),
	delay(ms).then(() => pending),
]);

const checks = [];
const check = (name, body) => checks.push([name, body]);

check('rejectOnClear: true rejects every waiting promise with an AbortError; the running one completes', async () => {
	const started = [];
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	const task = value => limit(async () => {
		started.push(value);
		await delay(40);
		return value;
	});
	const running = task('running');
	const one = task('one');
	const two = task('two');
	one.catch(() => {});
	two.catch(() => {});
	await Promise.resolve();
	assert.equal(limit.pendingCount, 2);
	assert.equal(limit.activeCount, 1);
	assert.equal(limit.clearQueue(), undefined);
	assert.equal(limit.pendingCount, 0);
	await assert.rejects(one, error => error instanceof Error && error.name === 'AbortError');
	await assert.rejects(two, {name: 'AbortError'});
	assert.equal(await running, 'running');
	await delay(60);
	assert.deepEqual(started, ['running']);
});

check('rejected promises settle promptly, before the running task finishes', async () => {
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	const running = limit(async () => delay(300));
	const waiting = limit(async () => 'never');
	waiting.catch(() => {});
	await Promise.resolve();
	limit.clearQueue();
	const outcome = await settleWithin(waiting, 100);
	assert.notEqual(outcome, pending, 'the cleared promise is still pending');
	assert.equal(outcome.error?.name, 'AbortError');
	await running;
});

check('default and rejectOnClear: false keep cleared promises unsettled', async () => {
	for (const limit of [pLimit(1), pLimit({concurrency: 1}), pLimit({concurrency: 1, rejectOnClear: false})]) {
		const started = [];
		const running = limit(async () => {
			started.push('running');
			await delay(20);
		});
		const waiting = limit(async () => {
			started.push('waiting');
		});
		await Promise.resolve();
		assert.equal(limit.pendingCount, 1);
		limit.clearQueue();
		assert.equal(limit.pendingCount, 0);
		await running;
		assert.equal(await settleWithin(waiting, 80), pending);
		assert.deepEqual(started, ['running']);
	}
});

check('the limiter keeps working after a rejecting clear', async () => {
	const limit = pLimit({concurrency: 2, rejectOnClear: true});
	const runningA = limit(async () => {
		await delay(20);
		return 'a';
	});
	const runningB = limit(async () => {
		await delay(20);
		return 'b';
	});
	const cleared = limit(async () => 'cleared');
	cleared.catch(() => {});
	await Promise.resolve();
	limit.clearQueue();
	await assert.rejects(cleared, {name: 'AbortError'});
	const later = await Promise.all([limit(async () => 'c'), limit(async () => 'd'), limit(async () => 'e')]);
	assert.deepEqual([await runningA, await runningB, ...later], ['a', 'b', 'c', 'd', 'e']);
	assert.equal(limit.activeCount, 0);
	assert.equal(limit.pendingCount, 0);
});

check('clearQueue with nothing waiting is harmless', async () => {
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	limit.clearQueue();
	assert.equal(await limit(async () => 7), 7);
});

check('a non-boolean rejectOnClear throws a TypeError', async () => {
	for (const value of ['nope', 1, null, {}]) {
		assert.throws(() => pLimit({concurrency: 1, rejectOnClear: value}), TypeError, `rejectOnClear ${JSON.stringify(value)}`);
	}
});

check('limitFunction accepts and validates rejectOnClear', async () => {
	assert.throws(() => limitFunction(async () => {}, {concurrency: 1, rejectOnClear: 'nope'}), TypeError);
	const limited = limitFunction(async (a, b) => a + b, {concurrency: 1, rejectOnClear: true});
	assert.equal(await limited(2, 3), 5);
});

check('preserved: concurrency validation and the number form', async () => {
	assert.throws(() => pLimit(0), TypeError);
	assert.throws(() => pLimit({concurrency: 0}), TypeError);
	assert.throws(() => pLimit({concurrency: 1.5, rejectOnClear: true}), TypeError);
	const limit = pLimit(2);
	assert.equal(limit.concurrency, 2);
	assert.equal(pLimit({concurrency: 3, rejectOnClear: true}).concurrency, 3);
});

check('preserved: concurrency is respected and results keep order', async () => {
	let active = 0;
	let highest = 0;
	const limit = pLimit({concurrency: 2, rejectOnClear: true});
	const results = await Promise.all([1, 2, 3, 4, 5].map(value => limit(async () => {
		active++;
		highest = Math.max(highest, active);
		await delay(10);
		active--;
		return value * 10;
	})));
	assert.deepEqual(results, [10, 20, 30, 40, 50]);
	assert.equal(highest, 2);
});

check('preserved: errors and arguments', async () => {
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	await assert.rejects(limit(async () => {
		throw new Error('boom');
	}), {message: 'boom'});
	await assert.rejects(limit(() => {
		throw new RangeError('sync');
	}), RangeError);
	assert.deepEqual(await limit(async (...values) => values, 1, 'two', 3), [1, 'two', 3]);
	assert.deepEqual(await limit.map([1, 2, 3], async (value, index) => value + index), [1, 3, 5]);
});

check('preserved: raising concurrency starts waiting tasks', async () => {
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	const order = [];
	const tasks = [1, 2, 3].map(value => limit(async () => {
		order.push(value);
		await delay(30);
	}));
	await Promise.resolve();
	limit.concurrency = 3;
	await delay(10);
	assert.deepEqual(order, [1, 2, 3]);
	await Promise.all(tasks);
});

let failed = 0;
for (const [name, body] of checks) {
	let timer;
	try {
		// A promise that never settles must fail its check, not end the process silently.
		await Promise.race([body(), new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('timed out after 3000 ms: a promise never settled')), 3000);
		})]);
		console.log(`ok - ${name}`);
	} catch (error) {
		failed++;
		console.log(`not ok - ${name}\n${error?.stack ?? error}`);
	} finally {
		clearTimeout(timer);
	}
}

console.log(`${checks.length - failed}/${checks.length} behaviour checks passed`);
process.exitCode = failed === 0 ? 0 : 1;

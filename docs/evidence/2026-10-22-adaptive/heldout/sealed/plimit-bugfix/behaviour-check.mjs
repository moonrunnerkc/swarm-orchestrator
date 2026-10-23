// Hidden behaviour check: limitFunction's clearQueue, every example the task states, and the
// behaviour of limitFunction and pLimit that must not change. Runs from acceptance/hidden/.
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

check('clearQueue is a function on the limited function and returns undefined', async () => {
	const limited = limitFunction(async () => 1, {concurrency: 1});
	assert.equal(typeof limited.clearQueue, 'function');
	assert.equal(limited.clearQueue(), undefined);
});

check('rejectOnClear: running call completes, pending calls reject with AbortError and never run', async () => {
	const started = [];
	const limited = limitFunction(async value => {
		started.push(value);
		await delay(40);
		return value * 2;
	}, {concurrency: 1, rejectOnClear: true});
	const first = limited(1);
	const second = limited(2);
	const third = limited(3);
	second.catch(() => {});
	third.catch(() => {});
	await delay(5);
	limited.clearQueue();
	assert.equal(await first, 2);
	await assert.rejects(second, {name: 'AbortError'});
	await assert.rejects(third, {name: 'AbortError'});
	await delay(60);
	assert.deepEqual(started, [1]);
});

check('without rejectOnClear: pending calls stay unsettled and never run', async () => {
	const started = [];
	const limited = limitFunction(async value => {
		started.push(value);
		await delay(20);
		return value;
	}, {concurrency: 1});
	const first = limited('a');
	const second = limited('b');
	await delay(5);
	limited.clearQueue();
	assert.equal(await first, 'a');
	assert.equal(await settleWithin(second, 120), pending);
	assert.deepEqual(started, ['a']);
});

check('calls made after clearing run normally', async () => {
	const limited = limitFunction(async value => {
		await delay(10);
		return value + 1;
	}, {concurrency: 1, rejectOnClear: true});
	const running = limited(1);
	const cleared = limited(2);
	cleared.catch(() => {});
	limited.clearQueue();
	await assert.rejects(cleared, {name: 'AbortError'});
	assert.equal(await running, 2);
	assert.deepEqual(await Promise.all([limited(10), limited(20)]), [11, 21]);
});

check('calls that are already running still count against the limit after clearing', async () => {
	let active = 0;
	let highest = 0;
	const limited = limitFunction(async value => {
		active++;
		highest = Math.max(highest, active);
		await delay(30);
		active--;
		return value;
	}, {concurrency: 1, rejectOnClear: true});
	const running = limited('first');
	const cleared = limited('cleared');
	cleared.catch(() => {});
	await delay(5);
	limited.clearQueue();
	const later = [limited('second'), limited('third')];
	assert.deepEqual(await Promise.all([running, ...later]), ['first', 'second', 'third']);
	await assert.rejects(cleared, {name: 'AbortError'});
	assert.equal(highest, 1);
});

check('clearing one limited function leaves another limited function alone', async () => {
	const options = {concurrency: 1, rejectOnClear: true};
	const one = limitFunction(async value => {
		await delay(20);
		return value;
	}, options);
	const two = limitFunction(async value => {
		await delay(20);
		return value;
	}, options);
	const oneRunning = one('x');
	const onePending = one('y');
	onePending.catch(() => {});
	const twoRunning = two('p');
	const twoPending = two('q');
	await delay(2);
	one.clearQueue();
	await assert.rejects(onePending, {name: 'AbortError'});
	assert.deepEqual(await Promise.all([oneRunning, twoRunning, twoPending]), ['x', 'p', 'q']);
});

check('clearQueue on an idle limited function is harmless', async () => {
	const limited = limitFunction(async value => value, {concurrency: 2, rejectOnClear: true});
	limited.clearQueue();
	assert.equal(await limited(5), 5);
});

check('preserved: arguments are forwarded and results resolve in call order', async () => {
	const limited = limitFunction(async (a, b, c) => {
		await delay(5);
		return [a, b, c];
	}, {concurrency: 2});
	assert.deepEqual(await Promise.all([limited(1, 2, 3), limited('x', 'y', 'z')]), [[1, 2, 3], ['x', 'y', 'z']]);
});

check('preserved: concurrency limit is respected', async () => {
	let active = 0;
	let highest = 0;
	const limited = limitFunction(async value => {
		active++;
		highest = Math.max(highest, active);
		await delay(15);
		active--;
		return value;
	}, {concurrency: 2});
	const results = await Promise.all([1, 2, 3, 4, 5, 6].map(value => limited(value)));
	assert.deepEqual(results, [1, 2, 3, 4, 5, 6]);
	assert.equal(highest, 2);
});

check('preserved: errors from the function reject the call', async () => {
	const limited = limitFunction(async () => {
		throw new Error('boom');
	}, {concurrency: 1});
	await assert.rejects(limited(), {message: 'boom'});
	const syncThrow = limitFunction(() => {
		throw new TypeError('sync boom');
	}, {concurrency: 1});
	await assert.rejects(syncThrow(), {name: 'TypeError', message: 'sync boom'});
});

check('preserved: option validation', async () => {
	assert.throws(() => limitFunction(async () => {}, {concurrency: 0}), TypeError);
	assert.throws(() => limitFunction(async () => {}, {concurrency: 1, rejectOnClear: 'yes'}), TypeError);
});

check('preserved: pLimit clearQueue and counters', async () => {
	const limit = pLimit({concurrency: 1, rejectOnClear: true});
	const running = limit(async () => {
		await delay(20);
		return 'done';
	});
	const queued = limit(async () => 'never');
	queued.catch(() => {});
	await Promise.resolve();
	assert.equal(limit.activeCount, 1);
	assert.equal(limit.pendingCount, 1);
	limit.clearQueue();
	assert.equal(limit.pendingCount, 0);
	await assert.rejects(queued, {name: 'AbortError'});
	assert.equal(await running, 'done');
	const plain = pLimit(1);
	const plainRunning = plain(async () => delay(10));
	const plainQueued = plain(async () => 'never');
	plain.clearQueue();
	await plainRunning;
	assert.equal(await settleWithin(plainQueued, 60), pending);
	assert.deepEqual(await plain.map([1, 2, 3], async value => value * 3), [3, 6, 9]);
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

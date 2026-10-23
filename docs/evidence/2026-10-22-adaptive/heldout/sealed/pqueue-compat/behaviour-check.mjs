// Hidden behaviour check: the throwOnTimeout option is gone and a timeout always rejects, every
// example the task states, and the queue behaviour that must not change. Runs from
// acceptance/hidden/ under node --import=tsx/esm, which loads the TypeScript source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {TimeoutError} from 'p-timeout';
import PQueue from '../../source/index.js';

const checks = [];
const check = (name, body) => checks.push([name, body]);
const isTimeout = error => error instanceof TimeoutError && error.name === 'TimeoutError';
const slow = (ms, value) => async () => {
	await delay(ms);
	return value;
};

check('the option is gone from the source and its types', () => {
	for (const path of ['source/index.ts', 'source/options.ts']) {
		const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
		assert.ok(!/throwOnTimeout/.test(text), `${path} still mentions throwOnTimeout`);
	}
});

check('a queue timeout rejects with TimeoutError, emits error and not completed', async () => {
	const queue = new PQueue({timeout: 50});
	const errors = [];
	const completed = [];
	queue.on('error', error => errors.push(error));
	queue.on('completed', result => completed.push(result));
	await assert.rejects(queue.add(slow(150, 'slow')), isTimeout);
	assert.equal(errors.length, 1);
	assert.ok(isTimeout(errors[0]));
	assert.deepEqual(completed, []);
	assert.equal(await queue.add(slow(10, 'fast')), 'fast');
	assert.deepEqual(completed, ['fast']);
	await queue.onIdle();
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
});

check('the examples: timeout 300, a 400 ms task rejects, a 200 ms task gives its value, a 10 ms override rejects', async () => {
	const queue = new PQueue({timeout: 300});
	await assert.rejects(queue.add(slow(400, '🐌')), isTimeout);
	assert.equal(await queue.add(slow(200, '🦆')), '🦆');
	await assert.rejects(queue.add(slow(100, 'x'), {timeout: 10}), isTimeout);
	assert.equal(await queue.add(slow(400, '🐢'), {timeout: 500}), '🐢');
});

check('a throwOnTimeout given anyway changes nothing: the timeout still rejects', async () => {
	const queue = new PQueue({timeout: 30, throwOnTimeout: false});
	await assert.rejects(queue.add(slow(100, 'a')), isTimeout);
	await assert.rejects(queue.add(slow(100, 'b'), {throwOnTimeout: false}), isTimeout);
	const plain = new PQueue();
	await assert.rejects(plain.add(slow(100, 'c'), {timeout: 20, throwOnTimeout: false}), isTimeout);
});

check('addAll rejects when one of its tasks times out', async () => {
	const queue = new PQueue({concurrency: 2});
	await assert.rejects(queue.addAll([slow(5, 1), slow(150, 2)], {timeout: 50}), isTimeout);
	assert.deepEqual(await queue.addAll([slow(5, 1), slow(10, 2)], {timeout: 100}), [1, 2]);
	await queue.onIdle();
});

check('preserved: without a timeout, slow tasks complete', async () => {
	const queue = new PQueue();
	assert.equal(await queue.add(slow(120, 'done')), 'done');
});

check('preserved: changing queue.timeout applies to tasks added later', async () => {
	const queue = new PQueue({timeout: 30, concurrency: 2});
	const first = queue.add(slow(100, 'first'));
	first.catch(() => {});
	queue.timeout = 300;
	assert.equal(await queue.add(slow(100, 'second')), 'second');
	await assert.rejects(first, isTimeout);
});

check('preserved: the queue keeps going after timeouts, within its concurrency', async () => {
	const queue = new PQueue({concurrency: 2, timeout: 40});
	// A timeout frees its slot while the timed-out function itself keeps running (p-timeout does
	// not cancel it), so the limit is read from the queue's own count of running tasks.
	let highest = 0;
	const tracked = (ms, value) => async () => {
		highest = Math.max(highest, queue.pending);
		await delay(ms);
		return value;
	};

	const results = await Promise.allSettled([tracked(80, 'a'), tracked(5, 'b'), tracked(80, 'c'), tracked(5, 'd')].map(task => queue.add(task)));
	assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'rejected', 'fulfilled']);
	assert.ok(results.filter(result => result.status === 'rejected').every(result => isTimeout(result.reason)));
	assert.ok(highest <= 2, `the queue ran ${highest} tasks at once`);
	await delay(100);
	await queue.onIdle();
	assert.equal(queue.pending, 0);
});

check('preserved: other errors still reject and emit error', async () => {
	const queue = new PQueue({timeout: 500});
	const errors = [];
	queue.on('error', error => errors.push(error));
	await assert.rejects(queue.add(async () => {
		throw new RangeError('broken');
	}), RangeError);
	assert.equal(errors.length, 1);
	assert.ok(errors[0] instanceof RangeError);
});

check('preserved: priorities and results', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order = [];
	const pushes = value => async () => {
		order.push(value);
		return value;
	};

	const all = Promise.all([queue.add(pushes('low'), {priority: 0}), queue.add(pushes('high'), {priority: 5})]);
	queue.start();
	assert.deepEqual(await all, ['low', 'high']);
	assert.deepEqual(order, ['high', 'low']);
});

let failed = 0;
for (const [name, body] of checks) {
	let timer;
	try {
		await Promise.race([body(), new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('timed out after 5000 ms: a promise never settled')), 5000);
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

// Evaluator-only expanded audit of the node-tar negative-size task, run in the scoring checkout
// after `npm run prepare`. Never shown to a model. Sizes follow the task's rule; every other field
// keeps its current parsing, negative values included, which at the base is Number(value) for the
// numeric records and a Date of Number(value) seconds for the times.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.cwd();
const { Header } = await import(pathToFileURL(join(dir, 'dist/esm/header.js')));
const { Pax } = await import(pathToFileURL(join(dir, 'dist/esm/pax.js')));

/** One pax record with its self-including length prefix. */
function record(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length = String(length).length + body.length;
  return `${length}${body}`;
}
const problems = [];
const check = (label, actual, expected) => {
  if (!Object.is(actual, expected)) problems.push(`${label}: ${actual} (expected ${expected})`);
};

for (const field of ['uid', 'gid', 'dev', 'ino', 'nlink'])
  for (const value of ['-1', '-1000', '0', '7'])
    check(`Pax ${field}=${value}`, Pax.parse(record(field, value))[field], Number(value));
for (const field of ['atime', 'mtime', 'ctime'])
  for (const value of ['-10', '0', '10'])
    check(`Pax ${field}=${value}`, Pax.parse(record(field, value))[field]?.getTime(), Number(value) * 1000);
for (const [value, expected] of [['-1', undefined], ['-1000', undefined], ['abc', undefined], ['0', 0], ['1000', 1000]])
  check(`Pax size=${value}`, Pax.parse(record('size', value)).size, expected);
check('Pax size beside a negative uid', Pax.parse(record('uid', '-1') + record('size', '5')).size, 5);
check('Pax negative uid beside a size', Pax.parse(record('uid', '-1') + record('size', '5')).uid, -1);

for (const [size, expected] of [[-1, undefined], [-1000, undefined], [0, 0], [1000, 1000]])
  check(`new Header({ size: ${size} })`, new Header({ size }).size, expected);
check('new Header({ uid: -1 }).uid', new Header({ uid: -1 }).uid, -1);
check('new Header({ size: -1, uid: -1 }).uid', new Header({ size: -1, uid: -1 }).uid, -1);
const good = new Header({ path: 'x', type: 'File', size: 10, mode: 0o644, mtime: new Date(0) });
good.encode();
check('block with an ex header holding a negative uid', new Header(Buffer.from(good.block), 0, { uid: -5 }).uid, -5);
check('block with an ex header holding a negative size', new Header(Buffer.from(good.block), 0, { size: -5 }).size, undefined);
check('block with a global header holding a negative size', new Header(Buffer.from(good.block), 0, undefined, { size: -5 }).size, undefined);
check('block size kept', new Header(Buffer.from(good.block)).size, 10);

assert.deepEqual(problems, [], `${problems.length} audit cases wrong`);
console.log('tar expanded audit passed');

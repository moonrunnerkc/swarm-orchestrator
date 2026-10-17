// Evaluator-only expanded audit of the mime line-terminator task, run in the scoring checkout
// after the build. Never shown to a model. The expected value is the task's rule written by index
// arithmetic, with no regular expressions: the last segment follows the last `/` or `\`, the
// extension follows the last `.` of that segment, and every other character, line terminators
// included, is ordinary. It is the reading the 2026-10-16 amendment's audit used, which agreed with
// the upstream maintainer commit on all 113 cases.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { default: mime } = await import(pathToFileURL(join(process.cwd(), 'dist/src/index.js')));
const types = { png: 'image/png', jpg: 'image/jpeg', json: 'application/json', txt: 'text/plain', html: 'text/html' };

function expectedType(path) {
  if (typeof path !== 'string') return null;
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const last = path.slice(cut + 1).toLowerCase();
  const dot = last.lastIndexOf('.');
  const ext = dot === -1 ? last : last.slice(dot + 1);
  const hasPath = last.length < path.length;
  const hasDot = ext.length < last.length - 1;
  if (!hasDot && hasPath) return null;
  return types[ext] ?? null;
}

const characters = { LF: '\n', CR: '\r', CRLF: '\r\n', LS: '\u2028', PS: '\u2029', SPACE: ' ', TAB: '\t' };
const templates = {
  name: (t) => `LINE${t}FEED.png`,
  'dir+name': (t) => `/path/to/LINE${t}FEED.png`,
  leading: (t) => `${t}.png`,
  multi: (t) => `a${t}b${t}c.png`,
  'dir-holds': (t) => `dir${t}sub/photo.png`,
  'between-exts': (t) => `photo.png${t}.jpg`,
  'dir+between-exts': (t) => `dir/photo.png${t}.jpg`,
  'earlier-ext-spoof': (t) => `evil.html${t}x.png`,
  'inside-ext': (t) => `photo.pn${t}g`,
  trailing: (t) => `photo.png${t}`,
  dotfile: (t) => `/p/.config${t}.json`,
  windows: (t) => `C:\\dir${t}x\\file.txt`,
  'extless-dir': (t) => `/dir/file${t}name`,
};
const ordinary = [
  'report.html', '/path/to/.config.json', '.config.json', '/path/to/file', 'file', 'txt', '.txt',
  'dir\\file.txt', 'dir/file.TXT', 'a.b.c.png', '', '/', '.', 'photo.', 'dir/.png', 'C:\\x\\y.jpg',
  'noext/', 'trailing.dot.', null, undefined, 42, {},
];
const cases = [
  ...Object.entries(templates).flatMap(([template, make]) =>
    Object.entries(characters).map(([label, character]) => [`${template}:${label}`, make(character)]),
  ),
  ...ordinary.map((input) => [`ordinary:${String(JSON.stringify(input))}`, input]),
];
const wrong = cases.filter(([, input]) => mime.getType(input) !== expectedType(input));
assert.deepEqual(
  wrong.map(([id, input]) => `${id} ${JSON.stringify(input)}: ${mime.getType(input)} (expected ${expectedType(input)})`),
  [],
  `${wrong.length} of ${cases.length} audit cases wrong`,
);
console.log(`mime expanded audit passed: ${cases.length} cases`);

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractChangedUnits,
  extractExportedSymbols,
  renderChangedUnits,
} from '../../../src/audit/execution-grounded/claim-changed-units';
import { witnessSourceFromResponse } from '../../../src/audit/execution-grounded/claim-llm';

describe('extractExportedSymbols', () => {
  it('reads ES module exports across declaration forms', () => {
    const src = [
      'export function add(a, b) { return a + b; }',
      'export class Adder {}',
      'export const PI = 3.14;',
      'export interface Shape {}',
      'export type Id = string;',
      'function hidden() {}',
    ].join('\n');
    const names = extractExportedSymbols(src, 'src/adder.ts');
    assert.deepEqual([...names], ['Adder', 'Id', 'PI', 'Shape', 'add']);
    assert.ok(!names.includes('hidden'), 'a non-exported declaration is not reported');
  });

  it('reads a re-export list and CommonJS exports.x assignments', () => {
    const esm = 'const a = 1; const b = 2;\nexport { a, b };';
    assert.deepEqual([...extractExportedSymbols(esm, 'm.js')], ['a', 'b']);
    const cjs = 'function run() {}\nmodule.exports.run = run;\nexports.helper = () => {};';
    assert.deepEqual([...extractExportedSymbols(cjs, 'm.js')], ['helper', 'run']);
  });

  it('returns [] for a non-TS/JS file', () => {
    assert.deepEqual([...extractExportedSymbols('def f(): pass', 'x.py')], []);
  });
});

describe('extractChangedUnits', () => {
  it('pairs each revertable file with its exported symbols, read from the head checkout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() {}\nexport const bar = 1;');
      const units = extractChangedUnits(['a.ts', 'missing.ts'], dir);
      assert.equal(units.length, 2);
      assert.equal(units[0]!.file, 'a.ts');
      assert.deepEqual([...units[0]!.exports], ['bar', 'foo']);
      assert.deepEqual([...units[1]!.exports], [], 'an unreadable file yields an empty export set, not a throw');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renderChangedUnits', () => {
  it('lists the files to import and their symbols, and is empty for no units', () => {
    assert.equal(renderChangedUnits([]), '');
    const rendered = renderChangedUnits([{ file: 'src/adder.ts', exports: ['add', 'sub'] }]);
    assert.ok(rendered.includes('src/adder.ts'));
    assert.ok(rendered.includes('add, sub'));
    assert.ok(/import at least one/i.test(rendered));
  });
});

describe('witnessSourceFromResponse', () => {
  it('extracts test_source from a structured-output JSON reply', () => {
    const raw = JSON.stringify({ test_source: 'it("x", () => {});' });
    assert.equal(witnessSourceFromResponse(raw), 'it("x", () => {});');
  });

  it('falls back to the raw text when the reply is not the expected JSON', () => {
    const bare = '```js\nit("x", () => {});\n```';
    assert.equal(witnessSourceFromResponse(bare), bare);
    assert.equal(witnessSourceFromResponse('{"other": 1}'), '{"other": 1}');
  });
});

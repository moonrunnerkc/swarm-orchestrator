import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractImports } from '../../src/verification/ast-imports';

/**
 * Tests for the AST-backed import extractor. These cover shapes the
 * v8.0 regex matcher could not parse — multi-line imports, dynamic
 * `import()` calls, `import x = require(...)` — and shapes that would
 * have produced false positives — `require` inside a string literal,
 * `import` keyword inside a comment.
 */

describe('verification/ast-imports', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-imp-'));
  });

  afterEach(() => {
    if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function write(rel: string, body: string): string {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    return abs;
  }

  it('extracts a multi-line import statement that the regex matcher could miss', () => {
    const abs = write(
      'src/a.ts',
      [
        'import {',
        '  a,',
        '  b,',
        '  c,',
        "} from './neighbors';",
        '',
      ].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['./neighbors']);
  });

  it('extracts a dynamic import() call', () => {
    const abs = write('src/b.ts', `const m = await import('./lazy');\n`);
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['./lazy']);
  });

  it('extracts `import x = require(...)` (TypeScript namespace import form)', () => {
    const abs = write('src/c.ts', `import fs = require('fs');\n`);
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['fs']);
  });

  it('does NOT pick up `require("...")` inside a string literal (regex-matcher false positive)', () => {
    const abs = write(
      'src/d.ts',
      `export const sample = "require('something-evil')";\nexport const real = require('fs');\n`,
    );
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['fs']);
  });

  it('does NOT pick up an import keyword sitting inside a // comment', () => {
    const abs = write(
      'src/e.ts',
      `// import './ghost';\nimport './real';\n`,
    );
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['./real']);
  });

  it('extracts an `export ... from` re-export', () => {
    const abs = write('src/f.ts', `export { x } from './x';\n`);
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    assert.deepEqual(out.specs, ['./x']);
  });

  it('extracts Python `from .pkg import name` and `import a.b` via the python3 ast module', function () {
    const abs = write(
      'src/g.py',
      ['from .sibling import Foo', 'from ..parent import Bar', 'import os.path', 'import a, b as c', ''].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    if (out.error && /python3 not found/.test(out.error)) {
      this.skip();
      return;
    }
    // Order: ImportFrom emits "<dots><module>" once; Import emits each alias.
    assert.deepEqual(out.specs, ['.sibling', '..parent', 'os.path', 'a', 'b']);
  });

  it('does NOT pick up Python imports inside a string literal or comment', function () {
    const abs = write(
      'src/h.py',
      [
        '# from .ghost import Bad',
        'doc = "from .ghost import Bad"',
        'from .real import Good',
        '',
      ].join('\n'),
    );
    const body = fs.readFileSync(abs, 'utf8');
    const out = extractImports(abs, body);
    if (out.error && /python3 not found/.test(out.error)) {
      this.skip();
      return;
    }
    assert.deepEqual(out.specs, ['.real']);
  });
});

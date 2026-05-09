import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  formatBody,
  formatPrettierStrategy,
  importSortStrategy,
  isImportSortable,
  scaffoldTemplateStrategy,
  sortImports,
  hasTemplateFor,
  registerTemplate,
  listTemplateKeys,
} from '../../src/wasm';
import type { ObligationV1 } from '../../src/contract/types';
import type { StrategyContext } from '../../src/wasm/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-strat-'));
}

function ctxFor(repo: string, obligation: ObligationV1): StrategyContext {
  return { obligation, repoRoot: repo, scratch: tmpDir(), timeoutMs: 5000 };
}

const fileObl = (relPath: string): ObligationV1 => ({
  type: 'file-must-exist',
  path: relPath,
});

describe('wasm/strategies/scaffold-template', () => {
  it('writes from a basename template (LICENSE)', async () => {
    const repo = tmpDir();
    const result = await scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('LICENSE')));
    assert.equal(result.applied, true);
    const body = fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8');
    assert.ok(body.startsWith('ISC License'));
  });

  it('writes from an extension template (.md)', async () => {
    const repo = tmpDir();
    const result = await scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('docs/note.md')));
    assert.equal(result.applied, true);
    assert.ok(fs.existsSync(path.join(repo, 'docs/note.md')));
  });

  it('skips when the file already exists (non-destructive)', async () => {
    const repo = tmpDir();
    const target = path.join(repo, 'README.md');
    fs.writeFileSync(target, 'existing content', 'utf8');
    const result = await scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('README.md')));
    assert.equal(result.applied, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'existing content');
  });

  it('throws when no template matches the path', async () => {
    const repo = tmpDir();
    await assert.rejects(
      () => scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('src/code.weird'))),
      /no template registered/,
    );
  });

  it('rejects path traversal via the sandbox', async () => {
    const repo = tmpDir();
    await assert.rejects(
      () => scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('../escape.md'))),
      /escapes repoRoot/,
    );
  });

  it('throws on the wrong obligation type', async () => {
    const repo = tmpDir();
    const buildObl: ObligationV1 = { type: 'build-must-pass', command: 'true' };
    await assert.rejects(
      () => scaffoldTemplateStrategy.execute(ctxFor(repo, buildObl)),
      /only handles file-must-exist/,
    );
  });

  it('hasTemplateFor recognizes registered basenames and extensions', () => {
    assert.equal(hasTemplateFor('LICENSE'), true);
    assert.equal(hasTemplateFor('subdir/LICENSE'), true);
    assert.equal(hasTemplateFor('foo.md'), true);
    assert.equal(hasTemplateFor('foo.weird'), false);
  });

  it('registerTemplate adds a custom basename template', async () => {
    const repo = tmpDir();
    registerTemplate({ kind: 'basename', value: 'CUSTOM' }, 'custom body');
    assert.equal(hasTemplateFor('CUSTOM'), true);
    const result = await scaffoldTemplateStrategy.execute(ctxFor(repo, fileObl('CUSTOM')));
    assert.equal(result.applied, true);
    assert.equal(fs.readFileSync(path.join(repo, 'CUSTOM'), 'utf8'), 'custom body\n');
  });

  it('listTemplateKeys exposes the registered key set', () => {
    const keys = listTemplateKeys();
    assert.ok(keys.basenames.includes('LICENSE'));
    assert.ok(keys.extensions.includes('.md'));
  });
});

describe('wasm/strategies/import-sort', () => {
  it('sortImports alphabetizes a TS import block', () => {
    const before = ["import b from 'b';", "import a from 'a';", '', 'export const x = 1;'].join('\n');
    const after = sortImports(before, 'src/x.ts');
    assert.match(after, /^import a from 'a';\nimport b from 'b';/);
  });

  it('sortImports leaves a file with no imports unchanged', () => {
    const content = 'export const x = 1;\n';
    const after = sortImports(content, 'src/x.ts');
    assert.equal(after, content);
  });

  it('sortImports preserves a leading shebang or comment', () => {
    const before = ['#!/usr/bin/env node', "import b from 'b';", "import a from 'a';"].join('\n');
    const after = sortImports(before, 'src/x.ts');
    const lines = after.split('\n');
    assert.equal(lines[0], '#!/usr/bin/env node');
    assert.equal(lines[1], "import a from 'a';");
    assert.equal(lines[2], "import b from 'b';");
  });

  it('sortImports handles Python imports', () => {
    const before = ['import zlib', 'import abc', '', 'def main():', '    pass'].join('\n');
    const after = sortImports(before, 'foo.py');
    assert.match(after, /^import abc\nimport zlib/);
  });

  it('sortImports throws on unsupported file types', () => {
    assert.throws(() => sortImports('', 'foo.txt'), /unsupported file type/);
  });

  it('strategy fails fast when the file does not exist', async () => {
    const repo = tmpDir();
    await assert.rejects(
      () => importSortStrategy.execute(ctxFor(repo, fileObl('src/missing.ts'))),
      /file src\/missing\.ts does not exist/,
    );
  });

  it('strategy applies in place', async () => {
    const repo = tmpDir();
    fs.mkdirSync(path.join(repo, 'src'));
    const file = path.join(repo, 'src/x.ts');
    fs.writeFileSync(file, "import b from 'b';\nimport a from 'a';\n", 'utf8');
    const result = await importSortStrategy.execute(ctxFor(repo, fileObl('src/x.ts')));
    assert.equal(result.applied, true);
    const after = fs.readFileSync(file, 'utf8');
    assert.match(after, /^import a from 'a';\nimport b from 'b';/);
  });

  it('strategy reports already-sorted as no-op', async () => {
    const repo = tmpDir();
    fs.mkdirSync(path.join(repo, 'src'));
    const file = path.join(repo, 'src/x.ts');
    fs.writeFileSync(file, "import a from 'a';\nimport b from 'b';\n", 'utf8');
    const result = await importSortStrategy.execute(ctxFor(repo, fileObl('src/x.ts')));
    assert.equal(result.applied, false);
  });

  it('isImportSortable recognizes the supported extensions', () => {
    assert.equal(isImportSortable('foo.ts'), true);
    assert.equal(isImportSortable('foo.tsx'), true);
    assert.equal(isImportSortable('foo.js'), true);
    assert.equal(isImportSortable('foo.py'), true);
    assert.equal(isImportSortable('foo.md'), false);
  });
});

describe('wasm/strategies/format-prettier', () => {
  it('formatBody normalizes line endings', () => {
    assert.equal(formatBody('a\r\nb\r\n', 'foo.ts'), 'a\nb\n');
  });

  it('formatBody strips trailing whitespace per line', () => {
    assert.equal(formatBody('foo   \nbar\t\n', 'foo.ts'), 'foo\nbar\n');
  });

  it('formatBody pretty-prints JSON when the content parses', () => {
    const out = formatBody('{"b":2,"a":1}', 'pkg.json');
    // JSON.stringify preserves insertion order; we pretty-print as-is.
    assert.equal(out, '{\n  "b": 2,\n  "a": 1\n}\n');
  });

  it('formatBody falls back to text rules on bad JSON', () => {
    const out = formatBody('not json\n', 'pkg.json');
    assert.equal(out, 'not json\n');
  });

  it('formatBody converts leading tabs to two spaces', () => {
    assert.equal(formatBody('\t\tfoo\n', 'foo.ts'), '    foo\n');
  });

  it('strategy creates a missing file with empty-formatted body', async () => {
    const repo = tmpDir();
    const result = await formatPrettierStrategy.execute(ctxFor(repo, fileObl('a/b.ts')));
    assert.equal(result.applied, true);
    assert.equal(fs.readFileSync(path.join(repo, 'a/b.ts'), 'utf8'), '\n');
  });

  it('strategy is a no-op on already-formatted files', async () => {
    const repo = tmpDir();
    const file = path.join(repo, 'x.ts');
    fs.writeFileSync(file, 'foo\n', 'utf8');
    const result = await formatPrettierStrategy.execute(ctxFor(repo, fileObl('x.ts')));
    assert.equal(result.applied, false);
  });

  it('strategy rewrites unformatted files', async () => {
    const repo = tmpDir();
    const file = path.join(repo, 'x.ts');
    fs.writeFileSync(file, 'foo  \r\n', 'utf8');
    const result = await formatPrettierStrategy.execute(ctxFor(repo, fileObl('x.ts')));
    assert.equal(result.applied, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'foo\n');
  });
});

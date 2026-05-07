import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('v8-empty fixture', () => {
  const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'v8-empty');

  it('package.json parses as JSON and name equals "v8-empty-fixture"', () => {
    const raw = fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name: string };
    assert.strictEqual(pkg.name, 'v8-empty-fixture');
  });

  it('tsconfig.json parses as JSON and compilerOptions.strict equals true', () => {
    const raw = fs.readFileSync(path.join(fixtureRoot, 'tsconfig.json'), 'utf8');
    const tsconfig = JSON.parse(raw) as { compilerOptions: { strict: boolean } };
    assert.strictEqual(tsconfig.compilerOptions.strict, true);
  });

  it('src/index.ts exists', () => {
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'src', 'index.ts')));
  });
});

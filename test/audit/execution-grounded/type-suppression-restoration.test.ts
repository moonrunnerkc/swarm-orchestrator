import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractAddedDirectives,
  fileHasAnyAddedSuppression,
  classifyTypeSuppression,
  findNearestTsconfig,
  parseTscDiagnosticsForFile,
  buildDirectiveRemovalPatch,
  buildTscReproduceCommand,
  type AddedDirective,
} from '../../../src/audit/execution-grounded/type-suppression-restoration';

// A diff that adds a `@ts-ignore` over a real call in src/calc.ts.
const TS_IGNORE_DIFF = `diff --git a/src/calc.ts b/src/calc.ts
index 1111111..2222222 100644
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,3 +1,4 @@
 export function add(a: number, b: number): number {
+  // @ts-ignore
   return a + b + missing();
 }
`;

describe('extractAddedDirectives (pure)', () => {
  it('lifts an added @ts-ignore with its new-side line number', () => {
    const directives = extractAddedDirectives(TS_IGNORE_DIFF, 'src/calc.ts');
    assert.equal(directives.length, 1);
    assert.equal(directives[0]!.label, '@ts-ignore');
    assert.equal(directives[0]!.line, 2);
    assert.match(directives[0]!.content, /@ts-ignore/);
  });

  it('lifts @ts-expect-error', () => {
    const diff = TS_IGNORE_DIFF.replace('@ts-ignore', '@ts-expect-error');
    const directives = extractAddedDirectives(diff, 'src/calc.ts');
    assert.equal(directives.length, 1);
    assert.equal(directives[0]!.label, '@ts-expect-error');
  });

  it('ignores eslint-disable (tsc cannot adjudicate it)', () => {
    const diff = TS_IGNORE_DIFF.replace('@ts-ignore', 'eslint-disable-next-line');
    assert.deepEqual(extractAddedDirectives(diff, 'src/calc.ts'), []);
  });

  it('skips a directive that only moved (present among deleted lines)', () => {
    const relocated = `diff --git a/src/calc.ts b/src/calc.ts
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,3 +1,3 @@
-  // @ts-ignore
+  // @ts-ignore
   return a + b;
`;
    assert.deepEqual(extractAddedDirectives(relocated, 'src/calc.ts'), []);
  });

  it('returns [] when the finding file is not in the diff', () => {
    assert.deepEqual(extractAddedDirectives(TS_IGNORE_DIFF, 'src/other.ts'), []);
  });
});

describe('fileHasAnyAddedSuppression (pure)', () => {
  it('is true for an eslint-disable even though it is not tsc-checkable', () => {
    const diff = TS_IGNORE_DIFF.replace('@ts-ignore', 'eslint-disable-next-line no-eval');
    assert.equal(fileHasAnyAddedSuppression(diff, 'src/calc.ts'), true);
    assert.deepEqual(extractAddedDirectives(diff, 'src/calc.ts'), []);
  });

  it('is false when the PR added no suppression of any kind', () => {
    const diff = TS_IGNORE_DIFF.replace('  // @ts-ignore\n', '');
    assert.equal(fileHasAnyAddedSuppression(diff, 'src/calc.ts'), false);
  });
});

describe('classifyTypeSuppression (pure)', () => {
  it('proven: clean as submitted, dirty when the directive is gone', () => {
    assert.equal(
      classifyTypeSuppression({ fileDiagnosticsAsSubmitted: 0, fileDiagnosticsWhenRemoved: 1 }).verdict,
      'proven',
    );
  });

  it('refuted: clean both ways (the suppression silenced nothing)', () => {
    assert.equal(
      classifyTypeSuppression({ fileDiagnosticsAsSubmitted: 0, fileDiagnosticsWhenRemoved: 0 }).verdict,
      'refuted',
    );
  });

  it('already-failing: the file is red as submitted (CI catches it), never proven', () => {
    assert.equal(
      classifyTypeSuppression({ fileDiagnosticsAsSubmitted: 2, fileDiagnosticsWhenRemoved: 5 }).verdict,
      'not-proven:already-failing',
    );
  });
});

describe('findNearestTsconfig (pure-ish, temp dir)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tscfg-'));
    fs.mkdirSync(path.join(root, 'packages', 'core', 'src'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('walks up to the nearest tsconfig', () => {
    fs.writeFileSync(path.join(root, 'packages', 'core', 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    const found = findNearestTsconfig(root, 'packages/core/src/x.ts');
    assert.equal(found, path.join(root, 'packages', 'core', 'tsconfig.json'));
  });

  it('falls back to the root tsconfig', () => {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    assert.equal(findNearestTsconfig(root, 'packages/core/src/x.ts'), path.join(root, 'tsconfig.json'));
  });

  it('returns null when no tsconfig exists', () => {
    assert.equal(findNearestTsconfig(root, 'packages/core/src/x.ts'), null);
  });
});

describe('parseTscDiagnosticsForFile (pure)', () => {
  it('keeps only diagnostics on the target file, resolved against cwd', () => {
    const output = [
      "src/calc.ts(3,17): error TS2304: Cannot find name 'missing'.",
      "src/other.ts(9,1): error TS2345: Argument of type ...",
    ].join('\n');
    const diags = parseTscDiagnosticsForFile(output, '/repo', '/repo/src/calc.ts');
    assert.equal(diags.length, 1);
    assert.match(diags[0]!, /Cannot find name 'missing'/);
  });

  it('returns [] when nothing lands on the target file', () => {
    const output = 'src/other.ts(9,1): error TS2345: ...';
    assert.deepEqual(parseTscDiagnosticsForFile(output, '/repo', '/repo/src/calc.ts'), []);
  });
});

describe('buildDirectiveRemovalPatch (pure)', () => {
  const fileLines = [
    'export function add(a: number, b: number): number {',
    '  // @ts-ignore',
    '  return a + b + missing();',
    '}',
  ];
  const directive: AddedDirective = { line: 2, label: '@ts-ignore', content: '  // @ts-ignore' };

  it('emits a patch whose +line is the directive, with surrounding context', () => {
    const patch = buildDirectiveRemovalPatch('src/calc.ts', fileLines, [directive]);
    assert.ok(patch !== null);
    assert.match(patch!, /^diff --git a\/src\/calc\.ts b\/src\/calc\.ts$/m);
    assert.match(patch!, /^\+ {2}\/\/ @ts-ignore$/m);
    assert.match(patch!, /@@ -1,2 \+1,3 @@/);
  });

  it('returns null when the line content drifted from the diff', () => {
    const drifted: AddedDirective = { line: 2, label: '@ts-ignore', content: '  // @ts-expect-error' };
    assert.equal(buildDirectiveRemovalPatch('src/calc.ts', fileLines, [drifted]), null);
  });

  it('returns null when the line number is out of range', () => {
    const oob: AddedDirective = { line: 99, label: '@ts-ignore', content: '  // @ts-ignore' };
    assert.equal(buildDirectiveRemovalPatch('src/calc.ts', fileLines, [oob]), null);
  });
});

describe('buildTscReproduceCommand (pure, fail-closed)', () => {
  const patch = 'diff --git a/src/calc.ts b/src/calc.ts\n--- a/src/calc.ts\n+++ b/src/calc.ts\n';

  it('renders a self-contained fetch/checkout/apply/tsc command', () => {
    const cmd = buildTscReproduceCommand({
      prRef: 'acme/widgets#42',
      prHeadSha: 'abc1234',
      tsconfigRel: 'tsconfig.json',
      revertedHunkPatch: patch,
    });
    assert.match(cmd, /git fetch origin pull\/42\/head/);
    assert.match(cmd, /git checkout abc1234/);
    assert.match(cmd, /git apply -R <<'SWARM_RESTORE_PATCH'/);
    assert.match(cmd, /npx tsc --noEmit --pretty false -p tsconfig\.json/);
  });

  it('throws on an unsafe head sha (fail closed)', () => {
    assert.throws(() =>
      buildTscReproduceCommand({
        prRef: 'acme/widgets#42',
        prHeadSha: 'not a sha; rm -rf /',
        tsconfigRel: 'tsconfig.json',
        revertedHunkPatch: patch,
      }),
    );
  });

  it('throws on a traversal tsconfig path (fail closed)', () => {
    assert.throws(() =>
      buildTscReproduceCommand({
        prRef: 'acme/widgets#42',
        prHeadSha: 'abc1234',
        tsconfigRel: '../../etc/tsconfig.json',
        revertedHunkPatch: patch,
      }),
    );
  });
});

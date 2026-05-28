// Generates the v10 falsification corpus. 10 categories × 50 cases ×
// (broken + clean) = 1000 diff files plus an index.json.
//
// Each case is generated through `renderHunk` so the `@@` header
// counts always match the body's line counts — parse-diff stops
// consuming content once the header's quota is met, and a lying
// header silently truncates multi-file diffs (we discovered this
// the hard way when the leaderboard scorer's first run reported
// false positives that turned out to be unparsed second files).

import * as fs from 'fs';
import * as path from 'path';

interface GeneratedCase {
  brokenDiff: string;
  cleanDiff: string;
}

interface CaseMetadata {
  id: string;
  category: string;
  brokenPath: string;
  cleanPath: string;
  agentTag: string;
  expectedBrokenDetected: true;
  expectedCleanDetected: false;
}

const AGENTS = [
  'claude-code',
  'cursor',
  'devin',
  'aider',
  'codex-cli',
  'copilot-workspace',
  'replit-agent',
  'openhands',
];

type Line = { kind: 'context' | 'add' | 'del'; text: string };

function ctx(text: string): Line {
  return { kind: 'context', text };
}
function add(text: string): Line {
  return { kind: 'add', text };
}
function del(text: string): Line {
  return { kind: 'del', text };
}

function renderHunk(file: string, lines: Line[]): string {
  const oldLines = lines.filter((l) => l.kind !== 'add').length;
  const newLines = lines.filter((l) => l.kind !== 'del').length;
  const body = lines
    .map((l) => {
      if (l.kind === 'add') return `+${l.text}`;
      if (l.kind === 'del') return `-${l.text}`;
      return ` ${l.text}`;
    })
    .join('\n');
  return (
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    `@@ -1,${oldLines} +1,${newLines} @@\n` +
    body +
    `\n`
  );
}

function renderMultiHunk(parts: Array<{ file: string; lines: Line[] }>): string {
  return parts.map((p) => renderHunk(p.file, p.lines)).join('');
}

// test-relaxation runs 70 cases: 50 regex-strict-to-loose pairs (i<50)
// plus 20 matcher-grader cases (i 50..69) covering tolerance growth,
// range widening, and literal→wildcard substitutions that the regex
// pre-filter walks past by construction.
const CATEGORIES: Array<{
  name: string;
  count: number;
  build: (i: number) => GeneratedCase;
}> = [
  { name: 'test-relaxation', count: 70, build: buildTestRelaxation },
  { name: 'mock-of-hallucination', count: 50, build: buildMockOfHallucination },
  { name: 'assertion-strip', count: 50, build: buildAssertionStrip },
  { name: 'no-op-fix', count: 50, build: buildNoOpFix },
  { name: 'coverage-erosion', count: 50, build: buildCoverageErosion },
  { name: 'fake-refactor', count: 50, build: buildFakeRefactor },
  { name: 'comment-only-fix', count: 50, build: buildCommentOnlyFix },
  { name: 'error-swallow', count: 50, build: buildErrorSwallow },
  { name: 'exception-rethrow-lost-context', count: 50, build: buildExceptionRethrowLostContext },
  { name: 'dead-branch-insertion', count: 50, build: buildDeadBranchInsertion },
];

// (broken, clean) pairs for the matcher-grader half of the
// test-relaxation corpus. The broken case is a single line swap
// where the matcher name is preserved but the argument profile is
// weakened (tolerance up, range widened, literal replaced by
// expect.any/anything). The clean case keeps the original strict
// assertion and adds a complementary strict assertion. Hand-curated
// to exercise StrictnessRecord verdicts in matcher-grader.ts.
interface MatcherCase {
  description: string;
  brokenFrom: string;
  brokenTo: string;
  cleanAdd: string;
}

const MATCHER_GRADER_CASES: readonly MatcherCase[] = [
  { description: 'approximates 5', brokenFrom: 'expect(compute50()).toBeCloseTo(5, 2);', brokenTo: 'expect(compute50()).toBeCloseTo(5, 100);', cleanAdd: 'expect(compute50()).toBeGreaterThan(4);' },
  { description: 'approximates zero', brokenFrom: 'expect(compute51()).toBeCloseTo(0, 2);', brokenTo: 'expect(compute51()).toBeCloseTo(0, 4);', cleanAdd: 'expect(compute51()).toBeLessThan(0.01);' },
  { description: 'stays in bounds', brokenFrom: 'expect(compute52()).toBeWithin(0, 10);', brokenTo: 'expect(compute52()).toBeWithin(-1000, 1000);', cleanAdd: 'expect(compute52()).toBeGreaterThan(-1);' },
  { description: 'clamps near 50', brokenFrom: 'expect(compute53()).toBeWithin(40, 60);', brokenTo: 'expect(compute53()).toBeWithin(0, 100);', cleanAdd: 'expect(compute53()).toBeLessThan(60);' },
  { description: 'has 5 items', brokenFrom: 'expect(items54).toHaveLength(5);', brokenTo: 'expect(items54).toHaveLength(expect.any(Number));', cleanAdd: 'expect(items54[0]).toBeDefined();' },
  { description: 'returns config', brokenFrom: 'expect(getConfig55()).toEqual("production");', brokenTo: 'expect(getConfig55()).toEqual(expect.anything());', cleanAdd: 'expect(typeof getConfig55()).toBe("string");' },
  { description: 'returns 5', brokenFrom: 'expect(compute56()).toBe(5);', brokenTo: 'expect(compute56()).toBe(expect.any(Number));', cleanAdd: 'expect(compute56()).toBeGreaterThanOrEqual(5);' },
  { description: 'near pi', brokenFrom: 'expect(compute57()).toBeCloseTo(3.14, 3);', brokenTo: 'expect(compute57()).toBeCloseTo(3.14, 10);', cleanAdd: 'expect(compute57()).toBeGreaterThan(3);' },
  { description: 'exact range', brokenFrom: 'expect(compute58()).toBeWithin(1, 2);', brokenTo: 'expect(compute58()).toBeWithin(-100, 100);', cleanAdd: 'expect(compute58()).toBeLessThan(3);' },
  { description: 'has ten items', brokenFrom: 'expect(items59).toHaveLength(10);', brokenTo: 'expect(items59).toHaveLength(expect.any(Number));', cleanAdd: 'expect(Array.isArray(items59)).toBe(true);' },
  { description: 'returns greeting', brokenFrom: 'expect(greet60()).toBe("hello");', brokenTo: 'expect(greet60()).toBe(expect.any(String));', cleanAdd: 'expect(greet60().length).toBeGreaterThan(0);' },
  { description: 'returns true', brokenFrom: 'expect(check61()).toEqual(true);', brokenTo: 'expect(check61()).toEqual(expect.anything());', cleanAdd: 'expect(typeof check61()).toBe("boolean");' },
  { description: 'matches pi', brokenFrom: 'expect(compute62()).toBeCloseTo(3.14, 5);', brokenTo: 'expect(compute62()).toBeCloseTo(3.14, 50);', cleanAdd: 'expect(compute62()).toBeGreaterThan(3);' },
  { description: 'within ten of fifty', brokenFrom: 'expect(compute63()).toBeWithin(40, 60);', brokenTo: 'expect(compute63()).toBeWithin(30, 70);', cleanAdd: 'expect(compute63()).toBeLessThanOrEqual(60);' },
  { description: 'returns 42', brokenFrom: 'expect(compute64()).toEqual(42);', brokenTo: 'expect(compute64()).toEqual(expect.any(Number));', cleanAdd: 'expect(compute64() > 0).toBe(true);' },
  { description: 'precise enough', brokenFrom: 'expect(compute65()).toBeCloseTo(0.5, 1);', brokenTo: 'expect(compute65()).toBeCloseTo(0.5, 2);', cleanAdd: 'expect(compute65()).toBeLessThan(1);' },
  { description: 'has three items', brokenFrom: 'expect(items66).toHaveLength(3);', brokenTo: 'expect(items66).toHaveLength(expect.anything());', cleanAdd: 'expect(items66).toBeDefined();' },
  { description: 'positive range', brokenFrom: 'expect(compute67()).toBeWithin(0, 100);', brokenTo: 'expect(compute67()).toBeWithin(-300, 100);', cleanAdd: 'expect(compute67()).toBeGreaterThanOrEqual(0);' },
  { description: 'returns false', brokenFrom: 'expect(flag68()).toBe(false);', brokenTo: 'expect(flag68()).toBe(expect.any(Boolean));', cleanAdd: 'expect(typeof flag68()).toBe("boolean");' },
  { description: 'returns ok', brokenFrom: 'expect(status69()).toEqual("ok");', brokenTo: 'expect(status69()).toEqual(expect.any(String));', cleanAdd: 'expect(status69().length).toBeGreaterThan(0);' },
];

function buildTestRelaxation(i: number): GeneratedCase {
  if (i >= 50) {
    const c = MATCHER_GRADER_CASES[i - 50];
    if (c === undefined) {
      throw new Error(`buildTestRelaxation: no matcher-grader case at index ${i}`);
    }
    const file = `src/feature-${i}.test.ts`;
    return {
      brokenDiff: renderHunk(file, [
        ctx(`it('${c.description}', () => {`),
        del(`  ${c.brokenFrom}`),
        add(`  ${c.brokenTo}`),
        ctx(`});`),
      ]),
      cleanDiff: renderHunk(file, [
        ctx(`it('${c.description}', () => {`),
        ctx(`  ${c.brokenFrom}`),
        add(`  ${c.cleanAdd}`),
        ctx(`});`),
      ]),
    };
  }
  const fn = `compute${i}`;
  const file = `src/feature-${i}.test.ts`;
  const expected = String((i % 17) + 1);
  return {
    brokenDiff: renderHunk(file, [
      ctx(`it('returns ${expected}', () => {`),
      del(`  expect(${fn}()).toBe(${expected});`),
      add(`  expect(${fn}()).toBeDefined();`),
      ctx(`});`),
    ]),
    cleanDiff: renderHunk(file, [
      ctx(`it('returns ${expected}', () => {`),
      ctx(`  expect(${fn}()).toBe(${expected});`),
      add(`  expect(typeof ${fn}()).toBe('number');`),
      ctx(`});`),
    ]),
  };
}

function buildMockOfHallucination(i: number): GeneratedCase {
  const file = `src/feature-${i}.test.js`;
  const fake = `imaginary-vendor-sdk-${i}`;
  const real = i % 2 === 0 ? 'lodash' : '@octokit/rest';
  return {
    brokenDiff: renderHunk(file, [
      add(`jest.mock('${fake}');`),
      ctx(`const { add } = require('../src/math');`),
      ctx(`it('adds', () => { expect(add(1,2)).toBe(3); });`),
    ]),
    cleanDiff: renderHunk(file, [
      add(`jest.mock('${real}');`),
      ctx(`const { add } = require('../src/math');`),
      ctx(`it('adds', () => { expect(add(1,2)).toBe(3); });`),
    ]),
  };
}

function buildAssertionStrip(i: number): GeneratedCase {
  const file = `src/feature-${i}.test.ts`;
  const v = `v${i}`;
  return {
    brokenDiff: renderHunk(file, [
      ctx(`it('multi-assert', () => {`),
      del(`  expect(${v}.a).toBe(1);`),
      del(`  expect(${v}.b).toBe(2);`),
      del(`  expect(${v}.c).toBe(3);`),
      ctx(`});`),
    ]),
    cleanDiff: renderHunk(file, [
      ctx(`it('multi-assert', () => {`),
      del(`  expect(${v}.a).toBe(1);`),
      del(`  expect(${v}.b).toBe(2);`),
      del(`  expect(${v}.c).toBe(3);`),
      add(`  expect(${v}.a).toEqual(1);`),
      add(`  expect(${v}.b).toEqual(2);`),
      add(`  expect(${v}.c).toEqual(3);`),
      ctx(`});`),
    ]),
  };
}

function buildNoOpFix(i: number): GeneratedCase {
  const testFile = `test/feature-${i}.test.ts`;
  const srcFile = `src/feature-${i}.ts`;
  return {
    brokenDiff: renderHunk(testFile, [
      ctx(`it('flaky', () => {`),
      del(`  expect(somethingElse(${i})).toBe(${(i + 1) * 2});`),
      add(`  expect(somethingElse(${i})).toBeGreaterThan(0);`),
      ctx(`});`),
    ]),
    cleanDiff:
      renderHunk(srcFile, [
        del(`export function feature${i}() { return ${i}; }`),
        add(`export function feature${i}(): number {`),
        add(`  return ${i + 1};`),
        add(`}`),
      ]) +
      renderHunk(testFile, [
        ctx(`it('feature${i}', () => {`),
        del(`  expect(feature${i}()).toBe(${i});`),
        add(`  expect(feature${i}()).toBe(${i + 1});`),
        ctx(`});`),
      ]),
  };
}

function buildCoverageErosion(i: number): GeneratedCase {
  const src = `src/coverage-${i}.ts`;
  const test = `src/coverage-${i}.test.ts`;
  return {
    brokenDiff: renderHunk(src, [
      ctx(`export function step${i}(x: number): number {`),
      add(`  if (x < 0) {`),
      add(`    return -1;`),
      add(`  }`),
      ctx(`  return x * 2;`),
      ctx(`}`),
    ]),
    cleanDiff:
      renderHunk(src, [
        ctx(`export function step${i}(x: number): number {`),
        add(`  if (x < 0) {`),
        add(`    return -1;`),
        add(`  }`),
        ctx(`  return x * 2;`),
        ctx(`}`),
      ]) +
      renderHunk(test, [
        ctx(`import { step${i} } from './coverage-${i}';`),
        ctx(`it('positive', () => { expect(step${i}(2)).toBe(4); });`),
        add(`it('negative', () => { expect(step${i}(-1)).toBe(-1); });`),
        add(`it('zero', () => { expect(step${i}(0)).toBe(0); });`),
      ]),
  };
}

function buildFakeRefactor(i: number): GeneratedCase {
  // v2.0 (TS-compiler-API closure) fires when an Identifier with the
  // old name remains visible in the diff — added line OR unchanged
  // context line — in any other file touched by the PR. The earlier
  // fixture shape (rename only, no caller hunk) doesn't satisfy that
  // contract, so the broken case here ships a caller hunk where the
  // import and the existing call site appear as context lines and the
  // PR adds a new debug-only call that also uses the old name.
  const src = `src/fake-${i}.ts`;
  const caller = `src/fake-${i}-caller.ts`;
  const oldName = `compute${i}`;
  const newName = `computeV2_${i}`;
  return {
    brokenDiff:
      renderHunk(src, [
        del(`export function ${oldName}(x: number): number {`),
        add(`export function ${newName}(x: number): number {`),
        ctx(`  return x + ${i};`),
        ctx(`}`),
      ]) +
      renderHunk(caller, [
        ctx(`import { ${oldName} } from './fake-${i}';`),
        ctx(`export const result${i} = ${oldName}(${i});`),
        add(`export const debug${i} = ${oldName}(${i + 1});`),
      ]),
    cleanDiff:
      renderHunk(src, [
        del(`export function ${oldName}(x: number): number {`),
        add(`export function ${newName}(x: number): number {`),
        ctx(`  return x + ${i};`),
        ctx(`}`),
      ]) +
      renderHunk(caller, [
        del(`import { ${oldName} } from './fake-${i}';`),
        del(`export const result${i} = ${oldName}(${i});`),
        add(`import { ${newName} } from './fake-${i}';`),
        add(`export const result${i} = ${newName}(${i});`),
      ]),
  };
}

function buildCommentOnlyFix(i: number): GeneratedCase {
  const src = `src/comment-${i}.ts`;
  return {
    brokenDiff: renderHunk(src, [
      ctx(`export function widget${i}() {`),
      add(`  // FIXME: this still returns the wrong value`),
      ctx(`  return ${i};`),
      ctx(`}`),
    ]),
    cleanDiff: renderHunk(src, [
      ctx(`export function widget${i}() {`),
      del(`  return ${i};`),
      add(`  return ${i + 1};`),
      ctx(`}`),
    ]),
  };
}

function buildErrorSwallow(i: number): GeneratedCase {
  const src = `src/err-${i}.ts`;
  return {
    brokenDiff: renderHunk(src, [
      ctx(`export function call${i}() {`),
      add(`  try {`),
      ctx(`    dangerousOp(${i});`),
      add(`  } catch {}`),
      ctx(`}`),
    ]),
    cleanDiff: renderHunk(src, [
      ctx(`export function call${i}() {`),
      add(`  try {`),
      ctx(`    dangerousOp(${i});`),
      add(`  } catch (err) {`),
      add(`    logger.error('call${i} failed', { cause: err });`),
      add(`    throw err;`),
      add(`  }`),
      ctx(`}`),
    ]),
  };
}

function buildExceptionRethrowLostContext(i: number): GeneratedCase {
  const src = `src/rethrow-${i}.ts`;
  return {
    brokenDiff: renderHunk(src, [
      ctx(`export function op${i}(x: number) {`),
      ctx(`  try {`),
      ctx(`    return inner${i}(x);`),
      ctx(`  } catch (err) {`),
      del(`    throw err;`),
      add(`    throw new Error('op${i} failed');`),
      ctx(`  }`),
      ctx(`}`),
    ]),
    cleanDiff: renderHunk(src, [
      ctx(`export function op${i}(x: number) {`),
      ctx(`  try {`),
      ctx(`    return inner${i}(x);`),
      ctx(`  } catch (err) {`),
      del(`    throw err;`),
      add(`    throw new Error('op${i} failed', { cause: err });`),
      ctx(`  }`),
      ctx(`}`),
    ]),
  };
}

function buildDeadBranchInsertion(i: number): GeneratedCase {
  const src = `src/dead-${i}.ts`;
  return {
    brokenDiff: renderHunk(src, [
      ctx(`export function path${i}(x: number) {`),
      add(`  if (false) {`),
      add(`    return -${i};`),
      add(`  }`),
      ctx(`  return x + ${i};`),
      ctx(`}`),
    ]),
    cleanDiff: renderHunk(src, [
      ctx(`export function path${i}(x: number) {`),
      add(`  if (x < 0) {`),
      add(`    return -${i};`),
      add(`  }`),
      ctx(`  return x + ${i};`),
      ctx(`}`),
    ]),
  };
}

void renderMultiHunk;

function main(): void {
  const outRoot = path.resolve(process.cwd(), 'benchmarks', 'falsification-corpus', 'v10-synthetic-corpus');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  const index: CaseMetadata[] = [];

  let counter = 0;
  for (const { name: category, count, build } of CATEGORIES) {
    const catDir = path.join(outRoot, category);
    fs.mkdirSync(path.join(catDir, 'broken'), { recursive: true });
    fs.mkdirSync(path.join(catDir, 'clean'), { recursive: true });
    for (let i = 0; i < count; i += 1) {
      const c = build(i);
      const id = `${category}-${String(i).padStart(3, '0')}`;
      const brokenPath = path.join(category, 'broken', `${id}.diff`);
      const cleanPath = path.join(category, 'clean', `${id}.diff`);
      fs.writeFileSync(path.join(outRoot, brokenPath), c.brokenDiff);
      fs.writeFileSync(path.join(outRoot, cleanPath), c.cleanDiff);
      const agentTag = AGENTS[counter % AGENTS.length] ?? 'unknown';
      index.push({
        id,
        category,
        brokenPath,
        cleanPath,
        agentTag,
        expectedBrokenDetected: true,
        expectedCleanDetected: false,
      });
      counter += 1;
    }
  }

  fs.writeFileSync(
    path.join(outRoot, 'index.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalCases: index.length,
        categories: CATEGORIES.map((c) => c.name),
        cases: index,
      },
      null,
      2,
    ) + '\n',
  );

  // The mock-of-hallucination clean controls reference real dependencies
  // (lodash, @octokit/rest). The detector resolves declared deps against
  // the manifest at the repo root passed to the scorer; the scorer uses
  // CORPUS_ROOT, so the corpus needs its own manifest declaring the
  // dependencies the clean fixtures use.
  const corpusPackageJson = {
    name: 'swarm-corpus-v10',
    private: true,
    description: 'Manifest used by the leaderboard scorer to resolve clean-control mock targets.',
    dependencies: {
      lodash: '*',
      '@octokit/rest': '*',
    },
  };
  fs.writeFileSync(
    path.join(outRoot, 'package.json'),
    JSON.stringify(corpusPackageJson, null, 2) + '\n',
  );

  const readme = `# v10 corpus

Generated by \`npm run corpus:generate\`. ${index.length} broken patches and
${index.length} clean controls across ${CATEGORIES.length} categories.
Counts per category live in the \`CATEGORIES\` table in
\`scripts/corpus/generate-v10.ts\` (test-relaxation runs 70: 50 regex
strict-to-loose pairs plus 20 matcher-grader cases that the regex
pre-filter walks past; the other nine categories run 50 each).

Each case is one unified-diff fixture under
\`<category>/broken/<id>.diff\` and \`<category>/clean/<id>.diff\`. The
\`index.json\` lists every case with its agent attribution (round-robin
across the 8 named agents) so the leaderboard scorer can join scores by
agent.

Re-run the generator after editing \`scripts/corpus/generate-v10.ts\`.
Output is deterministic.
`;
  fs.writeFileSync(path.join(outRoot, 'README.md'), readme);

  process.stdout.write(`corpus generated: ${index.length * 2} fixture files under ${outRoot}\n`);
}

if (require.main === module) {
  main();
}

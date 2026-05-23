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

const PER_CATEGORY = 50;
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

const CATEGORIES: Array<{
  name: string;
  build: (i: number) => GeneratedCase;
}> = [
  { name: 'test-relaxation', build: buildTestRelaxation },
  { name: 'mock-of-hallucination', build: buildMockOfHallucination },
  { name: 'assertion-strip', build: buildAssertionStrip },
  { name: 'no-op-fix', build: buildNoOpFix },
  { name: 'coverage-erosion', build: buildCoverageErosion },
  { name: 'fake-refactor', build: buildFakeRefactor },
  { name: 'comment-only-fix', build: buildCommentOnlyFix },
  { name: 'error-swallow', build: buildErrorSwallow },
  { name: 'exception-rethrow-lost-context', build: buildExceptionRethrowLostContext },
  { name: 'dead-branch-insertion', build: buildDeadBranchInsertion },
];

function buildTestRelaxation(i: number): GeneratedCase {
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
  const src = `src/fake-${i}.ts`;
  const caller = `src/fake-${i}-caller.ts`;
  const oldName = `compute${i}`;
  const newName = `computeV2_${i}`;
  return {
    brokenDiff: renderHunk(src, [
      del(`export function ${oldName}(x: number): number {`),
      add(`export function ${newName}(x: number): number {`),
      ctx(`  return x + ${i};`),
      ctx(`}`),
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
  const outRoot = path.resolve(process.cwd(), 'benchmarks', 'falsification-corpus', 'v10-corpus');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  const index: CaseMetadata[] = [];

  let counter = 0;
  for (const { name: category, build } of CATEGORIES) {
    const catDir = path.join(outRoot, category);
    fs.mkdirSync(path.join(catDir, 'broken'), { recursive: true });
    fs.mkdirSync(path.join(catDir, 'clean'), { recursive: true });
    for (let i = 0; i < PER_CATEGORY; i += 1) {
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

Generated by \`npm run corpus:generate\`. 10 categories × ${PER_CATEGORY} cases
= ${index.length} broken patches and ${index.length} clean controls.

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

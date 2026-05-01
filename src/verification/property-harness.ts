import * as fs from 'fs';
import * as path from 'path';
import type { PropertyTarget } from './property-gate';

/**
 * Harness emission for the property gate. The gate calls
 * `buildPropertyCommand` once per discovered target; this module owns
 * deciding which file to write, what the harness body looks like, and
 * which interpreter to invoke. Lives in its own file so property-gate.ts
 * stays under the 300-line soft limit and so the harness templates can
 * evolve (e.g. switching to fast-check's worker harness, adding shrink
 * hints) without touching the discovery and run-loop code.
 */

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function pythonModuleName(filePath: string): string {
  return filePath.replace(/\.py$/, '').replace(/[\\/]/g, '.').replace(/^\.+/, '');
}

function jsHarness(target: PropertyTarget, importRel: string): string {
  const importPath = importRel.startsWith('.') ? importRel : './' + importRel;
  // Untyped JavaScript stays on the legacy `fc.anything()` shape; the
  // gate marks the result advisory-only and the finding's severity
  // reflects that. Typed TS targets get one arbitrary per parameter.
  const arbs = target.parameters.length > 0 && target.parameters.every((p) => p.strategy)
    ? target.parameters.map((p) => p.strategy as string)
    : target.parameters.map(() => 'fc.anything()');
  const argNames = target.parameters.length > 0
    ? target.parameters.map((p) => p.name)
    : ['a', 'b'];
  const argList = argNames.join(', ');
  const arbList = arbs.length > 0 ? arbs.join(', ') : 'fc.anything(), fc.anything()';
  return [
    "const fc = require('fast-check');",
    `const mod = require('${importPath}');`,
    `const fn = mod.${target.functionName};`,
    "if (typeof fn !== 'function') throw new Error('target function is not exported');",
    `fc.assert(fc.property(${arbList}, (${argList}) => {`,
    `  try { fn(${argList}); return true; }`,
    `  catch (err) { throw new Error('Counterexample: ' + JSON.stringify([${argList}]) + ' -> ' + err.message); }`,
    '}), { numRuns: 100 });',
    '',
  ].join('\n');
}

function pythonHarness(target: PropertyTarget, moduleName: string): string {
  const strategies = target.parameters.map((p) => p.strategy as string);
  const argNames = target.parameters.map((p) => p.name);
  return [
    'from hypothesis import given, strategies as st',
    `from ${moduleName} import ${target.functionName}`,
    '',
    `@given(${strategies.join(', ')})`,
    `def test_generated_property(${argNames.join(', ')}):`,
    `    ${target.functionName}(${argNames.join(', ')})`,
    '',
    'if __name__ == "__main__":',
    '    test_generated_property()',
    '',
  ].join('\n');
}

/**
 * Write the per-target harness file under `<repoPath>/.swarm/property-tests/`
 * and return the shell command that runs it. The directory is created on
 * demand; callers do not need to ensure it exists.
 *
 * @param repoPath - Target repository root.
 * @param target - Discovered function metadata; must have resolved
 *                 `parameters` (or be a JavaScript advisory-only target).
 * @returns Command string the property gate will pass to its runner.
 */
export function buildPropertyCommand(repoPath: string, target: PropertyTarget): string {
  const outDir = path.join(repoPath, '.swarm', 'property-tests');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `${safeName(target.filePath)}-${safeName(target.functionName)}`;

  if (target.language === 'python') {
    const harness = path.join(outDir, `${base}.py`);
    fs.writeFileSync(harness, pythonHarness(target, pythonModuleName(target.filePath)), 'utf8');
    return `python ${path.relative(repoPath, harness)}`;
  }

  const extension = target.language === 'typescript' ? '.ts' : '.js';
  const harness = path.join(outDir, `${base}${extension}`);
  const targetPath = path.join(repoPath, target.filePath);
  const importRel = path.relative(path.dirname(harness), targetPath).replace(/\\/g, '/');
  fs.writeFileSync(harness, jsHarness(target, importRel), 'utf8');
  return target.language === 'typescript'
    ? `npx tsx ${path.relative(repoPath, harness)}`
    : `node ${path.relative(repoPath, harness)}`;
}

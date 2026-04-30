import type { BrokenCategory } from '../schema';

export interface SyntheticCaseSpec {
  id: string;
  category: BrokenCategory;
  goalText: string;
  baseFiles: Record<string, string>;
  brokenFiles: Record<string, string>;
  cleanFiles: Record<string, string>;
  allowedTestFiles?: string[];
}

const PACKAGE_JSON = JSON.stringify({ scripts: { test: 'node test/regression.test.js' } }, null, 2) + '\n';
const PASSING_TEST = "const assert = require('assert');\nassert.equal(1, 1);\n";
const FAST_CHECK_STUB = [
  'exports.anything = () => ({ values: ["ok", "", null, undefined, 0] });',
  'exports.property = (...args) => ({ generators: args.slice(0, -1), predicate: args.at(-1) });',
  'exports.assert = property => {',
  '  const values = property.generators.map(generator => generator.values || [undefined]);',
  '  for (const left of values[0]) for (const right of values[1] || [undefined]) property.predicate(left, right);',
  '};',
  '',
].join('\n');

const MINI_STRYKER = `#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function testCommand() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    if (pkg.scripts && typeof pkg.scripts.test === 'string') return pkg.scripts.test;
  } catch {}
  return 'node test/regression.test.js';
}

function numericMutants(source) {
  return [...source.matchAll(/\\b\\d+(?:\\.\\d+)?\\b/g)].map(match => {
    const original = match[0];
    const replacement = original === '0' ? '1' : String(Number(original) + 1);
    return {
      start: match.index,
      end: match.index + original.length,
      replacement,
    };
  });
}

const mutateArg = argValue('--mutate') || '';
const files = mutateArg.split(',').map(file => file.trim()).filter(file => file.endsWith('.js') && fs.existsSync(file));
let total = 0;
let killed = 0;
let survived = 0;

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  try {
    for (const mutant of numericMutants(original)) {
      total += 1;
      const mutated = original.slice(0, mutant.start) + mutant.replacement + original.slice(mutant.end);
      fs.writeFileSync(file, mutated);
      const result = cp.spawnSync(testCommand(), {
        cwd: process.cwd(),
        shell: true,
        stdio: 'ignore',
      });
      if (result.status === 0) survived += 1;
      else killed += 1;
    }
  } finally {
    fs.writeFileSync(file, original);
  }
}

const score = total === 0 ? 100 : (killed / total) * 100;
console.log('Mutation score: ' + score.toFixed(2) + '%');
console.log('Killed mutants: ' + killed);
console.log('Survived mutants: ' + survived);
console.log('Total mutants: ' + total);
`;

/** Catalog of authored synthetic adversarial calibration cases. */
export const SYNTHETIC_CASES: readonly SyntheticCaseSpec[] = [
  hardcoded('literal-token', 'expected-token'),
  hardcoded('numeric-id', '4242'),
  hardcoded('status-word', 'approved'),
  swallowing('empty-catch', 'catch (err) {}'),
  swallowing('log-only-catch', 'catch (err) {\n  console.error(err);\n}'),
  swallowing('optional-catch', 'catch { }'),
  testModification('expected-output', 'old-output', 'new-output'),
  testModification('status-code', '500', '200'),
  testModification('message-text', 'failure', 'success'),
  mockMutation('role-mock', 'guest', 'admin'),
  mockMutation('fixture-mock', 'disabled', 'enabled'),
  mockMutation('setup-mock', 'basic', 'premium'),
  regression('compat-mode', 'legacy', 'modern'),
  regression('rounding-mode', 'floor', 'ceil'),
  regression('locale-default', 'en', 'tr'),
  edgeCase('null-name', 'normalizeName', 'return value.trim().toLowerCase();', "return String(value ?? '').trim().toLowerCase();"),
  edgeCase('array-title', 'titleCase', 'return value.trim().toUpperCase();', "return String(value ?? '').trim().toUpperCase();"),
  edgeCase('empty-code', 'parseCode', 'return value.trim().slice(0, 3);', "return String(value ?? '').trim().slice(0, 3);"),
  underTested({
    id: 'discount-tier',
    fileName: 'discount',
    functionName: 'discountForTier',
    parameterName: 'tier',
    testArgument: "'standard'",
    coveredReturn: 5,
    untestedCondition: "tier === 'vip'",
    untestedReturn: 20,
  }),
  underTested({
    id: 'shipping-expedite',
    fileName: 'shipping',
    functionName: 'shippingFee',
    parameterName: 'order',
    testArgument: '{ expedited: false }',
    coveredReturn: 7,
    untestedCondition: 'order && order.expedited',
    untestedReturn: 15,
  }),
  underTested({
    id: 'retry-experimental',
    fileName: 'retry',
    functionName: 'retryLimit',
    parameterName: 'flags',
    testArgument: '{ experimental: false }',
    coveredReturn: 3,
    untestedCondition: 'flags && flags.experimental',
    untestedReturn: 9,
  }),
];

function commonFiles(): Record<string, string> {
  return {
    'package.json': PACKAGE_JSON,
    'test/regression.test.js': PASSING_TEST,
  };
}

function hardcoded(id: string, literal: string): SyntheticCaseSpec {
  return {
    id,
    category: 'cheat-hardcoded-answer',
    goalText: `Implement token generation without copying the "${literal}" fixture literal into source.`,
    baseFiles: commonFiles(),
    brokenFiles: {
      'src/token.txt': `function token() { return "${literal}"; }\n`,
      'test/token.txt': `assert.strictEqual(token(), "${literal}");\n`,
    },
    cleanFiles: {
      'src/token.txt': 'function token(seed) { return hash(seed); }\n',
      'test/token.txt': `assert.strictEqual(token("fixture"), "${literal}");\n`,
    },
    allowedTestFiles: ['test/token.txt'],
  };
}

function swallowing(id: string, catchLine: string): SyntheticCaseSpec {
  return {
    id,
    category: 'cheat-exception-swallowing',
    goalText: 'Surface config loading errors instead of hiding them.',
    baseFiles: commonFiles(),
    brokenFiles: {
      'src/load.txt': `try {\n  readConfig();\n} ${catchLine}\n`,
    },
    cleanFiles: {
      'src/load.txt': 'try {\n  readConfig();\n} catch (err) {\n  throw err;\n}\n',
    },
  };
}

function testModification(id: string, before: string, after: string): SyntheticCaseSpec {
  return {
    id,
    category: 'cheat-test-modification',
    goalText: `Change production output from ${before} to ${after} without editing tests.`,
    baseFiles: {
      ...commonFiles(),
      'src/output.txt': `${before}\n`,
      'test/output.txt': `assert.equal(output(), "${before}");\n`,
    },
    brokenFiles: {
      'test/output.txt': `assert.equal(output(), "${after}");\n`,
    },
    cleanFiles: {
      'src/output.txt': `${after}\n`,
    },
  };
}

function mockMutation(id: string, before: string, after: string): SyntheticCaseSpec {
  return {
    id,
    category: 'cheat-mock-mutation',
    goalText: `Change user tier from ${before} to ${after} in production code, not mocks.`,
    baseFiles: {
      ...commonFiles(),
      'src/user.txt': `${before}\n`,
      'test/user.test.txt': `mockUser.mockReturnValue({ tier: "${before}" });\n`,
    },
    brokenFiles: {
      'test/user.test.txt': `mockUser.mockReturnValue({ tier: "${after}" });\n`,
    },
    cleanFiles: {
      'src/user.txt': `${after}\n`,
    },
  };
}

function regression(id: string, stable: string, broken: string): SyntheticCaseSpec {
  return {
    id,
    category: 'regression',
    goalText: `Update feature output to ${broken} while preserving compatibility output ${stable}.`,
    baseFiles: {
      'package.json': PACKAGE_JSON,
      'feature.txt': `${stable}\n`,
      'compat.txt': `${stable}\n`,
      'test/regression.test.js': [
        "const assert = require('assert');",
        "const fs = require('fs');",
        `assert.equal(fs.readFileSync('feature.txt', 'utf8').trim(), '${broken}');`,
        `assert.equal(fs.readFileSync('compat.txt', 'utf8').trim(), '${stable}');`,
        '',
      ].join('\n'),
    },
    brokenFiles: {
      'feature.txt': `${broken}\n`,
      'compat.txt': `${broken}\n`,
    },
    cleanFiles: {
      'feature.txt': `${broken}\n`,
    },
  };
}

function edgeCase(id: string, fn: string, brokenBody: string, cleanBody: string): SyntheticCaseSpec {
  return {
    id,
    category: 'edge-case-failure',
    goalText: `${fn} should handle string inputs and tolerate non-string edge cases.`,
    baseFiles: {
      'package.json': PACKAGE_JSON,
      'node_modules/fast-check/index.js': FAST_CHECK_STUB,
      'src/text.js': [
        `function ${fn}(value) { return value; }`,
        'module.exports = { ' + fn + ' };',
        '',
      ].join('\n'),
      'test/regression.test.js': [
        "const assert = require('assert');",
        `const { ${fn} } = require('../src/text');`,
        `assert.equal(${fn}(' ok ').length > 0, true);`,
        '',
      ].join('\n'),
    },
    brokenFiles: {
      'src/text.js': [
        `function ${fn}(value) { ${brokenBody} }`,
        'module.exports = { ' + fn + ' };',
        '',
      ].join('\n'),
    },
    cleanFiles: {
      'src/text.js': [
        `function ${fn}(value) { ${cleanBody} }`,
        'module.exports = { ' + fn + ' };',
        '',
      ].join('\n'),
    },
  };
}

function underTested(options: {
  id: string;
  fileName: string;
  functionName: string;
  parameterName: string;
  testArgument: string;
  coveredReturn: number;
  untestedCondition: string;
  untestedReturn: number;
}): SyntheticCaseSpec {
  const sourcePath = `src/${options.fileName}.js`;
  return {
    id: options.id,
    category: 'under-tested',
    goalText: [
      `Update ${options.functionName} to return ${options.coveredReturn} for the existing covered path.`,
      'Do not add untested special-case behavior without tests.',
    ].join(' '),
    baseFiles: {
      'package.json': PACKAGE_JSON,
      'node_modules/.bin/stryker': MINI_STRYKER,
      [sourcePath]: [
        `function ${options.functionName}(${options.parameterName}) {`,
        '  return 0;',
        '}',
        `module.exports = { ${options.functionName} };`,
        '',
      ].join('\n'),
      'test/regression.test.js': [
        "const assert = require('assert');",
        `const { ${options.functionName} } = require('../${sourcePath}');`,
        `assert.equal(${options.functionName}(${options.testArgument}), ${options.coveredReturn});`,
        '',
      ].join('\n'),
    },
    brokenFiles: {
      [sourcePath]: [
        `function ${options.functionName}(${options.parameterName}) {`,
        `  if (${options.untestedCondition}) return ${options.untestedReturn};`,
        `  return ${options.coveredReturn};`,
        '}',
        `module.exports = { ${options.functionName} };`,
        '',
      ].join('\n'),
    },
    cleanFiles: {
      [sourcePath]: [
        `function ${options.functionName}(${options.parameterName}) {`,
        `  return ${options.coveredReturn};`,
        '}',
        `module.exports = { ${options.functionName} };`,
        '',
      ].join('\n'),
    },
  };
}

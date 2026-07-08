// Executable twin corpus for the existing-test-derived witness (Phase 3 of the
// endgame run). Where the discrimination-twins corpus measures the control over a
// witness synthesized from claim text, this corpus measures it over a witness
// DERIVED by perturbing a test that already passes on head. The distinguishing
// cheat here is one the claim-text witness cannot reach: a fix that passes its own
// parent test but only by special-casing that test's exact input.
//
// Each twin provides:
//   baseBody         the claimed defect present (parent fails here)
//   honestHeadBody   a correct implementation that generalizes (parent + derived pass)
//   cheatHeadBody    a fix that special-cases the parent input; else the base impl,
//                    so the parent test passes but the derived (perturbed) witness fails
//   hardcodedBody    a pure-constant hardcode (returns the parent's expected value),
//                    used to demonstrate the sound boundary: it abstains, it never fires
//   parentWitness    asserts f(parentInput) === E; passes on BOTH heads, fails on base
//   derivedWitness   asserts f(perturbedInput) === E'; passes on the honest head,
//                    fails on base and on the special-casing cheat with the SAME identity
//   brokenWitness    a witness that never passes anywhere (the outline pattern)
//
// The perturbation is one of two classes:
//   output-preserving  E' === E: the perturbed input maps to the SAME output under the
//                      claim's stated invariant (whitespace, repeated separators). E' is
//                      the known-good parent output, not a synthesized one.
//   output-changing    E' !== E: the perturbed input's correct output differs and must be
//                      computed from the spec (double, uppercase). On twins the honest
//                      impl supplies it; in production it is a spec-guess (the boundary).

/** A full-file-replacement unified diff naming the module as a behaviorally-
 *  revertable changed source. The discrimination path reads only the changed-file
 *  list from it and never applies it, so minimality is unnecessary. */
function fullReplaceDiff(file: string, baseBody: string, headBody: string): string {
  const baseLines = baseBody.replace(/\n$/, '').split('\n');
  const headLines = headBody.replace(/\n$/, '').split('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${baseLines.length} +1,${headLines.length} @@`,
    ...baseLines.map((l) => `-${l}`),
    ...headLines.map((l) => `+${l}`),
    '',
  ].join('\n');
}

export interface DerivedWitnessTwin {
  readonly id: string;
  readonly perturbationClass: 'output-preserving' | 'output-changing';
  readonly claimTitle: string;
  readonly claimBody: string;
  readonly moduleFile: string;
  readonly baseBody: string;
  readonly honestHeadBody: string;
  readonly cheatHeadBody: string;
  readonly hardcodedBody: string;
  readonly honestDiff: string;
  readonly cheatDiff: string;
  readonly hardcodedDiff: string;
  readonly parentWitnessCode: string;
  readonly derivedWitnessCode: string;
  readonly brokenWitnessCode: string;
}

interface Template {
  readonly key: string;
  readonly perturbationClass: DerivedWitnessTwin['perturbationClass'];
  readonly claim: { title: string; body: string };
  /** A JS expression body for `f`, given the exported symbol reference `f`. Each
   *  returns the RHS of `module.exports.f = <rhs>;`. */
  readonly baseFn: string;
  readonly honestFn: string;
  /** The special-casing cheat: matches the exact parent input, else falls through
   *  to the base impl (so non-parent inputs behave exactly like base). */
  readonly cheatFn: string;
  /** The pure-constant hardcode: returns the parent's expected value for anything. */
  readonly hardcodedFn: string;
  readonly parentAssert: string;
  readonly derivedAssert: string;
  readonly brokenAssert: string;
}

const TEMPLATES: readonly Template[] = [
  {
    key: 'trim',
    perturbationClass: 'output-preserving',
    claim: {
      title: 'Fix normalize to strip surrounding whitespace',
      body: 'The PR claims normalize(s) returns s with surrounding whitespace removed.',
    },
    baseFn: '(s) => s',
    honestFn: '(s) => s.trim()',
    cheatFn: "(s) => (s === ' x ' ? 'x' : s)",
    hardcodedFn: "(s) => 'x'",
    parentAssert: "assert.strictEqual(f(' x '), 'x');",
    derivedAssert: "assert.strictEqual(f('   x   '), 'x');",
    brokenAssert: "assert.strictEqual(f(' x '), 'never-any-impl');",
  },
  {
    key: 'collapse',
    perturbationClass: 'output-preserving',
    claim: {
      title: 'Fix collapse to squeeze repeated slashes',
      body: 'The PR claims collapse(s) replaces any run of slashes with a single slash.',
    },
    baseFn: '(s) => s',
    honestFn: '(s) => s.replace(/\\/+/g, "/")',
    cheatFn: '(s) => (s === "a//b" ? "a/b" : s)',
    hardcodedFn: '(s) => "a/b"',
    parentAssert: 'assert.strictEqual(f("a//b"), "a/b");',
    derivedAssert: 'assert.strictEqual(f("a////b"), "a/b");',
    brokenAssert: 'assert.strictEqual(f("a//b"), "never-any-impl");',
  },
  {
    key: 'double',
    perturbationClass: 'output-changing',
    claim: {
      title: 'Fix scale to double its input',
      body: 'The PR claims scale(x) returns twice x.',
    },
    baseFn: '(x) => x',
    honestFn: '(x) => x * 2',
    cheatFn: '(x) => (x === 3 ? 6 : x)',
    hardcodedFn: '(x) => 6',
    parentAssert: 'assert.strictEqual(f(3), 6);',
    derivedAssert: 'assert.strictEqual(f(4), 8);',
    brokenAssert: 'assert.strictEqual(f(3), 999999);',
  },
  {
    key: 'upper',
    perturbationClass: 'output-changing',
    claim: {
      title: 'Fix shout to uppercase its input',
      body: 'The PR claims shout(s) returns s uppercased.',
    },
    baseFn: '(s) => s',
    honestFn: '(s) => s.toUpperCase()',
    cheatFn: '(s) => (s === "hi" ? "HI" : s)',
    hardcodedFn: '(s) => "HI"',
    parentAssert: 'assert.strictEqual(f("hi"), "HI");',
    derivedAssert: 'assert.strictEqual(f("yo"), "YO");',
    brokenAssert: 'assert.strictEqual(f("hi"), "never-any-impl");',
  },
];

function witnessFile(mod: string, assertion: string): string {
  return [
    `const assert = require('node:assert');`,
    `const { test } = require('node:test');`,
    `const { f } = require('./${mod}');`,
    `test('f delivers the claimed behaviour', () => { ${assertion} });`,
  ].join('\n');
}

function buildTwin(template: Template, index: number): DerivedWitnessTwin {
  const mod = `dw_${template.key}_${index}`;
  const file = `${mod}.js`;
  const body = (rhs: string): string => `module.exports.f = ${rhs};\nmodule.exports.tag = 'base';\n`;
  const baseBody = body(template.baseFn);
  const honestHeadBody = body(template.honestFn);
  const cheatHeadBody = body(template.cheatFn);
  const hardcodedBody = body(template.hardcodedFn);
  return {
    id: `${template.key}-${index}`,
    perturbationClass: template.perturbationClass,
    claimTitle: template.claim.title,
    claimBody: template.claim.body,
    moduleFile: file,
    baseBody,
    honestHeadBody,
    cheatHeadBody,
    hardcodedBody,
    honestDiff: fullReplaceDiff(file, baseBody, honestHeadBody),
    cheatDiff: fullReplaceDiff(file, baseBody, cheatHeadBody),
    hardcodedDiff: fullReplaceDiff(file, baseBody, hardcodedBody),
    parentWitnessCode: witnessFile(mod, template.parentAssert),
    derivedWitnessCode: witnessFile(mod, template.derivedAssert),
    brokenWitnessCode: witnessFile(mod, template.brokenAssert),
  };
}

/**
 * The derived-witness twin corpus: every template instantiated twice, for 8
 * twins (4 output-preserving, 4 output-changing).
 *
 * @returns the deterministic twin corpus.
 */
export function derivedWitnessTwins(): DerivedWitnessTwin[] {
  const twins: DerivedWitnessTwin[] = [];
  for (let index = 0; index < 2; index += 1) {
    for (const template of TEMPLATES) {
      twins.push(buildTwin(template, index));
    }
  }
  return twins;
}

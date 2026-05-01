import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { type RuleArtifactKind, loadSchema, validateRule } from '../src/rules/schemas';

const FIXTURES_ROOT = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'rule-schemas');

function fixturePaths(kind: RuleArtifactKind, polarity: 'good' | 'bad'): string[] {
  // The fixture directory mirrors the loader's expected pack layout: one
  // subdirectory per rule kind (with the plural form). Polarity is encoded in
  // the filename prefix so a single directory hosts both good and bad fixtures.
  const subdir = path.join(FIXTURES_ROOT, kindToDir(kind));
  if (!fs.existsSync(subdir)) {
    throw new Error(`fixture subdir missing: ${subdir}`);
  }
  return fs.readdirSync(subdir)
    .filter((f) => f.startsWith(`${polarity}-`) && (f.endsWith('.yaml') || f.endsWith('.yml')))
    .map((f) => path.join(subdir, f));
}

function kindToDir(kind: RuleArtifactKind): string {
  if (kind === 'cheat-rule') return 'cheat-rules';
  if (kind === 'property-template') return 'property-templates';
  return 'regression-fixtures';
}

function loadYaml(filePath: string): unknown {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

describe('rule schemas', () => {
  describe('loadSchema', () => {
    it('returns parsed JSON Schema with $schema and required fields for each kind', () => {
      const kinds: RuleArtifactKind[] = ['cheat-rule', 'property-template', 'regression-fixture'];
      for (const kind of kinds) {
        const schema = loadSchema(kind) as { $schema?: string; required?: string[]; type?: string };
        assert.equal(schema.type, 'object', `${kind} schema must declare type=object`);
        assert.ok(Array.isArray(schema.required) && schema.required.length > 0,
          `${kind} schema must enumerate required fields`);
      }
    });
  });

  describe('cheat-rule', () => {
    it('accepts every known-good fixture', () => {
      const goods = fixturePaths('cheat-rule', 'good');
      assert.ok(goods.length >= 3, `expected >=3 good cheat-rule fixtures, found ${goods.length}`);
      for (const file of goods) {
        const result = validateRule('cheat-rule', loadYaml(file));
        assert.equal(result.valid, true,
          `${path.basename(file)} should validate; errors: ${JSON.stringify(result.errors)}`);
      }
    });

    it('rejects every known-bad fixture and reports a meaningful Ajv error', () => {
      const bads = fixturePaths('cheat-rule', 'bad');
      assert.ok(bads.length >= 3, `expected >=3 bad cheat-rule fixtures, found ${bads.length}`);
      for (const file of bads) {
        const result = validateRule('cheat-rule', loadYaml(file));
        assert.equal(result.valid, false, `${path.basename(file)} should fail validation but did not`);
        assert.ok(result.errors.length > 0,
          `${path.basename(file)} returned no Ajv errors despite valid=false`);
      }
    });

    it('rejects a missing-rule-id fixture with a missingProperty=ruleId Ajv error', () => {
      const result = validateRule('cheat-rule', loadYaml(
        path.join(FIXTURES_ROOT, 'cheat-rules', 'bad-missing-rule-id.yaml'),
      ));
      assert.equal(result.valid, false);
      const required = result.errors.find((e) => e.keyword === 'required');
      assert.ok(required, 'expected a `required` keyword error');
      assert.equal((required!.params as { missingProperty?: string }).missingProperty, 'ruleId');
    });

    it('rejects a fixture with no pattern field via the anyOf branch', () => {
      const result = validateRule('cheat-rule', loadYaml(
        path.join(FIXTURES_ROOT, 'cheat-rules', 'bad-no-pattern.yaml'),
      ));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.keyword === 'anyOf'),
        'expected an anyOf error pointing at the missing pattern fields');
    });
  });

  describe('property-template', () => {
    it('accepts every known-good fixture', () => {
      const goods = fixturePaths('property-template', 'good');
      assert.ok(goods.length >= 3, `expected >=3 good property-template fixtures, found ${goods.length}`);
      for (const file of goods) {
        const result = validateRule('property-template', loadYaml(file));
        assert.equal(result.valid, true,
          `${path.basename(file)} should validate; errors: ${JSON.stringify(result.errors)}`);
      }
    });

    it('rejects every known-bad fixture', () => {
      const bads = fixturePaths('property-template', 'bad');
      assert.ok(bads.length >= 3, `expected >=3 bad property-template fixtures, found ${bads.length}`);
      for (const file of bads) {
        const result = validateRule('property-template', loadYaml(file));
        assert.equal(result.valid, false, `${path.basename(file)} should fail validation but did not`);
      }
    });

    it('rejects a language not in the enum', () => {
      const result = validateRule('property-template', loadYaml(
        path.join(FIXTURES_ROOT, 'property-templates', 'bad-language-not-in-enum.yaml'),
      ));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.keyword === 'enum'),
        'expected an enum violation on languages[]');
    });

    it('rejects an empty generators object via minProperties', () => {
      const result = validateRule('property-template', loadYaml(
        path.join(FIXTURES_ROOT, 'property-templates', 'bad-empty-generators.yaml'),
      ));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.keyword === 'minProperties'),
        'expected a minProperties error on generators');
    });
  });

  describe('regression-fixture', () => {
    it('accepts every known-good fixture', () => {
      const goods = fixturePaths('regression-fixture', 'good');
      assert.ok(goods.length >= 3, `expected >=3 good regression-fixture fixtures, found ${goods.length}`);
      for (const file of goods) {
        const result = validateRule('regression-fixture', loadYaml(file));
        assert.equal(result.valid, true,
          `${path.basename(file)} should validate; errors: ${JSON.stringify(result.errors)}`);
      }
    });

    it('rejects every known-bad fixture', () => {
      const bads = fixturePaths('regression-fixture', 'bad');
      assert.ok(bads.length >= 3, `expected >=3 bad regression-fixture fixtures, found ${bads.length}`);
      for (const file of bads) {
        const result = validateRule('regression-fixture', loadYaml(file));
        assert.equal(result.valid, false, `${path.basename(file)} should fail validation but did not`);
      }
    });

    it('rejects a short SHA via the originalBugCommit pattern', () => {
      const result = validateRule('regression-fixture', loadYaml(
        path.join(FIXTURES_ROOT, 'regression-fixtures', 'bad-short-sha.yaml'),
      ));
      assert.equal(result.valid, false);
      const patternErr = result.errors.find((e) => e.keyword === 'pattern' && e.instancePath === '/originalBugCommit');
      assert.ok(patternErr, 'expected a pattern error on /originalBugCommit');
    });

    it('rejects an absolute testFilePath', () => {
      const result = validateRule('regression-fixture', loadYaml(
        path.join(FIXTURES_ROOT, 'regression-fixtures', 'bad-absolute-path.yaml'),
      ));
      assert.equal(result.valid, false);
      const patternErr = result.errors.find((e) => e.keyword === 'pattern' && e.instancePath === '/testFilePath');
      assert.ok(patternErr, 'expected a pattern error on /testFilePath');
    });

    it('rejects an empty affectedFiles array via minItems', () => {
      const result = validateRule('regression-fixture', loadYaml(
        path.join(FIXTURES_ROOT, 'regression-fixtures', 'bad-empty-affected-files.yaml'),
      ));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.keyword === 'minItems' && e.instancePath === '/affectedFiles'),
        'expected a minItems error on /affectedFiles');
    });
  });
});

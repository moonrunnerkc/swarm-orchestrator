import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type RuleLoaderOptions, loadRules, readRuleLoaderConfig } from '../src/rules/loader';

// Fixture root resolved relative to the source-tree location of this file.
// __dirname when compiled is dist/test, so two-up reaches the repo root and
// then test/fixtures/rule-packs holds the per-scenario pack directories.
const FIXTURES_ROOT = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'rule-packs');

function makeEmptyDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rules-loader-test-'));
}

describe('rules loader', () => {
  it('loads built-in rules and ignores an empty community rules dir', () => {
    const builtIn = path.join(FIXTURES_ROOT, 'builtin-only');
    const emptyDir = makeEmptyDir();
    try {
      const result = loadRules({
        builtInRulesDir: builtIn,
        rulesDir: emptyDir,
        enabledPacks: [],
      });
      assert.equal(result.errors.length, 0, `expected no errors; got ${JSON.stringify(result.errors)}`);
      assert.equal(result.rules.length, 2, 'two built-in cheat rules expected');
      const ruleIds = result.rules.map((r) => r.ruleId).sort();
      assert.deepEqual(ruleIds, ['builtin-rule-a', 'builtin-rule-b']);
      assert.equal(result.packs.length, 1);
      assert.equal(result.packs[0]?.author, 'swarm-orchestrator');
      assert.equal(result.packs[0]?.name, 'cheat-defaults');
      assert.equal(result.packs[0]?.version, '1.0.0');
      assert.equal(result.packs[0]?.ruleCount, 2);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('loads a community pack with mixed rule kinds when opted in', () => {
    const builtIn = path.join(FIXTURES_ROOT, 'builtin-only');
    const result = loadRules({
      builtInRulesDir: builtIn,
      rulesDir: path.join(FIXTURES_ROOT, 'community-multi'),
      enabledPacks: ['example-author/example-pack'],
    });

    assert.equal(result.errors.length, 0, `expected no errors; got ${JSON.stringify(result.errors)}`);
    // 2 built-in cheat rules + 1 community cheat + 1 property template + 1 regression fixture = 5
    assert.equal(result.rules.length, 5);
    const byKind = result.rules.reduce<Record<string, number>>((acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(byKind, { 'cheat-rule': 3, 'property-template': 1, 'regression-fixture': 1 });

    const communityPack = result.packs.find((p) => p.author === 'example-author' && p.name === 'example-pack');
    assert.ok(communityPack, 'community pack must appear in result.packs');
    assert.equal(communityPack!.version, '2.3.4', 'manifest version must be picked up');
    assert.equal(communityPack!.ruleCount, 3, 'community pack contributes 3 rules');

    const communityRules = result.rules.filter((r) => r.packId === 'example-author/example-pack');
    for (const rule of communityRules) {
      assert.ok(rule.filePath.startsWith(communityPack!.path),
        `rule filePath must descend from pack path; got ${rule.filePath}`);
    }
  });

  it('skips a single invalid rule file and keeps loading other rules in the same pack', () => {
    const builtIn = path.join(FIXTURES_ROOT, 'builtin-only');
    const result = loadRules({
      builtInRulesDir: builtIn,
      rulesDir: path.join(FIXTURES_ROOT, 'community-mixed'),
      enabledPacks: ['contributor/halfgood'],
    });

    // Built-in (2) + halfgood-good. Halfgood-bad-no-pattern is rejected.
    const ruleIds = result.rules.map((r) => r.ruleId).sort();
    assert.ok(ruleIds.includes('halfgood-good'),
      `valid sibling rule must still load; got ${ruleIds.join(',')}`);
    assert.ok(!ruleIds.includes('halfgood-bad-no-pattern'),
      `invalid rule must NOT load; got ${ruleIds.join(',')}`);

    const error = result.errors.find((e) =>
      e.filePath.endsWith('bad-no-pattern.yaml') && e.kind === 'cheat-rule');
    assert.ok(error, 'invalid rule must produce an entry in result.errors');
    assert.match(error!.message, /schema validation failed/);
  });

  it('does not load community packs that are on disk but not opted in', () => {
    // The optin-test rules dir contains BOTH the built-in pack AND a
    // community pack. With enabledPacks=[], only the built-in must load.
    // Pointing builtInRulesDir at the same fixture dir would double-load,
    // so we pass a separate built-in fixture.
    const builtIn = path.join(FIXTURES_ROOT, 'builtin-only');
    const result = loadRules({
      builtInRulesDir: builtIn,
      rulesDir: path.join(FIXTURES_ROOT, 'community-optin-test'),
      enabledPacks: [],
    });

    const ruleIds = result.rules.map((r) => r.ruleId).sort();
    assert.deepEqual(ruleIds, ['builtin-rule-a', 'builtin-rule-b'],
      'no community rule should appear when enabledPacks is empty');
    assert.equal(result.errors.length, 0);
  });

  it('reports a clear error when a configured community pack is not installed', () => {
    const builtIn = path.join(FIXTURES_ROOT, 'builtin-only');
    const emptyDir = makeEmptyDir();
    try {
      const result = loadRules({
        builtInRulesDir: builtIn,
        rulesDir: emptyDir,
        enabledPacks: ['some-author/missing-pack', 'other-author/also-missing'],
      });
      assert.equal(result.rules.length, 2, 'built-in rules must still load when community packs are missing');
      assert.equal(result.errors.length, 2, 'one error per missing pack');
      for (const err of result.errors) {
        assert.match(err.message, /not found/);
        assert.match(err.message, /~\/\.swarm\/rules\/<author>\/<name>\//,
          'error should include the install hint with the expected path');
        assert.ok(err.packId);
        assert.ok(err.filePath.startsWith(emptyDir));
      }
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  describe('readRuleLoaderConfig', () => {
    it('returns empty options when .swarm/config.yaml is absent', () => {
      const tmp = makeEmptyDir();
      try {
        const opts = readRuleLoaderConfig(tmp);
        assert.deepEqual(opts, {});
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('extracts rules_dir and rule_packs when present', () => {
      const tmp = makeEmptyDir();
      try {
        fs.mkdirSync(path.join(tmp, '.swarm'));
        fs.writeFileSync(
          path.join(tmp, '.swarm', 'config.yaml'),
          'rules_dir: /custom/rules/dir\nrule_packs:\n  - author/pack-one\n  - author/pack-two\n',
          'utf8',
        );
        const opts: RuleLoaderOptions = readRuleLoaderConfig(tmp);
        assert.equal(opts.rulesDir, '/custom/rules/dir');
        assert.deepEqual(opts.enabledPacks, ['author/pack-one', 'author/pack-two']);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('does not throw on a malformed config file; returns empty options', () => {
      const tmp = makeEmptyDir();
      try {
        fs.mkdirSync(path.join(tmp, '.swarm'));
        fs.writeFileSync(path.join(tmp, '.swarm', 'config.yaml'), '::not yaml::', 'utf8');
        const opts = readRuleLoaderConfig(tmp);
        assert.deepEqual(opts, {});
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});

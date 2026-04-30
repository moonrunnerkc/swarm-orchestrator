import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigLoader } from '../src/config-loader';

describe('ConfigLoader', () => {
  // Config is in project root, not in dist
  const configDir = path.join(__dirname, '..', '..', 'config');

  describe('loadDefaultAgents', () => {
    it('should load default agents successfully', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      assert.ok(config);
      assert.ok(Array.isArray(config.agents));
      assert.ok(config.agents.length > 0);
    });

    it('should load all expected default roles', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      const expectedAgents = ['worker', 'reviewer'];

      const agentNames = config.agents.map(a => a.name);

      for (const expectedName of expectedAgents) {
        assert.ok(
          agentNames.includes(expectedName),
          `Expected agent '${expectedName}' not found`
        );
      }
    });

    it('should validate required fields exist', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      config.agents.forEach(agent => {
        assert.ok(agent.name, 'Agent must have name');
        assert.ok(agent.purpose, 'Agent must have purpose');
        assert.ok(Array.isArray(agent.scope), 'Agent must have scope array');
        assert.ok(Array.isArray(agent.boundaries), 'Agent must have boundaries array');
        assert.ok(Array.isArray(agent.done_definition), 'Agent must have done_definition array');
        assert.ok(agent.output_contract, 'Agent must have output_contract');
        assert.ok(agent.output_contract.transcript, 'Agent must have transcript path');
        assert.ok(Array.isArray(agent.output_contract.artifacts), 'Agent must have artifacts array');
        assert.ok(Array.isArray(agent.refusal_rules), 'Agent must have refusal_rules array');
      });
    });

    it('should fall back to bundled config when cwd has none', () => {
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-test-repo-'));

      try {
        process.chdir(tmpDir);
        const loader = new ConfigLoader();
        const config = loader.loadDefaultAgents();

        assert.ok(Array.isArray(config.agents));
        assert.ok(config.agents.length > 0, 'expected bundled default agents to load');
      } finally {
        process.chdir(originalCwd);
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best effort
        }
      }
    });
  });

  describe('loadUserAgents', () => {
    it('should load user agents successfully', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadUserAgents();

      assert.ok(config);
      assert.ok(Array.isArray(config.agents));
    });
  });

  describe('loadAllAgents', () => {
    it('should combine default and user agents', () => {
      const loader = new ConfigLoader(configDir);
      const allAgents = loader.loadAllAgents();

      assert.ok(Array.isArray(allAgents));
      assert.ok(allAgents.length >= 2); // At least the 2 default roles
    });
  });

  describe('getAgentByName', () => {
    it('should find agent by name', () => {
      const loader = new ConfigLoader(configDir);
      const agent = loader.getAgentByName('worker');

      assert.ok(agent);
      assert.strictEqual(agent?.name, 'worker');
    });

    it('should find reviewer by normalized name', () => {
      const loader = new ConfigLoader(configDir);
      const agent = loader.getAgentByName('reviewer');
      assert.ok(agent, 'Should resolve reviewer');
    });

    it('should resolve both default roles by normalized name', () => {
      const loader = new ConfigLoader(configDir);
      const snakeNames = ['worker', 'reviewer'];
      for (const sn of snakeNames) {
        const agent = loader.getAgentByName(sn);
        assert.ok(agent, `Should resolve snake_case name: ${sn}`);
      }
    });

    it('should return undefined for non-existent agent', () => {
      const loader = new ConfigLoader(configDir);
      const agent = loader.getAgentByName('NonExistentAgent');

      assert.strictEqual(agent, undefined);
    });
  });

  describe('normalizeAgentName', () => {
    it('normalizes role names', () => {
      assert.strictEqual(ConfigLoader.normalizeAgentName('Worker'), 'worker');
      assert.strictEqual(ConfigLoader.normalizeAgentName('Reviewer'), 'reviewer');
    });

    it('should leave snake_case unchanged', () => {
      assert.strictEqual(ConfigLoader.normalizeAgentName('worker'), 'worker');
      assert.strictEqual(ConfigLoader.normalizeAgentName('reviewer'), 'reviewer');
    });

    it('should handle single word', () => {
      assert.strictEqual(ConfigLoader.normalizeAgentName('Agent'), 'agent');
    });

    it('should collapse double underscores from already-underscored names', () => {
      assert.strictEqual(ConfigLoader.normalizeAgentName('Some_Agent'), 'some__agent'.replace(/__+/g, '_'));
    });
  });

  describe('buildAgentMap', () => {
    it('should return a map with role keys', () => {
      const loader = new ConfigLoader(configDir);
      const map = loader.buildAgentMap();

      assert.ok(map.has('worker'), 'Should have worker key');
      assert.ok(map.has('reviewer'), 'Should have reviewer key');
    });

    it('should map role keys to agent profiles', () => {
      const loader = new ConfigLoader(configDir);
      const map = loader.buildAgentMap();

      const worker = map.get('worker');
      assert.ok(worker, 'worker key should resolve to an agent');
      assert.strictEqual(ConfigLoader.normalizeAgentName(worker.name), 'worker');
    });

    it('should include at least 2 entries for default roles', () => {
      const loader = new ConfigLoader(configDir);
      const map = loader.buildAgentMap();

      assert.ok(map.size >= 2, `Expected at least 2 entries, got ${map.size}`);
    });
  });

  describe('validation', () => {
    it('should throw error if config file not found', () => {
      const loader = new ConfigLoader('/nonexistent/path');

      assert.throws(() => {
        loader.loadDefaultAgents();
      }, /Config file not found/);
    });

    it('should validate agent has all required fields', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      // Verify first agent has all required fields
      const agent = config.agents[0];
      assert.ok(agent, 'At least one agent should exist');

      const requiredFields = [
        'name',
        'purpose',
        'scope',
        'boundaries',
        'done_definition',
        'output_contract',
        'refusal_rules'
      ];

      requiredFields.forEach(field => {
        assert.ok(
          field in agent!,
          `Agent missing required field: ${field}`
        );
      });
    });

    it('should validate output_contract structure', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      config.agents.forEach(agent => {
        assert.ok(agent.output_contract.transcript);
        assert.ok(Array.isArray(agent.output_contract.artifacts));
      });
    });
  });

  describe('agent content validation', () => {
    it('should have non-empty purpose for all agents', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      config.agents.forEach(agent => {
        assert.ok(agent.purpose.length > 0, `Agent ${agent.name} has empty purpose`);
      });
    });

    it('should have at least one scope item for all agents', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      config.agents.forEach(agent => {
        assert.ok(agent.scope.length > 0, `Agent ${agent.name} has no scope items`);
      });
    });

    it('should have at least one refusal rule for all agents', () => {
      const loader = new ConfigLoader(configDir);
      const config = loader.loadDefaultAgents();

      config.agents.forEach(agent => {
        assert.ok(
          agent.refusal_rules.length > 0,
          `Agent ${agent.name} has no refusal rules (required for drift control)`
        );
      });
    });
  });
});

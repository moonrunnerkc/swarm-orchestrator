import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentsExporter, AgentStats, ExportOptions } from '../src/agents-exporter';
import { KnowledgeBase, KnowledgePattern } from '../src/knowledge-base';
import { AgentProfile } from '../src/config-loader';

// Stable agent fixture matching the base config structure
function makeAgent(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    name: 'worker',
    purpose: 'Implement server-side logic',
    scope: ['Backend code', 'API endpoints'],
    boundaries: ['Do not modify frontend'],
    done_definition: ['All API endpoints work'],
    refusal_rules: ['Do not invent database features'],
    output_contract: { transcript: 'proof/step-{N}-backend.md', artifacts: [] },
    ...overrides
  };
}

function makeKnowledgeBase(patterns: Partial<KnowledgePattern>[] = [], totalRuns = 1): KnowledgeBase {
  const now = new Date().toISOString();
  return {
    version: 1,
    lastUpdated: now,
    patterns: patterns.map((p, i) => ({
      id: `test-${i}`,
      category: p.category || 'agent_behavior',
      insight: p.insight || 'test insight',
      confidence: p.confidence || 'medium',
      evidence: p.evidence || [],
      occurrences: p.occurrences || 1,
      firstSeen: p.firstSeen || now,
      lastSeen: p.lastSeen || now,
      impact: p.impact || 'medium',
      examples: p.examples || []
    })),
    statistics: {
      totalRuns,
      totalPatterns: patterns.length,
      avgPatternsPerRun: patterns.length / (totalRuns || 1)
    }
  };
}

describe('AgentsExporter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-export-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateAgentMd', () => {
    it('should generate valid frontmatter and sections for base agent', () => {
      const exporter = new AgentsExporter(tempDir);
      const agent = makeAgent();
      const content = exporter.generateAgentMd(agent, undefined, false, 0);

      assert.ok(content.startsWith('---\n'), 'should start with YAML frontmatter');
      assert.ok(content.includes('name: worker'));
      assert.ok(content.includes('## Purpose'));
      assert.ok(content.includes('## Scope'));
      assert.ok(content.includes('## Boundaries'));
      assert.ok(content.includes('## Done Definition'));
      assert.ok(content.includes('## Refusal Rules'));
    });

    it('should include data notice when insufficient runs', () => {
      const exporter = new AgentsExporter(tempDir);
      const content = exporter.generateAgentMd(makeAgent(), undefined, false, 2);

      assert.ok(content.includes('Only 2 run(s) recorded'));
    });

    it('should omit data notice when fromData is true', () => {
      const exporter = new AgentsExporter(tempDir);
      const content = exporter.generateAgentMd(makeAgent(), undefined, true, 10);

      assert.ok(!content.includes('Only'));
    });

    it('should include failure prevention section when stats have failure modes', () => {
      const exporter = new AgentsExporter(tempDir);
      const stats: AgentStats = {
        agentName: 'worker',
        totalMentions: 5,
        failureModes: ['Timeout when database migrations run concurrently'],
        successPatterns: [],
        toolGuidance: [],
        scopePatterns: [],
        boundaryViolations: [],
        avgDurationHint: undefined,
        costHint: undefined
      };
      const content = exporter.generateAgentMd(makeAgent(), stats, true, 10);

      assert.ok(content.includes('## Failure Prevention (Learned)'));
      assert.ok(content.includes('Timeout when database migrations'));
    });

    it('should include proven patterns section', () => {
      const exporter = new AgentsExporter(tempDir);
      const stats: AgentStats = {
        agentName: 'worker',
        totalMentions: 3,
        failureModes: [],
        successPatterns: ['Mock database calls for unit tests'],
        toolGuidance: [],
        scopePatterns: [],
        boundaryViolations: [],
        avgDurationHint: undefined,
        costHint: undefined
      };
      const content = exporter.generateAgentMd(makeAgent(), stats, true, 10);

      assert.ok(content.includes('## Proven Patterns'));
      assert.ok(content.includes('Mock database calls'));
    });

    it('should skip learned sections when totalMentions is 0', () => {
      const exporter = new AgentsExporter(tempDir);
      const stats: AgentStats = {
        agentName: 'worker',
        totalMentions: 0,
        failureModes: ['something'],
        successPatterns: [],
        toolGuidance: [],
        scopePatterns: [],
        boundaryViolations: [],
        avgDurationHint: undefined,
        costHint: undefined
      };
      const content = exporter.generateAgentMd(makeAgent(), stats, true, 10);

      assert.ok(!content.includes('## Failure Prevention'));
    });

    it('should include anti-patterns section when boundary violations exist', () => {
      const exporter = new AgentsExporter(tempDir);
      const stats: AgentStats = {
        agentName: 'worker',
        totalMentions: 2,
        failureModes: [],
        successPatterns: [],
        toolGuidance: [],
        scopePatterns: [],
        boundaryViolations: ['Modified frontend CSS files directly'],
        avgDurationHint: undefined,
        costHint: undefined
      };
      const content = exporter.generateAgentMd(makeAgent(), stats, true, 10);

      assert.ok(content.includes('## Anti-Patterns (Do Not Repeat)'));
      assert.ok(content.includes('Modified frontend CSS'));
    });

    it('should include cost hints when available', () => {
      const exporter = new AgentsExporter(tempDir);
      const stats: AgentStats = {
        agentName: 'worker',
        totalMentions: 1,
        failureModes: [],
        successPatterns: [],
        toolGuidance: [],
        scopePatterns: [],
        boundaryViolations: [],
        avgDurationHint: undefined,
        costHint: '3 premium requests typical for API tasks'
      };
      const content = exporter.generateAgentMd(makeAgent(), stats, true, 10);

      assert.ok(content.includes('## Performance Notes'));
      assert.ok(content.includes('3 premium requests'));
    });
  });

  describe('computeRecencyWeight', () => {
    it('should return 1.0 for patterns seen right now', () => {
      const exporter = new AgentsExporter(tempDir);
      const now = Date.now();
      const weight = exporter.computeRecencyWeight(new Date(now).toISOString(), now);
      assert.ok(Math.abs(weight - 1.0) < 0.01, `Expected ~1.0, got ${weight}`);
    });

    it('should return ~0.5 for patterns 30 days old', () => {
      const exporter = new AgentsExporter(tempDir);
      const now = Date.now();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const weight = exporter.computeRecencyWeight(thirtyDaysAgo, now);
      assert.ok(Math.abs(weight - 0.5) < 0.05, `Expected ~0.5, got ${weight}`);
    });

    it('should return ~0.25 for patterns 60 days old', () => {
      const exporter = new AgentsExporter(tempDir);
      const now = Date.now();
      const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
      const weight = exporter.computeRecencyWeight(sixtyDaysAgo, now);
      assert.ok(Math.abs(weight - 0.25) < 0.05, `Expected ~0.25, got ${weight}`);
    });

    it('should return 0.5 for invalid dates', () => {
      const exporter = new AgentsExporter(tempDir);
      const weight = exporter.computeRecencyWeight('not-a-date', Date.now());
      assert.strictEqual(weight, 0.5);
    });
  });

  describe('aggregatePerAgent', () => {
    it('should aggregate failure modes for matching agent', () => {
      const exporter = new AgentsExporter(tempDir);
      const agents = [makeAgent()];
      const bases = [makeKnowledgeBase([
        {
          category: 'failure_mode',
          insight: 'worker fails when running parallel DB migrations',
          evidence: ['run:exec-123']
        }
      ], 5)];

      const stats = exporter.aggregatePerAgent(bases, agents);
      const agentStats = stats.get('worker');
      assert.ok(agentStats);
      assert.strictEqual(agentStats.failureModes.length, 1);
      assert.ok(agentStats.failureModes[0].includes('parallel DB migrations'));
    });

    it('should aggregate best practices as success patterns', () => {
      const exporter = new AgentsExporter(tempDir);
      const agents = [makeAgent()];
      const bases = [makeKnowledgeBase([
        {
          category: 'best_practice',
          insight: 'worker succeeds when using mocks for DB calls',
          evidence: []
        }
      ], 5)];

      const stats = exporter.aggregatePerAgent(bases, agents);
      const agentStats = stats.get('worker');
      assert.ok(agentStats);
      assert.strictEqual(agentStats.successPatterns.length, 1);
    });

    it('should skip patterns for unrelated agents', () => {
      const exporter = new AgentsExporter(tempDir);
      const agents = [makeAgent()];
      const bases = [makeKnowledgeBase([
        {
          category: 'failure_mode',
          insight: 'reviewer fails when fixtures are missing',
          evidence: []
        }
      ], 5)];

      const stats = exporter.aggregatePerAgent(bases, agents);
      const agentStats = stats.get('worker');
      assert.ok(agentStats);
      assert.strictEqual(agentStats.failureModes.length, 0);
    });

    it('should skip very old patterns (weight < 0.1)', () => {
      const exporter = new AgentsExporter(tempDir);
      const agents = [makeAgent()];
      const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const bases = [makeKnowledgeBase([
        {
          category: 'failure_mode',
          insight: 'worker timeout',
          evidence: [],
          lastSeen: veryOld
        }
      ], 5)];

      const stats = exporter.aggregatePerAgent(bases, agents);
      const agentStats = stats.get('worker');
      assert.ok(agentStats);
      assert.strictEqual(agentStats.failureModes.length, 0);
    });

    it('should classify anti_pattern as boundary violations', () => {
      const exporter = new AgentsExporter(tempDir);
      const agents = [makeAgent()];
      const bases = [makeKnowledgeBase([
        {
          category: 'anti_pattern',
          insight: 'worker modified CSS files directly',
          evidence: []
        }
      ], 5)];

      const stats = exporter.aggregatePerAgent(bases, agents);
      const agentStats = stats.get('worker');
      assert.ok(agentStats);
      assert.strictEqual(agentStats.boundaryViolations.length, 1);
    });
  });

  describe('loadAllKnowledgeBases', () => {
    it('should return empty array when runs directory does not exist', () => {
      const exporter = new AgentsExporter(path.join(tempDir, 'nonexistent'));
      const bases = exporter.loadAllKnowledgeBases();
      assert.deepStrictEqual(bases, []);
    });

    it('should load knowledge bases from run subdirectories', () => {
      const runsDir = path.join(tempDir, 'runs');
      const runDir = path.join(runsDir, 'exec-2025-01-01');
      fs.mkdirSync(runDir, { recursive: true });

      const kb = makeKnowledgeBase([], 3);
      fs.writeFileSync(path.join(runDir, 'knowledge-base.json'), JSON.stringify(kb));

      const exporter = new AgentsExporter(tempDir);
      const bases = exporter.loadAllKnowledgeBases();
      assert.strictEqual(bases.length, 1);
      assert.strictEqual(bases[0].statistics.totalRuns, 3);
    });

    it('should skip malformed JSON files', () => {
      const runsDir = path.join(tempDir, 'runs');
      const runDir = path.join(runsDir, 'exec-bad');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'knowledge-base.json'), 'not json');

      const exporter = new AgentsExporter(tempDir);
      const bases = exporter.loadAllKnowledgeBases();
      assert.strictEqual(bases.length, 0);
    });
  });

  describe('computeDiff', () => {
    it('should return empty diffs when content is identical', () => {
      const exporter = new AgentsExporter(tempDir);
      const content = '## Purpose\n\nBuild APIs.\n\n## Scope\n\n- Backend code\n';
      const diffs = exporter.computeDiff('TestAgent', content, content);
      assert.strictEqual(diffs.length, 0);
    });

    it('should detect section changes', () => {
      const exporter = new AgentsExporter(tempDir);
      const prev = '## Purpose\n\nBuild APIs.\n\n## Scope\n\n- Backend\n';
      const curr = '## Purpose\n\nBuild APIs.\n\n## Scope\n\n- Backend\n- Frontend\n';
      const diffs = exporter.computeDiff('TestAgent', prev, curr);
      assert.ok(diffs.length > 0);
      const scopeDiff = diffs.find(d => d.field === 'Scope');
      assert.ok(scopeDiff, 'Should detect diff in Scope section');
    });

    it('should detect new sections', () => {
      const exporter = new AgentsExporter(tempDir);
      const prev = '## Purpose\n\nBuild stuff.\n';
      const curr = '## Purpose\n\nBuild stuff.\n\n## Failure Prevention (Learned)\n\n- Avoid X\n';
      const diffs = exporter.computeDiff('TestAgent', prev, curr);
      const newSection = diffs.find(d => d.field === 'Failure Prevention (Learned)');
      assert.ok(newSection, 'Should detect the new section');
      assert.strictEqual(newSection.previous, '');
    });
  });

  describe('export (integration)', () => {
    it('should generate agent files in the output directory', () => {
      const outputDir = path.join(tempDir, 'exported-agents');
      const exporter = new AgentsExporter(tempDir);
      const result = exporter.export({
        outputDir,
        minRuns: 5,
        diff: false
      });

      assert.ok(result.agentsExported.length > 0, 'Should export at least one agent');
      assert.strictEqual(result.fromData, false, 'No runs, should be from base config');
      assert.strictEqual(result.outputDir, outputDir);

      // Verify files were created
      for (const agentName of result.agentsExported) {
        const filename = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.agent.md';
        const filePath = path.join(outputDir, filename);
        assert.ok(fs.existsSync(filePath), `Agent file should exist: ${filename}`);

        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.startsWith('---\n'), 'Should have YAML frontmatter');
        assert.ok(content.includes(`name: ${agentName}`));
      }
    });

    it('should use data-driven export when enough runs exist', () => {
      // Create fake run with knowledge base
      const runsDir = path.join(tempDir, 'runs');
      for (let i = 0; i < 3; i++) {
        const runDir = path.join(runsDir, `exec-${i}`);
        fs.mkdirSync(runDir, { recursive: true });
        const kb = makeKnowledgeBase([
          {
            category: 'failure_mode',
            insight: 'worker timeout on large payloads',
            evidence: ['run:test']
          }
        ], 2);
        fs.writeFileSync(path.join(runDir, 'knowledge-base.json'), JSON.stringify(kb));
      }

      const outputDir = path.join(tempDir, 'exported');
      const exporter = new AgentsExporter(tempDir);
      const result = exporter.export({
        outputDir,
        minRuns: 5,
        diff: false
      });

      // 3 runs * 2 totalRuns each = 6, which exceeds minRuns=5
      assert.strictEqual(result.fromData, true, 'Should be data-driven with 6 runs');
    });

    it('should compute diffs when --diff is enabled and previous export exists', () => {
      const outputDir = path.join(tempDir, 'export-diff');
      const exporter = new AgentsExporter(tempDir);

      // First export (no diffs since no previous)
      const first = exporter.export({ outputDir, minRuns: 999, diff: true });
      assert.strictEqual(first.diffs.length, 0);

      // Create run data so the second export adds learned sections
      const runsDir = path.join(tempDir, 'runs');
      for (let i = 0; i < 6; i++) {
        const runDir = path.join(runsDir, `exec-${i}`);
        fs.mkdirSync(runDir, { recursive: true });
        const kb = makeKnowledgeBase([
          {
            category: 'best_practice',
            insight: 'worker: use mocks for DB calls',
            evidence: ['run:proven']
          }
        ], 1);
        fs.writeFileSync(path.join(runDir, 'knowledge-base.json'), JSON.stringify(kb));
      }

      // Second export with diff (minRuns=5, totalRuns=6 so fromData=true)
      const second = exporter.export({ outputDir, minRuns: 5, diff: true });
      assert.ok(second.fromData);
      // The worker agent should have diffs since learned sections were added
      const backendDiffs = second.diffs.filter(d => d.agentName === 'worker');
      assert.ok(backendDiffs.length > 0, 'Should detect changes in worker after adding data');
    });
  });
});

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { McpServer } from '../src/mcp-server';

describe('McpServer', () => {
  let tmpDir: string;
  let server: McpServer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-server-test-'));
    server = new McpServer(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Message extraction
  // -----------------------------------------------------------------------

  describe('extractMessages', () => {
    it('extracts newline-delimited JSON messages', () => {
      const buffer = '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n';
      const result = server.extractMessages(buffer);
      assert.strictEqual(result.complete.length, 2);
      assert.strictEqual(result.remaining, '');
    });

    it('keeps incomplete messages in remaining buffer', () => {
      const buffer = '{"jsonrpc":"2.0","id":1,"method":"init';
      const result = server.extractMessages(buffer);
      assert.strictEqual(result.complete.length, 0);
      assert.strictEqual(result.remaining, buffer);
    });

    it('extracts Content-Length framed messages', () => {
      const body = '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
      const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
      const result = server.extractMessages(frame);
      assert.strictEqual(result.complete.length, 1);
      assert.strictEqual(result.complete[0], body);
    });

    it('handles empty buffer', () => {
      const result = server.extractMessages('');
      assert.strictEqual(result.complete.length, 0);
      assert.strictEqual(result.remaining, '');
    });
  });

  // -----------------------------------------------------------------------
  // Protocol handlers
  // -----------------------------------------------------------------------

  describe('handleRequest', () => {
    it('responds to initialize with server info', () => {
      const response = server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      });
      assert.ok(!(response instanceof Promise));
      const result = (response as unknown as { result: Record<string, unknown> }).result;
      assert.strictEqual(result.protocolVersion, '2024-11-05');
      const info = result.serverInfo as { name: string; version: string };
      assert.strictEqual(info.name, 'swarm-orchestrator');
    });

    it('returns method-not-found for unknown methods', () => {
      const response = server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'nonexistent/method'
      });
      assert.ok(!(response instanceof Promise));
      const typed = response as { error: { code: number; message: string } };
      assert.strictEqual(typed.error.code, -32601);
    });

    it('handles notifications/initialized without error', () => {
      const response = server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'notifications/initialized'
      });
      // Notifications return null (no response sent back to client)
      assert.strictEqual(response, null);
    });
  });

  // -----------------------------------------------------------------------
  // Resources
  // -----------------------------------------------------------------------

  describe('resources/list', () => {
    it('returns resource templates', () => {
      const response = server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/list'
      });
      assert.ok(!(response instanceof Promise));
      const result = (response as { result: { resourceTemplates: unknown[] } }).result;
      assert.ok(Array.isArray(result.resourceTemplates));
      assert.ok(result.resourceTemplates.length >= 5);
    });
  });

  describe('resources/read', () => {
    it('returns empty runs list when no runs directory exists', () => {
      const response = server.handleResourcesRead(1, { uri: 'swarm://runs' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.strictEqual(data.total, 0);
      assert.deepStrictEqual(data.runs, []);
    });

    it('returns runs from the runs directory', () => {
      const runDir = path.join(tmpDir, 'runs', 'exec-2025-01-15T00-00-00');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metrics.json'), '{}');

      const response = server.handleResourcesRead(1, { uri: 'swarm://runs' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.strictEqual(data.total, 1);
      assert.strictEqual(data.runs[0].id, 'exec-2025-01-15T00-00-00');
      assert.strictEqual(data.runs[0].hasMetrics, true);
    });

    it('returns run detail with metrics and plan', () => {
      const runDir = path.join(tmpDir, 'runs', 'exec-test');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metrics.json'), '{"totalTime": 5000}');
      fs.writeFileSync(path.join(runDir, 'plan.json'), '{"steps": []}');

      const response = server.handleResourcesRead(1, { uri: 'swarm://runs/exec-test' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.strictEqual(data.id, 'exec-test');
      assert.deepStrictEqual(data.metrics, { totalTime: 5000 });
      assert.deepStrictEqual(data.plan, { steps: [] });
    });

    it('returns error for missing run', () => {
      const response = server.handleResourcesRead(1, { uri: 'swarm://runs/nonexistent' });
      assert.ok(response.error);
      assert.ok(response.error.message.includes('nonexistent'));
    });

    it('returns step detail with transcript and evidence', () => {
      const stepDir = path.join(tmpDir, 'runs', 'exec-test', 'steps', 'step-1');
      fs.mkdirSync(stepDir, { recursive: true });
      fs.writeFileSync(path.join(stepDir, 'share.md'), '# Step 1 transcript');

      const evidenceDir = path.join(tmpDir, 'runs', 'exec-test', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'step-1.jsonl'),
        '{"event":"test_pass","file":"test.ts"}\n{"event":"build_ok","file":"src/main.ts"}\n'
      );

      const response = server.handleResourcesRead(1, { uri: 'swarm://runs/exec-test/steps/1' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.strictEqual(data.stepNumber, 1);
      assert.strictEqual(data.transcript, '# Step 1 transcript');
      assert.strictEqual(data.evidence.length, 2);
      assert.strictEqual(data.evidence[0].event, 'test_pass');
    });

    it('returns error for missing step', () => {
      const runDir = path.join(tmpDir, 'runs', 'exec-test');
      fs.mkdirSync(runDir, { recursive: true });

      const response = server.handleResourcesRead(1, { uri: 'swarm://runs/exec-test/steps/99' });
      assert.ok(response.error);
      assert.ok(response.error.message.includes('step=99'));
    });

    it('returns agents from config loader', () => {
      // Uses default ConfigLoader that reads from config/ directory.
      // Result is an array of agents (may be empty or populated depending on config presence).
      const response = server.handleResourcesRead(1, { uri: 'swarm://agents' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.ok(Array.isArray(data.agents));
    });

    it('returns knowledge base data', () => {
      // Create a minimal knowledge base file
      const kb = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        patterns: [],
        statistics: { totalRuns: 0, totalPatterns: 0, avgPatternsPerRun: 0 }
      };
      fs.writeFileSync(path.join(tmpDir, 'knowledge-base.json'), JSON.stringify(kb));

      const response = server.handleResourcesRead(1, { uri: 'swarm://knowledge' });
      const result = response.result as { contents: { text: string }[] };
      const data = JSON.parse(result.contents[0].text);
      assert.strictEqual(data.version, 1);
      assert.deepStrictEqual(data.patterns, []);
    });

    it('returns error for unknown URI', () => {
      const response = server.handleResourcesRead(1, { uri: 'swarm://nonexistent' });
      assert.ok(response.error);
      assert.ok(response.error.message.includes('Unknown resource URI'));
    });

    it('returns error when uri is missing', () => {
      const response = server.handleResourcesRead(1, undefined);
      assert.ok(response.error);
      assert.strictEqual(response.error.code, -32602);
    });
  });

  // -----------------------------------------------------------------------
  // Tools
  // -----------------------------------------------------------------------

  describe('tools/list', () => {
    it('returns available tools', () => {
      const response = server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      });
      assert.ok(!(response instanceof Promise));
      const result = (response as { result: { tools: { name: string }[] } }).result;
      const names = result.tools.map((t: { name: string }) => t.name);
      assert.ok(names.includes('swarm_status'));
      assert.ok(names.includes('swarm_plan'));
      assert.ok(names.includes('swarm_gates'));
      assert.ok(names.includes('swarm_export_agents'));
      assert.ok(names.includes('swarm_cost'));
    });
  });

  describe('tools/call', () => {
    it('returns status with run count and knowledge stats', () => {
      // Create a run directory
      fs.mkdirSync(path.join(tmpDir, 'runs', 'exec-test'), { recursive: true });
      // Create a minimal KB
      fs.writeFileSync(path.join(tmpDir, 'knowledge-base.json'), JSON.stringify({
        version: 1, lastUpdated: new Date().toISOString(),
        patterns: [], statistics: { totalRuns: 3, totalPatterns: 7, avgPatternsPerRun: 2.3 }
      }));

      const response = server.handleToolsCall(1, { name: 'swarm_status' });
      assert.ok(!(response instanceof Promise));
      const result = (response as { result: { content: { text: string }[] } }).result;
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.status, 'ready');
      assert.strictEqual(data.totalRuns, 1);
      assert.strictEqual(data.knowledgeBase.totalRuns, 3);
    });

    it('returns error for unknown tool', () => {
      const response = server.handleToolsCall(1, { name: 'nonexistent_tool' });
      assert.ok(!(response instanceof Promise));
      const typed = response as { error: { code: number; message: string } };
      assert.strictEqual(typed.error.code, -32602);
    });

    it('returns error when tool name is missing', () => {
      const response = server.handleToolsCall(1, undefined);
      assert.ok(!(response instanceof Promise));
      const typed = response as { error: { code: number; message: string } };
      assert.strictEqual(typed.error.code, -32602);
    });

    it('returns actual cost for a completed run', () => {
      const runDir = path.join(tmpDir, 'runs', 'exec-cost');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, 'cost-attribution.json'),
        JSON.stringify({ totalActualPremiumRequests: 7 }),
        'utf8'
      );

      const response = server.handleToolsCall(1, {
        name: 'swarm_cost',
        arguments: { runId: 'exec-cost' }
      });
      assert.ok(!(response instanceof Promise));
      const result = (response as { result: { content: { text: string }[] } }).result;
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.mode, 'actual');
      assert.strictEqual(data.cost.totalActualPremiumRequests, 7);
    });

    it('returns a cost estimate for a goal', () => {
      const response = server.handleToolsCall(1, {
        name: 'swarm_cost',
        arguments: { goal: 'build a CLI tool' }
      });
      assert.ok(!(response instanceof Promise));
      const result = (response as { result: { content: { text: string }[] } }).result;
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.mode, 'estimate');
      assert.strictEqual(typeof data.estimate.totalPremiumRequests, 'number');
      assert.ok(Array.isArray(data.plan.steps));
    });
  });

  // -----------------------------------------------------------------------
  // sendResponse framing
  // -----------------------------------------------------------------------

  describe('sendResponse', () => {
    it('frames response with Content-Length header', () => {
      const written: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => {
        written.push(chunk);
        return true;
      }) as typeof process.stdout.write;

      try {
        server.sendResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
        const output = written.join('');
        assert.ok(output.startsWith('Content-Length: '));
        assert.ok(output.includes('\r\n\r\n'));
        const body = output.split('\r\n\r\n')[1];
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.id, 1);
        assert.strictEqual(parsed.result.ok, true);
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  // -----------------------------------------------------------------------
  // readRunsList (direct call for coverage)
  // -----------------------------------------------------------------------

  describe('readRunsList', () => {
    it('handles runs directory with non-directory entries', () => {
      const runsDir = path.join(tmpDir, 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      // Add a file (not a directory) in runs/
      fs.writeFileSync(path.join(runsDir, 'readme.txt'), 'ignore me');
      // Add a real run directory
      fs.mkdirSync(path.join(runsDir, 'exec-run-1'));

      const content = server.readRunsList();
      const data = JSON.parse(content.text);
      assert.strictEqual(data.total, 1);
      assert.strictEqual(data.runs[0].id, 'exec-run-1');
    });
  });

  // -----------------------------------------------------------------------
  // readAgents (direct call for coverage)
  // -----------------------------------------------------------------------

  describe('readAgents', () => {
    it('returns agents as JSON', () => {
      const content = server.readAgents();
      const data = JSON.parse(content.text);
      assert.ok(Array.isArray(data.agents));
      assert.strictEqual(content.mimeType, 'application/json');
      assert.strictEqual(content.uri, 'swarm://agents');
    });
  });
});

// MCP (Model Context Protocol) server for orchestrator status and control.
// Implements JSON-RPC 2.0 over stdio, exposing the orchestrator's runs,
// agents, knowledge base, and quality gates as MCP resources and tools.
// No external MCP SDK required; uses the raw protocol directly.

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ConfigLoader, AgentProfile } from './config-loader';
import { KnowledgeBaseManager } from './knowledge-base';
import { PlanStorage } from './plan-storage';
import AgentsExporter from './agents-exporter';
import { defaultModelForAdapter } from './adapters';

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP protocol types
// ---------------------------------------------------------------------------

interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/**
 * Lightweight MCP server that reads orchestrator state from the filesystem
 * (runs/, plans/, knowledge-base.json) and serves it via JSON-RPC over stdio.
 * Tools let clients trigger plan generation, gate checks, and agent export.
 */
export class McpServer {
  private workingDir: string;
  private configLoader: ConfigLoader;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.cwd();
    this.configLoader = new ConfigLoader();
  }

  /**
   * Start the MCP server, reading JSON-RPC requests from stdin
   * and writing responses to stdout. Runs until stdin closes.
   */
  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    // MCP uses Content-Length framed messages in some transports,
    // but stdio transport typically uses newline-delimited JSON
    let buffer = '';

    process.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // Try to extract complete messages (newline-delimited or content-length)
      const messages = this.extractMessages(buffer);
      buffer = messages.remaining;

      for (const msg of messages.complete) {
        try {
          const request = JSON.parse(msg) as JsonRpcRequest;
          const response = this.handleRequest(request);
          if (response === null) {
            // Notification; no response required
          } else if (response instanceof Promise) {
            response.then(r => this.sendResponse(r));
          } else {
            this.sendResponse(response);
          }
        } catch {
          // Malformed JSON; send parse error
          this.sendResponse({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' }
          });
        }
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });
  }

  /**
   * Extract complete JSON messages from a buffer.
   * Handles both Content-Length framing and newline-delimited formats.
   */
  extractMessages(buffer: string): { complete: string[]; remaining: string } {
    const messages: string[] = [];

    // Content-Length framing (standard MCP stdio transport)
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Not a Content-Length frame; try newline delimited
        break;
      }

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;
      if (buffer.length < contentStart + contentLength) break; // incomplete

      messages.push(buffer.slice(contentStart, contentStart + contentLength));
      buffer = buffer.slice(contentStart + contentLength);
    }

    // Fallback: newline-delimited JSON
    if (messages.length === 0) {
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep last incomplete line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) messages.push(trimmed);
      }
      return { complete: messages, remaining: buffer };
    }

    return { complete: messages, remaining: buffer };
  }

  /**
   * Send a JSON-RPC response to stdout using Content-Length framing.
   */
  sendResponse(response: JsonRpcResponse): void {
    const body = JSON.stringify(response);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    process.stdout.write(header + body);
  }

  /**
   * Route a JSON-RPC request to the appropriate handler.
   * Returns null for notifications that require no response.
   */
  handleRequest(request: JsonRpcRequest): JsonRpcResponse | Promise<JsonRpcResponse> | null {
    const { id, method, params } = request;

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id);

      case 'resources/list':
        return this.handleResourcesList(id);

      case 'resources/read':
        return this.handleResourcesRead(id, params as { uri: string } | undefined);

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return this.handleToolsCall(id, params as { name: string; arguments?: Record<string, unknown> } | undefined);

      case 'notifications/initialized':
      case 'initialized':
      case 'notifications/cancelled':
        // Client notifications; MCP spec requires no response
        return null;

      default:
        // If there's no id, this is an unknown notification; don't respond
        if (id === undefined || id === null) return null;
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }
  }

  // -------------------------------------------------------------------------
  // Protocol handlers
  // -------------------------------------------------------------------------

  private handleInitialize(id: number | string): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          resources: { listChanged: false },
          tools: {}
        },
        serverInfo: {
          name: 'swarm-orchestrator',
          version: '3.2.0'
        }
      }
    };
  }

  private handleResourcesList(id: number | string): JsonRpcResponse {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'swarm://runs',
        name: 'Execution Runs',
        description: 'List of all swarm execution runs with status',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'swarm://runs/{id}',
        name: 'Run Detail',
        description: 'Detailed status of a specific execution run',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'swarm://runs/{id}/steps/{n}',
        name: 'Step Detail',
        description: 'Individual step detail with transcript and evidence',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'swarm://agents',
        name: 'Agent Profiles',
        description: 'Current agent profiles with configuration',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'swarm://knowledge',
        name: 'Knowledge Base',
        description: 'Aggregated knowledge base from execution history',
        mimeType: 'application/json'
      }
    ];

    return { jsonrpc: '2.0', id, result: { resourceTemplates: templates } };
  }

  handleResourcesRead(
    id: number | string,
    params?: { uri: string }
  ): JsonRpcResponse {
    if (!params?.uri) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required parameter: uri' }
      };
    }

    const uri = params.uri;

    try {
      let content: McpResourceContent;

      if (uri === 'swarm://runs') {
        content = this.readRunsList();
      } else if (uri === 'swarm://agents') {
        content = this.readAgents();
      } else if (uri === 'swarm://knowledge') {
        content = this.readKnowledge();
      } else if (uri.match(/^swarm:\/\/runs\/([^/]+)\/steps\/(\d+)$/)) {
        const match = uri.match(/^swarm:\/\/runs\/([^/]+)\/steps\/(\d+)$/);
        content = this.readStepDetail(match![1], parseInt(match![2], 10));
      } else if (uri.match(/^swarm:\/\/runs\/([^/]+)$/)) {
        const match = uri.match(/^swarm:\/\/runs\/([^/]+)$/);
        content = this.readRunDetail(match![1]);
      } else {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown resource URI: ${uri}` }
        };
      }

      return { jsonrpc: '2.0', id, result: { contents: [content] } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Failed to read resource: ${message}` }
      };
    }
  }

  private handleToolsList(id: number | string): JsonRpcResponse {
    const tools: McpTool[] = [
      {
        name: 'swarm_status',
        description: 'Get current orchestrator status and recent run summary',
        inputSchema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'swarm_plan',
        description: 'Generate an execution plan for a goal',
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'The goal to plan for' }
          },
          required: ['goal']
        }
      },
      {
        name: 'swarm_gates',
        description: 'Run quality gates on a path',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to analyze (default: cwd)' }
          },
          required: []
        }
      },
      {
        name: 'swarm_export_agents',
        description: 'Export agents as .agent.md files from execution history',
        inputSchema: {
          type: 'object',
          properties: {
            outputDir: { type: 'string', description: 'Output directory for agent files' },
            minRuns: { type: 'number', description: 'Minimum runs for data-driven export (default: 5)' }
          },
          required: []
        }
      },
      {
        name: 'swarm_cost',
        description: 'Estimate cost for a goal or read actual cost for a completed run',
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'Goal to estimate cost for' },
            runId: { type: 'string', description: 'Completed run ID to read actual cost from' },
            model: { type: 'string', description: 'Model name for estimates (default: adapter default)' }
          },
          required: []
        }
      }
    ];

    return { jsonrpc: '2.0', id, result: { tools } };
  }

  handleToolsCall(
    id: number | string,
    params?: { name: string; arguments?: Record<string, unknown> }
  ): JsonRpcResponse | Promise<JsonRpcResponse> {
    if (!params?.name) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required parameter: name' }
      };
    }

    try {
      switch (params.name) {
        case 'swarm_status':
          return this.toolStatus(id);

        case 'swarm_plan':
          return this.toolPlan(id, params.arguments as { goal: string } | undefined);

        case 'swarm_gates':
          return this.toolGates(id, params.arguments as { path?: string } | undefined);

        case 'swarm_export_agents':
          return this.toolExportAgents(id, params.arguments as { outputDir?: string; minRuns?: number } | undefined);

        case 'swarm_cost':
          return this.toolCost(id, params.arguments as { goal?: string; runId?: string; model?: string } | undefined);

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${params.name}` }
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Tool execution failed: ${message}` }
      };
    }
  }

  // -------------------------------------------------------------------------
  // Resource readers
  // -------------------------------------------------------------------------

  readRunsList(): McpResourceContent {
    const runsDir = path.join(this.workingDir, 'runs');
    const runs: { id: string; timestamp: string; hasMetrics: boolean }[] = [];

    if (fs.existsSync(runsDir)) {
      const entries = fs.readdirSync(runsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metricsPath = path.join(runsDir, entry.name, 'metrics.json');
        runs.push({
          id: entry.name,
          timestamp: entry.name.replace(/^exec-/, ''),
          hasMetrics: fs.existsSync(metricsPath)
        });
      }
    }

    return {
      uri: 'swarm://runs',
      mimeType: 'application/json',
      text: JSON.stringify({ runs, total: runs.length })
    };
  }

  private readRunDetail(runId: string): McpResourceContent {
    const runDir = path.join(this.workingDir, 'runs', runId);
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run not found: ${runId}`);
    }

    const detail: Record<string, unknown> = { id: runId };

    // Read metrics if available
    const metricsPath = path.join(runDir, 'metrics.json');
    if (fs.existsSync(metricsPath)) {
      detail.metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    }

    // Read plan if available
    const planPath = path.join(runDir, 'plan.json');
    if (fs.existsSync(planPath)) {
      detail.plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    }

    // List step directories
    const stepsDir = path.join(runDir, 'steps');
    if (fs.existsSync(stepsDir)) {
      const stepEntries = fs.readdirSync(stepsDir, { withFileTypes: true });
      detail.steps = stepEntries
        .filter(e => e.isDirectory())
        .map(e => e.name);
    }

    // Read knowledge base if available
    const kbPath = path.join(runDir, 'knowledge-base.json');
    if (fs.existsSync(kbPath)) {
      detail.hasKnowledgeBase = true;
    }

    return {
      uri: `swarm://runs/${runId}`,
      mimeType: 'application/json',
      text: JSON.stringify(detail)
    };
  }

  private readStepDetail(runId: string, stepNumber: number): McpResourceContent {
    const stepDir = path.join(this.workingDir, 'runs', runId, 'steps', `step-${stepNumber}`);
    if (!fs.existsSync(stepDir)) {
      throw new Error(`Step not found: run=${runId}, step=${stepNumber}`);
    }

    const detail: Record<string, unknown> = { runId, stepNumber };

    // Read transcript
    const transcriptPath = path.join(stepDir, 'share.md');
    if (fs.existsSync(transcriptPath)) {
      detail.transcript = fs.readFileSync(transcriptPath, 'utf8');
    }

    // Read evidence log
    const evidenceDir = path.join(
      this.workingDir, 'runs', runId, 'evidence'
    );
    const evidencePath = path.join(evidenceDir, `step-${stepNumber}.jsonl`);
    if (fs.existsSync(evidencePath)) {
      detail.evidence = fs.readFileSync(evidencePath, 'utf8')
        .trim()
        .split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return l; } });
    }

    // Read verification report
    const verifyDir = path.join(this.workingDir, 'runs', runId, 'verification');
    const verifyPath = path.join(verifyDir, `step-${stepNumber}-verification.md`);
    if (fs.existsSync(verifyPath)) {
      detail.verification = fs.readFileSync(verifyPath, 'utf8');
    }

    return {
      uri: `swarm://runs/${runId}/steps/${stepNumber}`,
      mimeType: 'application/json',
      text: JSON.stringify(detail)
    };
  }

  readAgents(): McpResourceContent {
    const agents = this.configLoader.loadAllAgents();
    const agentSummaries = agents.map((a: AgentProfile) => ({
      name: a.name,
      purpose: a.purpose,
      scope: a.scope,
      boundaries: a.boundaries
    }));

    return {
      uri: 'swarm://agents',
      mimeType: 'application/json',
      text: JSON.stringify({ agents: agentSummaries })
    };
  }

  private readKnowledge(): McpResourceContent {
    const kb = new KnowledgeBaseManager(this.workingDir);
    const data = kb.export();

    return {
      uri: 'swarm://knowledge',
      mimeType: 'application/json',
      text: JSON.stringify(data)
    };
  }

  // -------------------------------------------------------------------------
  // Tool implementations
  // -------------------------------------------------------------------------

  private toolStatus(id: number | string): JsonRpcResponse {
    const runsDir = path.join(this.workingDir, 'runs');
    let runCount = 0;
    let latestRun = '';

    if (fs.existsSync(runsDir)) {
      const entries = fs.readdirSync(runsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
      runCount = entries.length;
      latestRun = entries[entries.length - 1] || '';
    }

    const kb = new KnowledgeBaseManager(this.workingDir);
    const stats = kb.getStatistics();

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'ready',
            workingDir: this.workingDir,
            totalRuns: runCount,
            latestRun,
            knowledgeBase: stats
          })
        }]
      }
    };
  }

  private toolPlan(
    id: number | string,
    args?: { goal: string }
  ): JsonRpcResponse {
    if (!args?.goal) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required argument: goal' }
      };
    }

    const agents = this.configLoader.loadAllAgents();
    const { PlanGenerator } = require('./plan-generator');
    const generator = new PlanGenerator(agents);
    const plan = generator.createPlan(args.goal);

    const storage = new PlanStorage();
    const filename = storage.savePlan(plan);

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            planFile: filename,
            steps: plan.steps.length,
            goal: args.goal,
            plan
          })
        }]
      }
    };
  }

  private async toolGates(
    id: number | string,
    args?: { path?: string }
  ): Promise<JsonRpcResponse> {
    const targetPath = args?.path || this.workingDir;
    const { load_quality_gates_config, run_quality_gates } = require('./quality-gates');
    const gatesConfig = load_quality_gates_config(this.workingDir);
    const results = await run_quality_gates(targetPath, gatesConfig, this.workingDir);

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify(results)
        }]
      }
    };
  }

  private toolExportAgents(
    id: number | string,
    args?: { outputDir?: string; minRuns?: number }
  ): JsonRpcResponse {
    const outputDir = args?.outputDir || path.join(this.workingDir, 'agents');
    const minRuns = args?.minRuns || 5;

    const exporter = new AgentsExporter(this.workingDir);
    const result = exporter.export({ outputDir, minRuns, diff: false });

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            agentsExported: result.agentsExported,
            outputDir: result.outputDir,
            fromData: result.fromData
          })
        }]
      }
    };
  }

  private toolCost(
    id: number | string,
    args?: { goal?: string; runId?: string; model?: string }
  ): JsonRpcResponse {
    if (args?.runId) {
      const runDir = path.join(this.workingDir, 'runs', args.runId);
      if (!fs.existsSync(runDir)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Run not found: ${args.runId}` }
        };
      }

      const costPath = path.join(runDir, 'cost-attribution.json');
      if (!fs.existsSync(costPath)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `No cost attribution found for run: ${args.runId}` }
        };
      }

      const cost = JSON.parse(fs.readFileSync(costPath, 'utf8'));
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              mode: 'actual',
              runId: args.runId,
              cost,
            })
          }]
        }
      };
    }

    if (!args?.goal) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required argument: goal or runId' }
      };
    }

    const agents = this.configLoader.loadAllAgents();
    const { PlanGenerator } = require('./plan-generator');
    const { CostEstimator } = require('./cost-estimator');
    const generator = new PlanGenerator(agents);
    const plan = generator.createPlan(args.goal);
    const estimator = new CostEstimator();
    const modelName = args.model || defaultModelForAdapter('copilot');
    const estimate = estimator.estimate(plan, { modelName });

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mode: 'estimate',
            goal: args.goal,
            model: modelName,
            estimate,
            plan,
          })
        }]
      }
    };
  }
}

/**
 * Start the MCP server in stdio mode. Called from CLI via `swarm mcp-server`.
 */
export function startMcpServer(workingDir?: string): void {
  const server = new McpServer(workingDir);
  server.start();
}

export default McpServer;

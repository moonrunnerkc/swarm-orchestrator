/**
 * Shared type definitions for the swarm conductor
 */

export interface ExecutionOptions {
  delegate?: boolean;      // Instruct agent to use /delegate for PR creation
  mcp?: boolean;           // Require MCP evidence from GitHub context
  enableExternal?: boolean; // Enable external tool execution (gh, vercel, netlify)
  dryRun?: boolean;        // Show commands without executing
  autoPR?: boolean;        // Auto-create PR after swarm completion
  strictIsolation?: boolean; // Force per-task branches + transcript-only context flow
  useInnerFleet?: boolean;   // Prefix prompts with /fleet for inner parallelism
  lean?: boolean;            // Delta context engine: reuse similar past tasks
  wrapFleet?: boolean;       // Enable /fleet prefix on all step prompts
  maxPremiumRequests?: number; // Abort if estimated premium requests exceed this
  maxRetries?: number;         // Maximum retry attempts for queued and repair retries
  costEstimateOnly?: boolean;  // Print cost estimate and exit without executing
  cliAgent?: string;           // CLI agent adapter: copilot, claude-code, codex
  prMode?: 'auto' | 'review'; // Create PRs instead of direct merge ('auto' or 'review')
  owaspReport?: boolean;       // Generate OWASP ASI compliance report after verification
}

export interface SessionState {
  sessionId: string;
  graph: { goal: string; steps: { stepNumber: number; task: string; agent: string }[] };
  branchMap: Record<string, string>;
  transcripts: Record<string, string>;
  metrics: Record<string, unknown>;
  gateResults: { id: string; title: string; status: string; issues: unknown[] }[];
  status: 'running' | 'paused' | 'completed' | 'failed';
  lastCompletedStep: number;
}

export interface MCPEvidence {
  found: boolean;
  section?: string;
  warnings: string[];
}

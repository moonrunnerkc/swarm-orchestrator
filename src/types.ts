/**
 * Shared type definitions for the swarm conductor
 */

// ExecutionOptions and MCPEvidence removed in complexity reduction (C7):
// both were exported but never imported anywhere in src/ or test/

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
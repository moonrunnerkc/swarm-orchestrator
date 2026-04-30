export type CorpusSource =
  | 'verification-run'
  | 'synthetic-adversarial'
  | 'curated-external';

export type AgentCli =
  | 'claude-code'
  | 'copilot'
  | 'claude-code-teams'
  | 'codex'
  | 'unknown';

export interface CorpusEntry {
  id: string;
  source: CorpusSource;
  goalText: string;
  repoPath: string;
  baseCommit: string;
  patchCommit: string;
  agentIdentity: {
    cli: AgentCli;
    model?: string;
  };
  transcriptPath: string;
  groundTruth: GroundTruthLabel;
  metadata: {
    capturedAt: string;
    runDir: string;
    stepNumber: number;
  };
}

export type UnlabeledCorpusEntry = Omit<CorpusEntry, 'groundTruth'>;

export interface GroundTruthLabel {
  verdict: 'clean' | 'broken' | 'ambiguous';
  rationale: string;
  brokenCategories?: BrokenCategory[];
  labeledBy: string;
  labeledAt: string;
  reviewedBy?: string;
}

export type BrokenCategory =
  | 'goal-not-fixed'
  | 'regression'
  | 'cheat-hardcoded-answer'
  | 'cheat-exception-swallowing'
  | 'cheat-test-modification'
  | 'cheat-mock-mutation'
  | 'edge-case-failure'
  | 'under-tested'
  | 'type-flow-defect'
  | 'concurrency-defect'
  | 'resource-leak';

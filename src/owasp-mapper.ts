import { VerificationResult } from './verifier-engine';

export interface ExecutionMetadata {
  executionId: string;
  toolVersion: string;
  strictIsolation: boolean;
  adapterType: string;
  totalSteps: number;
  passedSteps: number;
  repairedSteps: number;
  failedSteps: number;
  retriesExhausted: number;
}

export interface OwaspRiskAssessment {
  asiId: string;
  riskName: string;
  status: 'mitigated' | 'partial' | 'not_applicable';
  evidence: string[];
  rationale: string;
}

export interface OwaspComplianceReport {
  generatedAt: string;
  executionId: string;
  toolVersion: string;
  applicableRisks: number;
  mitigatedRisks: number;
  partialRisks: number;
  notApplicableRisks: number;
  risks: OwaspRiskAssessment[];
}

type StatusFn = (results: VerificationResult[], meta: ExecutionMetadata) => OwaspRiskAssessment;

const riskAssessors: StatusFn[] = [
  // ASI-01: Agent Goal Hijack
  (_results, meta) => ({
    asiId: 'ASI-01',
    riskName: 'Agent Goal Hijack',
    status: meta.strictIsolation ? 'mitigated' : 'partial',
    evidence: meta.strictIsolation
      ? ['Strict isolation enabled', 'Bounded worker and reviewer roles with refusal rules']
      : ['Worker and reviewer roles bounded by prompts; strict isolation not enabled'],
    rationale: meta.strictIsolation
      ? 'Strict isolation and bounded role prompts reduce goal-hijack blast radius.'
      : 'Role prompts bound agent scope, but strict isolation was not enabled for this run.'
  }),

  // ASI-02: Tool Misuse
  (_results, meta) => ({
    asiId: 'ASI-02',
    riskName: 'Tool Misuse',
    status: meta.strictIsolation ? 'mitigated' : 'partial',
    evidence: meta.strictIsolation
      ? ['Strict isolation enabled', 'Adapter interface restricts CLI flags', 'Cross-step context sharing blocked']
      : ['Adapter interface restricts CLI flags', 'Strict isolation not enabled; cross-step context may be shared'],
    rationale: meta.strictIsolation
      ? 'Strict isolation limits each agent to its own step context. Adapter interface restricts available CLI flags.'
      : 'Adapter interface restricts CLI flags, but strict isolation was not enabled. Agents may share cross-step context.'
  }),

  // ASI-03: Privilege Escalation (always mitigated; structural)
  () => ({
    asiId: 'ASI-03',
    riskName: 'Privilege Escalation',
    status: 'mitigated' as const,
    evidence: ['Each agent runs in its own git worktree and branch', 'No shared filesystem state between agents'],
    rationale: 'Branch isolation is structural. Each agent operates in a dedicated worktree with no shared filesystem state.'
  }),

  // ASI-04: Data Leakage (not applicable)
  () => ({
    asiId: 'ASI-04',
    riskName: 'Data Leakage',
    status: 'not_applicable' as const,
    evidence: [],
    rationale: 'Agents are stateless subprocesses on local branches with no external data access.'
  }),

  // ASI-05: Uncontrolled Code Execution
  (_results, meta) => {
    const allPassedClean = meta.repairedSteps === 0 && meta.failedSteps === 0 && meta.totalSteps > 0;
    return {
      asiId: 'ASI-05',
      riskName: 'Uncontrolled Code Execution',
      status: allPassedClean ? 'mitigated' : 'partial',
      evidence: allPassedClean
        ? [
            `All ${meta.passedSteps} steps passed verification (build, test, git diff)`,
            'No unverified merges occurred'
          ]
        : [
            `${meta.repairedSteps} step(s) required repair before passing`,
            `${meta.failedSteps} step(s) failed verification`,
            'Outcome verification gates blocked unverified merges'
          ],
      rationale: allPassedClean
        ? 'All steps passed outcome verification gates (build, test, git diff) on first attempt. No unverified code was merged.'
        : 'Outcome verification gates are in place, but some steps required repair or failed. Verification prevented uncontrolled merges.'
    };
  },

  // ASI-06: Knowledge Poisoning (not applicable)
  () => ({
    asiId: 'ASI-06',
    riskName: 'Knowledge Poisoning',
    status: 'not_applicable' as const,
    evidence: [],
    rationale: 'No persistent memory or RAG pipeline in agent sessions. Agents are stateless subprocesses.'
  }),

  // ASI-07: Insecure Communication (not applicable)
  () => ({
    asiId: 'ASI-07',
    riskName: 'Insecure Communication',
    status: 'not_applicable' as const,
    evidence: [],
    rationale: 'No inter-agent networking. Agents are isolated subprocesses with no direct communication channels.'
  }),

  // ASI-08: Cascading Failures
  (_results, meta) => ({
    asiId: 'ASI-08',
    riskName: 'Cascading Failures',
    status: meta.retriesExhausted === 0 ? 'mitigated' : 'partial',
    evidence: meta.retriesExhausted === 0
      ? [
          'Greedy scheduler with adaptive concurrency',
          'Failure classification in RepairAgent',
          'No steps exhausted retry limits'
        ]
      : [
          'Greedy scheduler with adaptive concurrency',
          `${meta.retriesExhausted} step(s) exhausted retry limits`,
          'Max retry limits prevented unbounded cascading'
        ],
    rationale: meta.retriesExhausted === 0
      ? 'Adaptive concurrency and failure classification contained all failures within retry limits.'
      : `${meta.retriesExhausted} step(s) exhausted retries. Max retry limits prevented unbounded cascading, but failures did propagate.`
  }),

  // ASI-09: Supply Chain (not applicable)
  () => ({
    asiId: 'ASI-09',
    riskName: 'Supply Chain',
    status: 'not_applicable' as const,
    evidence: [],
    rationale: 'Agents are first-party CLI tools invoked as subprocesses. No third-party plugins or agent marketplace in use.'
  }),

  // ASI-10: Rogue Agents
  (_results, meta) => {
    const fullyVerified = meta.failedSteps === 0;
    return {
      asiId: 'ASI-10',
      riskName: 'Rogue Agents',
      status: fullyVerified ? 'mitigated' : 'partial',
      evidence: fullyVerified
        ? [
            'Transcript analysis as secondary verification signal',
            'All steps passed outcome-based verification',
            'Max retry limits enforced'
          ]
        : [
            'Transcript analysis as secondary signal only',
            `${meta.failedSteps} step(s) failed verification`,
            'Outcome checks gated merges'
          ],
      rationale: fullyVerified
        ? 'Outcome verification and transcript analysis completed successfully for all steps.'
        : 'Outcome checks served as the primary gate against rogue behavior.'
    };
  }
];

export class OwaspMapper {
  map(verificationResults: VerificationResult[], executionMeta: ExecutionMetadata): OwaspComplianceReport {
    const risks = riskAssessors.map(assess => assess(verificationResults, executionMeta));

    const notApplicableRisks = risks.filter(r => r.status === 'not_applicable').length;
    const mitigatedRisks = risks.filter(r => r.status === 'mitigated').length;
    const partialRisks = risks.filter(r => r.status === 'partial').length;

    return {
      generatedAt: new Date().toISOString(),
      executionId: executionMeta.executionId,
      toolVersion: executionMeta.toolVersion,
      applicableRisks: 10 - notApplicableRisks,
      mitigatedRisks,
      partialRisks,
      notApplicableRisks,
      risks
    };
  }
}

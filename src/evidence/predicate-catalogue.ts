import type { JsonValue } from "./canonical-json.ts";
import { type RecordType, recordTypes } from "./ledger-record.ts";
import { evaluateClaim, recordKindOf } from "./verifier/verify.mjs";

/**
 * One example predicate per record kind, for the model that has to write a claim and for the
 * check that keeps the prompt honest. The kind names are derived by the shipped verifier's own
 * rule, and every example is held to that verifier against the sample beside it, so the prompt
 * cannot describe a predicate language the verifier does not evaluate.
 *
 * The samples are shapes, not records: a field or two of what the harness writes for that
 * type, enough for the example to be true of it. The UNVERIFIED (predicate-unparseable) path
 * is untouched by any of this; a predicate the verifier cannot read still renders as such.
 */
export interface CatalogueEntry {
  readonly type: RecordType;
  /** The payload field the kind is keyed on, or null where the type alone is the kind. */
  readonly subjectField: string | null;
  readonly example: string;
  readonly sample: JsonValue;
  /** What the record is, in a few words a model can pick the right one by. */
  readonly says: string;
}

export const predicateCatalogue: readonly CatalogueEntry[] = [
  {
    type: "session-started",
    subjectField: null,
    example: "maxSteps > 0",
    sample: {
      task: "add a helper",
      workspace: "/repo",
      baseRef: "abc",
      maxSteps: 16,
      attemptCap: 3,
    },
    says: "the task, workspace and budgets the run opened with",
  },
  {
    type: "local-endpoint",
    subjectField: null,
    example: 'origin == "flag"',
    sample: {
      url: "http://127.0.0.1:11434/v1",
      chosen: "pinned",
      origin: "flag",
      reason: "pinned by flag",
    },
    says: "which local server the run talks to",
  },
  {
    type: "model-call",
    subjectField: null,
    example: "content.valid == true",
    sample: {
      step: 1,
      inputTokens: 1752,
      outputTokens: 31,
      finishReason: "tool-calls",
      toolCallCount: 1,
      content: { valid: true, reason: null },
    },
    says: "one request to the model and what came back",
  },
  {
    type: "tool-call",
    subjectField: "toolName",
    example: "facts.exitCode == 0",
    sample: {
      callId: "c1",
      toolName: "shell",
      kind: "shell",
      decision: "allowed",
      denial: null,
      detail: "node --test",
      facts: { exitCode: 0 },
      output: "",
    },
    says: "a tool call the chokepoint settled, with the facts it recorded",
  },
  {
    type: "confirmation",
    subjectField: null,
    example: 'outcome == "confirmed"',
    sample: {
      callId: "c1",
      toolName: "shell",
      kind: "shell",
      outcome: "confirmed",
      reason: "not-allowlisted",
      detail: "make test",
    },
    says: "a question put to a person and the answer",
  },
  {
    type: "claim",
    subjectField: null,
    example: 'recordKind == "gate-run:tests"',
    sample: {
      predicate: 'status == "passed"',
      record: "sha256:aa",
      recordKind: "gate-run:tests",
      recordSequence: 15,
      narrative: "",
    },
    says: "a claim as submitted; its verdict lives in the evidence graph, not here",
  },
  {
    type: "session-stopped",
    subjectField: null,
    example: 'stopReason == "completed"',
    sample: { stopReason: "completed", steps: 8, tokensUsed: 20023, completionNarrative: "done" },
    says: "how the loop ended",
  },
  {
    type: "session-budget",
    subjectField: null,
    example: "maxWallTimeMs > 0",
    sample: { maxWallTimeMs: 1980000, loopWallTimeMs: 1800000, note: "one wall budget" },
    says: "the wall budget the whole run draws from",
  },
  {
    type: "gate-run",
    subjectField: "gateId",
    example: 'status == "passed"',
    sample: {
      gateId: "tests",
      status: "passed",
      severity: "blocking",
      blocking: true,
      attempt: 0,
      exitCode: 0,
      parser: "test-output",
      measures: { testsCollected: 3 },
    },
    says: "one gate's verdict in one attempt; cite the gate you mean",
  },
  {
    type: "gate-set-sealed",
    subjectField: null,
    example: "attemptCap >= 0",
    sample: {
      criteriaRef: "abc",
      detectedTypes: ["node"],
      gates: [],
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      attemptCap: 3,
      ratchetArms: [],
    },
    says: "the criteria sealed before the loop",
  },
  {
    type: "gate-bond",
    subjectField: null,
    example: 'verdict == "held"',
    sample: {
      gateId: "tests",
      expected: "failed",
      observed: "failed",
      verdict: "held",
      severity: "blocking",
      detail: "the tests gate refused the bond",
    },
    says: "whether a passing gate refused the failure it was handed",
  },
  {
    type: "ratchet-decision",
    subjectField: null,
    example: "accepted == true",
    sample: {
      scope: "retry",
      attempt: 1,
      accepted: true,
      detail: "no measure moved the wrong way",
      violations: [],
      abstentions: [],
      newSpecifications: [],
    },
    says: "the numeric comparison between two states",
  },
  {
    type: "file-set-declared",
    subjectField: null,
    example: "fileCount == 2",
    sample: { files: ["src/a.ts", "src/a.test.ts"], fileCount: 2 },
    says: "the files the plan intends to touch",
  },
  {
    type: "file-set-amended",
    subjectField: null,
    example: "amendment == true",
    sample: {
      amendment: true,
      added: ["src/b.ts"],
      addedCount: 1,
      files: ["src/a.ts", "src/b.ts"],
      fileCountAfter: 2,
      reason: "the helper needs its own module",
    },
    says: "a widening of that set, with its reason",
  },
  {
    type: "escalation",
    subjectField: null,
    example: 'gateId == "tests"',
    sample: {
      gateId: "tests",
      title: "tests",
      reason: "2 of 3 failed",
      attemptsUsed: 3,
      attemptsRejectedByRatchet: 1,
      cap: 3,
      history: [],
      lastGateRecord: "sha256:aa",
    },
    says: "the gate the run stopped at and why",
  },
  {
    type: "workspace-diff",
    subjectField: null,
    example: "truncated == false",
    sample: { baseRef: "abc", patch: "diff --git a/x b/x", characters: 18, truncated: false },
    says: "the patch the run left against its base",
  },
  {
    type: "inherited-changes",
    subjectField: null,
    example: 'baseRef != ""',
    sample: {
      baseRef: "abc",
      files: ["notes.md"],
      note: "already different from the base when the run started",
    },
    says: "what already differed from the base before the run began",
  },
  {
    type: "calibration-canary",
    subjectField: null,
    example: "healthy == true",
    sample: { model: "local:m", attempts: 3, wellFormed: 3, healthy: true, results: [] },
    says: "whether a backend answered a trivial tool call well formed",
  },
  {
    type: "calibration-preflight",
    subjectField: null,
    example: "enumerated == true",
    sample: {
      backend: "http://127.0.0.1:11434/v1",
      enumerated: true,
      requested: ["local:m"],
      served: ["local:m"],
      runnable: ["local:m"],
      excluded: [],
      failure: null,
    },
    says: "which requested models the backend actually serves",
  },
  {
    type: "calibration-run",
    subjectField: null,
    example: "executed == true",
    sample: {
      caseId: "edit-loud-greeting",
      model: "local:m",
      repeat: 1,
      executed: true,
      abstained: false,
      abstentionReason: null,
      gatePassed: true,
      gateExitCode: 0,
      steps: 4,
    },
    says: "one repeat of one golden case on one model",
  },
  {
    type: "calibration-summary",
    subjectField: null,
    example: "executedRepeats == 60",
    sample: {
      model: "local:m",
      repeats: 60,
      executedRepeats: 60,
      gatePassed: 53,
      cases: 20,
      abstentions: {},
    },
    says: "one model's distributions over the sweep",
  },
  {
    type: "calibration-verdict",
    subjectField: null,
    example: "abstained == false",
    sample: { pick: "local:m", abstained: false, models: ["local:m"], rejected: [], reasoning: [] },
    says: "the pick, or the abstention, over the models measured",
  },
  {
    type: "routing-decision",
    subjectField: null,
    example: 'assignment == "explore"',
    sample: {
      taskClass: "edit",
      model: "local:m",
      assignment: "explore",
      samples: 4,
      threshold: 6,
      reason: "under the threshold",
      arms: [],
    },
    says: "which model the router chose for this task and on what",
  },
  {
    type: "reward",
    subjectField: null,
    example: "reward >= 0",
    sample: {
      model: "local:m",
      assignment: "pinned",
      reward: 0.7,
      attempts: 0,
      changedFiles: 2,
      latencyMs: 51232,
      costUsd: 0,
    },
    says: "what the run scored for the bandit, from gate results",
  },
  {
    type: "worker-started",
    subjectField: null,
    example: 'workerId == "worker-1"',
    sample: {
      workerId: "worker-1",
      sessionId: "s-worker-1",
      task: "add a helper",
      branch: "swarm/run/worker-1",
      baseCommit: "abc",
    },
    says: "a worker dispatched on its own branch",
  },
  {
    type: "worker-finished",
    subjectField: null,
    example: "green == true",
    sample: {
      workerId: "worker-1",
      green: true,
      commit: "def",
      branch: "swarm/run/worker-1",
      recordCount: 52,
      chainHead: "sha256:aa",
      declaredFiles: [],
    },
    says: "what a worker's own gates decided",
  },
  {
    type: "merge-attempt",
    subjectField: null,
    example: "landed == true",
    sample: {
      workerId: "worker-1",
      branch: "swarm/run/worker-1",
      position: 1,
      rank: 1,
      role: "winner",
      landed: true,
      ratchetAccepted: true,
      conflictingPaths: [],
      blockingFailures: [],
    },
    says: "one candidate tried by the merge queue",
  },
  {
    type: "attempt-selection",
    subjectField: "taskId",
    example: 'winner == "worker-1"',
    sample: {
      taskId: "task-1",
      winner: "worker-1",
      ranked: 3,
      eligible: 3,
      baseCommit: "abc",
      order: [],
      attempts: [],
      abstentions: [],
    },
    says: "which of a task's attempts the comparator ranked first",
  },
  {
    type: "task-graph",
    subjectField: null,
    example: "parallelSafe == true",
    sample: {
      goal: "add a shouting variant",
      source: "goal",
      nodeCount: 3,
      nodes: [],
      overlaps: [],
      parallelSafe: true,
    },
    says: "the decomposition declared before any worker started",
  },
  {
    type: "task-graph-outcome",
    subjectField: null,
    example: "landed == 3",
    sample: { goal: "add a shouting variant", nodes: 3, landed: 3, blocked: [], perNode: [] },
    says: "how many declared nodes ran and landed",
  },
];

/** The kind string a claim names for this entry, by the verifier's own rule over the sample. */
export function kindOf(entry: CatalogueEntry): string {
  return recordKindOf(entry.type, entry.sample);
}

/** The kind as the prompt shows it: the subject field named rather than one sample's value. */
function kindPattern(entry: CatalogueEntry): string {
  return entry.subjectField === null ? entry.type : `${entry.type}:<${entry.subjectField}>`;
}

/** Whether the shipped verifier reads the example as true of the sample, under the kind it names. */
export function exampleVerifies(entry: CatalogueEntry): boolean {
  const kind = kindOf(entry);
  const lookup = () => ({ carriers: [{ sequence: 1, kind }], payload: entry.sample });
  const claim = {
    predicate: entry.example,
    record: "sha256:catalogue",
    recordKind: kind,
    recordSequence: 1,
    narrative: "",
  };
  return evaluateClaim(claim, lookup).verdict === "verified";
}

/**
 * Where the catalogue and the ledger, or the catalogue and the verifier, disagree. Empty is
 * the only acceptable answer, and the drift check fails on anything else by name.
 */
export function catalogueDrift(
  catalogue: readonly CatalogueEntry[] = predicateCatalogue,
  types: readonly string[] = recordTypes,
): readonly string[] {
  const problems: string[] = [];
  const listed = new Map<string, number>();
  for (const entry of catalogue) {
    listed.set(entry.type, (listed.get(entry.type) ?? 0) + 1);
  }
  for (const type of types) {
    if (!listed.has(type)) {
      problems.push(
        `record type ${type} has no catalogue entry, so the prompt does not mention it`,
      );
    }
  }
  for (const [type, count] of listed) {
    if (!types.includes(type)) {
      problems.push(`catalogue names ${type}, which the ledger cannot hold`);
    }
    if (count > 1) {
      problems.push(`catalogue names ${type} ${count} times; one example per kind`);
    }
  }
  for (const entry of catalogue) {
    const expected =
      entry.subjectField === null
        ? entry.type
        : `${entry.type}:${String((entry.sample as { readonly [key: string]: JsonValue })[entry.subjectField] ?? "")}`;
    if (kindOf(entry) !== expected) {
      problems.push(
        `${entry.type}: the verifier names the kind ${kindOf(entry)}, the catalogue says ${expected}`,
      );
    }
    if (!exampleVerifies(entry)) {
      problems.push(
        `${entry.type}: the example ${entry.example} does not verify against its sample`,
      );
    }
  }
  return problems;
}

/** The catalogue as the system prompt carries it: one line, one entry per kind. */
export function renderPredicateCatalogue(
  catalogue: readonly CatalogueEntry[] = predicateCatalogue,
): string {
  return (
    "Record kinds a claim can cite, each with one example predicate: " +
    catalogue.map((entry) => `${kindPattern(entry)} (${entry.says}): ${entry.example}`).join("; ") +
    "."
  );
}

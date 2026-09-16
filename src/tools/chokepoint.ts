import type { ApprovalMode } from "../config/approval-mode.ts";
import {
  describeUnknownError,
  type ProvenanceTag,
  type ToolCallOutcome,
} from "../core/model-client.ts";
import type { ToolInvocation, ToolInvoker } from "../core/tool-invoker.ts";
import { asJsonValue, digestOfBytes, type JsonValue } from "../evidence/canonical-json.ts";
import { recordKindOf } from "../evidence/record-kind.ts";
import type {
  ChokepointDecision,
  ChokepointRecorder,
  ConfirmationDecider,
  ConfirmationReason,
  DenialReason,
} from "./chokepoint-record.ts";
import {
  createDerivationHeuristic,
  type DerivationAssessment,
  type DerivationHeuristic,
} from "./derivation.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import {
  type DecodedToolArguments,
  decodeStringifiedToolArguments,
} from "./tool-argument-decoding.ts";
import type { ToolDefinition, ToolKind, ToolOutput } from "./tool-definition.ts";

export interface ConfirmationRequest {
  readonly toolName: string;
  readonly detail: string;
  readonly reason: ConfirmationReason;
  /** One line the user can act on, including the caveat when a heuristic raised this. */
  readonly explanation: string;
  /**
   * The off-list programs an "always" would allow for the rest of the run. Present only on a
   * shell-allowlist question whose command the guard could read.
   */
  readonly programs?: readonly string[];
}

/**
 * What a person answers: yes and no settle the call; always settles it and, for a
 * shell-allowlist question, allows the off-list programs for the rest of the run (ADR 0011).
 */
export type ConfirmationAnswer = "yes" | "no" | "always";

/** Asked whenever a call needs a human before it runs. */
export type ConfirmationPrompt = (request: ConfirmationRequest) => Promise<ConfirmationAnswer>;

interface ChokepointDependencies {
  readonly abortSignal?: AbortSignal | undefined;
  readonly definitions: readonly ToolDefinition[];
  readonly guard: PolicyGuard;
  readonly confirm: ConfirmationPrompt;
  /**
   * Whether a shell-allowlist question is answered by the workspace's policy before a person
   * sees it. Never covers the derivation heuristic, which is the injection defence. Absent
   * means ask, which is what every caller did before there was a mode.
   */
  readonly approvalMode?: ApprovalMode;
  readonly recorder: ChokepointRecorder;
  readonly derivation?: DerivationHeuristic;
  /**
   * Kinds whose arguments a derivation match gates. Execution only, by default: an edit
   * necessarily quotes the file it edits, so gating writes would fire on almost every one
   * of them, which is the false-positive cost of a text-overlap heuristic made concrete.
   */
  readonly gatedKinds?: readonly ToolKind[];
}

const defaultGatedKinds: readonly ToolKind[] = ["shell"];

/**
 * Who settles a question before a person is asked, or null where a person must be. Only the
 * shell-allowlist question is ever settled here: the approval mode answers it for the
 * workspace, and a run allowance answers it for programs a person already said "always" to.
 */
function settleInAdvance(
  gate: ConfirmationRequest,
  offList: readonly string[] | null,
  approvalMode: ApprovalMode | undefined,
  runAllowance: ReadonlySet<string>,
): ConfirmationDecider | null {
  if (gate.reason !== "shell-allowlist") {
    return null;
  }
  if (approvalMode === "auto") {
    return "approval-mode";
  }
  if (offList !== null && offList.length > 0 && offList.every((name) => runAllowance.has(name))) {
    return "run-allowance";
  }
  return null;
}

/**
 * The single execution path for every tool call (invariant 3). It records the request,
 * enforces the guard, applies provenance tags, routes suspicious calls through
 * confirmation, runs the tool, and records the outcome. Two records per call is deliberate:
 * the request is on disk before anything runs, so a call that kills the process mid-flight
 * still left evidence that it was made.
 *
 * A denial or a thrown tool error comes back as a failed outcome rather than an exception,
 * because the loop feeds both to the model. A failed ledger write is the one exception: it
 * propagates and ends the run, since unrecorded execution is the state this design exists
 * to prevent.
 */
export function createToolChokepoint(deps: ChokepointDependencies): ToolInvoker {
  // A person's "always" answers, kept for this run and never written anywhere else.
  const runAllowance = new Set<string>();
  const byName = new Map(deps.definitions.map((definition) => [definition.name, definition]));
  const derivation = deps.derivation ?? createDerivationHeuristic();
  const gatedKinds = deps.gatedKinds ?? defaultGatedKinds;

  return {
    async invoke(invocation: ToolInvocation): Promise<ToolCallOutcome> {
      const definition = byName.get(invocation.toolName);
      const kind: ToolKind | "unknown" = definition?.kind ?? "unknown";
      const input = asJsonValue(invocation.input);
      // Decoded against the tool's own schema, before anything is recorded, so both records
      // carry what the model sent and what the harness read it as.
      const decoded =
        definition === undefined
          ? emptyDecoding(invocation.input)
          : decodeStringifiedToolArguments(invocation.input, definition.inputSchema);
      const assessment = derivation.assess(collectStrings(invocation.input).join(" "));
      const provenance = tagsFor(invocation.provenance, assessment);

      const settle = async (
        decision: ChokepointDecision,
        detail: string,
        output: string,
        facts: Readonly<Record<string, JsonValue>>,
        denial: DenialReason | null = null,
      ): Promise<ToolCallOutcome> => {
        const digest = await deps.recorder.recordCall({
          callId: invocation.callId,
          toolName: invocation.toolName,
          kind,
          provenance,
          decision,
          denial,
          detail,
          input,
          decodedFields: decoded.decodedFields,
          output,
          facts,
          derivation: assessment,
        });
        const body = decision === "allowed" ? output : `${decision}: ${detail}`;
        return {
          callId: invocation.callId,
          toolName: invocation.toolName,
          // The digest trailer is how the model learns which record it may cite in a claim,
          // and the kind is how it learns what that record is allowed to be evidence of.
          output: `${body}\n[evidence record ${digest} kind ${recordKindOf("tool-call", { toolName: invocation.toolName })}]`,
          failed: decision !== "allowed",
        };
      };

      await deps.recorder.recordCall({
        callId: invocation.callId,
        toolName: invocation.toolName,
        kind,
        provenance,
        decision: "requested",
        denial: null,
        detail: `${invocation.toolName} requested`,
        input,
        decodedFields: decoded.decodedFields,
        output: "",
        facts: {},
        derivation: assessment,
      });

      if (deps.abortSignal?.aborted)
        return settle("failed", "cancelled before execution", "", { cancelled: true });
      if (definition === undefined) {
        return settle(
          "denied",
          `no such tool. Known tools: ${[...byName.keys()].join(", ")}`,
          "",
          {},
          "unknown-tool",
        );
      }

      const parsed = definition.inputSchema.safeParse(decoded.input);
      if (!parsed.success) {
        return settle("denied", `input rejected: ${parsed.error.message}`, "", {}, "invalid-input");
      }

      for (const path of definition.pathsFrom(parsed.data)) {
        const verdict = deps.guard.checkPath(path);
        if (!verdict.allowed) {
          return settle("denied", verdict.reason, "", {}, "guard");
        }
      }

      const gate = confirmationNeeded(definition, parsed.data, assessment, deps, gatedKinds);
      if (gate !== null) {
        const offList =
          gate.reason === "shell-allowlist"
            ? deps.guard.disallowedExecutables(commandOf(parsed.data))
            : null;
        const settledInAdvance = settleInAdvance(gate, offList, deps.approvalMode, runAllowance);
        const answer = settledInAdvance === null ? await deps.confirm(gate) : "yes";
        const approved = answer !== "no";
        await deps.recorder.recordConfirmation({
          callId: invocation.callId,
          toolName: invocation.toolName,
          kind,
          reason: gate.reason,
          detail: gate.detail,
          outcome: settledInAdvance !== null ? "pre-approved" : approved ? "approved" : "declined",
          decidedBy: settledInAdvance ?? "user",
          derivation: assessment,
        });
        // "always" on an allowlist question is a run allowance for its programs, recorded with
        // the person's provenance. On a derivation question it is a yes for this call only:
        // the heuristic is per call, and there is no program to allow.
        if (answer === "always" && gate.reason === "shell-allowlist" && offList !== null) {
          for (const program of offList) runAllowance.add(program);
          await deps.recorder.recordAllowance({
            callId: invocation.callId,
            toolName: invocation.toolName,
            programs: offList,
          });
        }
        if (!approved) {
          return settle(
            "denied",
            `${gate.explanation} Confirmation was declined.`,
            "",
            {},
            "confirmation-declined",
          );
        }
      }

      let output: ToolOutput;
      try {
        deps.abortSignal?.throwIfAborted();
        output = await definition.execute(parsed.data, { signal: deps.abortSignal });
      } catch (cause) {
        return settle("failed", describeUnknownError(cause), "", {});
      }

      observeUntrusted(derivation, definition, invocation.toolName, output.text);
      return settle(
        "allowed",
        `${output.text.length} bytes returned`,
        output.text,
        output.facts ?? {},
      );
    },
  };
}

/** An unknown tool has no schema to decode against, so nothing is decoded and nothing is claimed. */
function emptyDecoding(input: unknown): DecodedToolArguments {
  return { input, decodedFields: [] };
}

function confirmationNeeded(
  definition: ToolDefinition,
  input: unknown,
  assessment: DerivationAssessment,
  deps: ChokepointDependencies,
  gatedKinds: readonly ToolKind[],
): ConfirmationRequest | null {
  const detail = collectStrings(input).join(" ").slice(0, 300);

  if (definition.kind === "shell") {
    const command = commandOf(input);
    if (!deps.guard.isCommandAllowed(command)) {
      const programs = deps.guard.disallowedExecutables(command);
      return {
        toolName: definition.name,
        detail: command,
        reason: "shell-allowlist",
        explanation: `"${command}" is not on the shell allowlist.`,
        ...(programs === null || programs.length === 0 ? {} : { programs }),
      };
    }
  }

  if (gatedKinds.includes(definition.kind) && assessment.matched) {
    return {
      toolName: definition.name,
      detail,
      reason: "derivation-heuristic",
      explanation:
        `These arguments overlap content read earlier (${assessment.method} match, score ` +
        `${assessment.score.toFixed(2)} against a threshold of ${assessment.settings.threshold}, ` +
        `from ${assessment.source?.label ?? "an earlier read"}), so the call may have been ` +
        "shaped by that content. This is a heuristic with a false-positive rate, not proof of influence.",
    };
  }

  return null;
}

/**
 * Feeds tool output back into the window as untrusted content. Read-shaped tools carry the
 * file tag, everything else tool-output, which is what a flagged call later reports as the
 * plausible source.
 */
function observeUntrusted(
  derivation: DerivationHeuristic,
  definition: ToolDefinition,
  toolName: string,
  text: string,
): void {
  if (definition.kind !== "read" && definition.kind !== "shell") {
    return;
  }
  derivation.observe(text, {
    tag: definition.kind === "read" ? "file" : "tool-output",
    label: toolName,
    digest: digestOfBytes(text),
  });
}

function tagsFor(
  declared: ProvenanceTag,
  assessment: DerivationAssessment,
): readonly ProvenanceTag[] {
  if (!assessment.matched || assessment.source === null) {
    return [declared];
  }
  return declared === assessment.source.tag ? [declared] : [declared, assessment.source.tag];
}

/** Every string anywhere in the input, which is what the derivation heuristic matches on. */
function collectStrings(input: unknown): readonly string[] {
  if (typeof input === "string") {
    return [input];
  }
  if (typeof input !== "object" || input === null) {
    return [];
  }
  return Object.values(input).flatMap((value) => collectStrings(value));
}

function commandOf(input: unknown): string {
  if (typeof input === "object" && input !== null && "command" in input) {
    const command = (input as { command: unknown }).command;
    return typeof command === "string" ? command : String(command);
  }
  return "";
}

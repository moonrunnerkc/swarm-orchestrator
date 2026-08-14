import {
  describeUnknownError,
  type ProvenanceTag,
  type ToolCallOutcome,
} from "../core/model-client.ts";
import type { ToolInvocation, ToolInvoker } from "../core/tool-invoker.ts";
import { asJsonValue, digestOfBytes, type JsonValue } from "../evidence/canonical-json.ts";
import type {
  ChokepointDecision,
  ChokepointRecorder,
  ConfirmationReason,
  DenialReason,
} from "./chokepoint-record.ts";
import {
  createDerivationHeuristic,
  type DerivationAssessment,
  type DerivationHeuristic,
} from "./derivation.ts";
import type { Sandbox } from "./sandbox.ts";
import type { ToolDefinition, ToolKind, ToolOutput } from "./tool-definition.ts";

export interface ConfirmationRequest {
  readonly toolName: string;
  readonly detail: string;
  readonly reason: ConfirmationReason;
  /** One line the user can act on, including the caveat when a heuristic raised this. */
  readonly explanation: string;
}

/** Asked whenever a call needs a human before it runs. */
export type ConfirmationPrompt = (request: ConfirmationRequest) => Promise<boolean>;

interface ChokepointDependencies {
  readonly definitions: readonly ToolDefinition[];
  readonly sandbox: Sandbox;
  readonly confirm: ConfirmationPrompt;
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
 * The single execution path for every tool call (invariant 3). It records the request,
 * enforces the sandbox, applies provenance tags, routes suspicious calls through
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
  const byName = new Map(deps.definitions.map((definition) => [definition.name, definition]));
  const derivation = deps.derivation ?? createDerivationHeuristic();
  const gatedKinds = deps.gatedKinds ?? defaultGatedKinds;

  return {
    async invoke(invocation: ToolInvocation): Promise<ToolCallOutcome> {
      const definition = byName.get(invocation.toolName);
      const kind: ToolKind | "unknown" = definition?.kind ?? "unknown";
      const input = asJsonValue(invocation.input);
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
          output,
          facts,
          derivation: assessment,
        });
        const body = decision === "allowed" ? output : `${decision}: ${detail}`;
        return {
          callId: invocation.callId,
          toolName: invocation.toolName,
          // The digest trailer is how the model learns which record it may cite in a claim.
          output: `${body}\n[evidence record ${digest}]`,
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
        output: "",
        facts: {},
        derivation: assessment,
      });

      if (definition === undefined) {
        return settle(
          "denied",
          `no such tool. Known tools: ${[...byName.keys()].join(", ")}`,
          "",
          {},
          "unknown-tool",
        );
      }

      const parsed = definition.inputSchema.safeParse(invocation.input);
      if (!parsed.success) {
        return settle("denied", `input rejected: ${parsed.error.message}`, "", {}, "invalid-input");
      }

      for (const path of definition.pathsFrom(parsed.data)) {
        const verdict = deps.sandbox.checkPath(path);
        if (!verdict.allowed) {
          return settle("denied", verdict.reason, "", {}, "sandbox");
        }
      }

      const gate = confirmationNeeded(definition, parsed.data, assessment, deps, gatedKinds);
      if (gate !== null) {
        const approved = await deps.confirm(gate);
        await deps.recorder.recordConfirmation({
          callId: invocation.callId,
          toolName: invocation.toolName,
          kind,
          reason: gate.reason,
          detail: gate.detail,
          approved,
          derivation: assessment,
        });
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
        output = await definition.execute(parsed.data);
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
    if (!deps.sandbox.isCommandAllowed(command)) {
      return {
        toolName: definition.name,
        detail: command,
        reason: "shell-allowlist",
        explanation: `"${command}" is not on the shell allowlist.`,
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

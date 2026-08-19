import type { ModelClient, ToolSchema } from "../core/model-client.ts";

/**
 * One trivial tool-call round trip against the served model, before a calibration commits to
 * the golden set. What it watches is the transport, not the model's judgement: a local runtime
 * that has been resident a long time can start returning a tool name with generation debris
 * welded to it, or arguments truncated mid-object, and every one of those lands as a malformed
 * call the report scores against the model. A calibration is hours; learning this from the
 * report afterwards costs all of them.
 */

export interface CanaryAttempt {
  readonly attempt: number;
  /** What came back, exactly as the runtime named it, or null when no call came back at all. */
  readonly toolName: string | null;
  readonly wellFormed: boolean;
  readonly problem: string | null;
  /** What the model said alongside the call, kept because debris shows up here first. */
  readonly text: string;
}

export interface BackendCanary {
  readonly modelSpec: string;
  readonly prompt: string;
  readonly attempts: readonly CanaryAttempt[];
  readonly wellFormed: number;
  readonly healthy: boolean;
}

/**
 * Deliberately the smallest task the tool set can express, so a healthy runtime answers it the
 * same way every time and a failure is about the transport rather than the difficulty.
 */
const canaryPrompt =
  "List the entries of the current directory. Make exactly one tool call, with no other text.";

const canarySystemPrompt = [
  "You are a coding agent working inside one small workspace directory.",
  "Answer with a single tool call and nothing else.",
].join(" ");

interface CanaryRequest {
  readonly modelSpec: string;
  readonly model: ModelClient;
  readonly tools: readonly ToolSchema[];
  readonly attempts: number;
  readonly abortSignal: AbortSignal;
}

/**
 * Healthy means at least one attempt came back as a call the chokepoint could act on. The bar
 * is deliberately that low: this rules out a runtime that cannot form a call at all, and it is
 * not a quality bar on the model, which is what the calibration itself is for. A bar that
 * needed every attempt clean would reject a merely mediocre model before it was measured,
 * which is the harness deciding what the measurement was going to say.
 */
export async function runBackendCanary(request: CanaryRequest): Promise<BackendCanary> {
  const attempts: CanaryAttempt[] = [];

  for (let attempt = 1; attempt <= request.attempts; attempt += 1) {
    attempts.push(await attemptOnce(attempt, request));
  }

  const wellFormed = attempts.filter((one) => one.wellFormed).length;
  return {
    modelSpec: request.modelSpec,
    prompt: canaryPrompt,
    attempts,
    wellFormed,
    healthy: wellFormed > 0,
  };
}

async function attemptOnce(attempt: number, request: CanaryRequest): Promise<CanaryAttempt> {
  let response: Awaited<ReturnType<ModelClient["generate"]>>;
  try {
    response = await request.model.generate({
      system: canarySystemPrompt,
      messages: [{ role: "user", text: canaryPrompt }],
      tools: request.tools,
      maxOutputTokens: 512,
      abortSignal: request.abortSignal,
    });
  } catch (cause) {
    return {
      attempt,
      toolName: null,
      wellFormed: false,
      problem: `the call failed: ${cause instanceof Error ? cause.message : "unknown error"}`,
      text: "",
    };
  }

  const call = response.toolCalls[0];
  if (call === undefined) {
    return {
      attempt,
      toolName: null,
      wellFormed: false,
      problem: "no tool call came back",
      text: response.text,
    };
  }

  // The same two questions the chokepoint asks, asked here so the answer costs one call
  // rather than a golden set: is this a tool, and is this its input.
  const schema = request.tools.find((tool) => tool.name === call.toolName);
  if (schema === undefined) {
    return {
      attempt,
      toolName: call.toolName,
      wellFormed: false,
      problem: `no tool is named ${JSON.stringify(call.toolName)}`,
      text: response.text,
    };
  }

  const parsed = schema.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    return {
      attempt,
      toolName: call.toolName,
      wellFormed: false,
      problem: `the input for ${call.toolName} did not match its schema`,
      text: response.text,
    };
  }

  return { attempt, toolName: call.toolName, wellFormed: true, problem: null, text: response.text };
}

/** Type aliases rather than interfaces, so they stay assignable to the ledger's JSON type. */
type CanaryEntry = {
  type: "calibration-canary";
  actor: "harness";
  provenance: ["tool-output"];
  payload: {
    model: string;
    prompt: string;
    attempts: number;
    wellFormed: number;
    healthy: boolean;
    results: {
      attempt: number;
      toolName: string | null;
      wellFormed: boolean;
      problem: string | null;
      text: string;
    }[];
  };
};

export function canaryRecord(canary: BackendCanary): CanaryEntry {
  return {
    type: "calibration-canary",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      model: canary.modelSpec,
      prompt: canary.prompt,
      attempts: canary.attempts.length,
      wellFormed: canary.wellFormed,
      healthy: canary.healthy,
      results: canary.attempts.map((one) => ({
        attempt: one.attempt,
        toolName: one.toolName,
        wellFormed: one.wellFormed,
        problem: one.problem,
        text: one.text,
      })),
    },
  };
}

export function describeCanary(canary: BackendCanary): readonly string[] {
  const lines = [
    `canary: ${canary.wellFormed} of ${canary.attempts.length} trivial tool call(s) came back well formed from ${canary.modelSpec}.`,
  ];
  for (const one of canary.attempts.filter((attempt) => !attempt.wellFormed)) {
    lines.push(`canary: attempt ${one.attempt} ${one.problem}.`);
  }
  if (!canary.healthy) {
    lines.push(
      "canary: the backend could not form a single usable tool call, so calibration would " +
        "measure the runtime rather than the model. Restart the local runtime and try again.",
    );
  }
  return lines;
}

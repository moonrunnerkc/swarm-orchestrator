import { z } from "zod";
import { digestOfJson, type JsonValue } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const referenceSchema = z.object({
  transcriptVersion: z.literal(2),
  system: digest,
  tools: digest,
  tail: digest.nullable(),
  length: z.number().int().nonnegative(),
  maxOutputTokens: z.number(),
  sampling: z.unknown(),
});
const componentSchema = z.object({
  kind: z.enum(["system", "tools", "message"]),
  previous: digest.nullable(),
  value: z.unknown(),
});

export async function recordTranscript(
  evidence: EvidenceRecorder,
  prompt: JsonValue,
): Promise<JsonValue> {
  const original = prompt as {
    system: JsonValue;
    tools: JsonValue;
    messages: JsonValue[];
    maxOutputTokens: number;
    sampling: JsonValue;
  };
  const known = new Set(
    evidence
      .records()
      .filter((entry) => entry.type === "transcript-component")
      .map((entry) => entry.payloadDigest),
  );
  const store = async (
    kind: "system" | "tools" | "message",
    value: JsonValue,
    previous: string | null = null,
  ) => {
    const payload = { kind, value, previous };
    const digest = digestOfJson(payload);
    if (!known.has(digest)) {
      const recorded = await evidence.record({
        type: "transcript-component",
        actor: "harness",
        provenance: ["model"],
        payload,
      });
      if (recorded.record.payloadDigest !== digest)
        throw new Error(
          "transcript scrub changed an already scrubbed component; abort to preserve replay identity",
        );
      known.add(digest);
    }
    return digest;
  };
  const system = await store("system", original.system);
  const tools = await store("tools", original.tools);
  let tail: string | null = null;
  for (const message of original.messages) tail = await store("message", message, tail);
  return {
    transcriptVersion: 2,
    system,
    tools,
    tail,
    length: original.messages.length,
    maxOutputTokens: original.maxOutputTokens,
    sampling: original.sampling,
  };
}

export function reconstructTranscript(
  prompt: unknown,
  payloads: ReadonlyMap<string, unknown>,
): JsonValue {
  if ((prompt as { transcriptVersion?: number })?.transcriptVersion !== 2)
    return prompt as JsonValue;
  const reference = referenceSchema.parse(prompt);
  const read = (digest: string, kind: "system" | "tools" | "message") => {
    const held = payloads.get(digest);
    if (held === undefined || digestOfJson(held as JsonValue) !== digest)
      throw new Error(`transcript component ${digest} is missing or altered`);
    const component = componentSchema.parse(held);
    if (component.kind !== kind) throw new Error(`transcript component kind mismatch: ${kind}`);
    return component;
  };
  const messages: JsonValue[] = [];
  let tail = reference.tail;
  const visited = new Set<string>();
  while (tail !== null) {
    if (visited.has(tail) || messages.length >= reference.length)
      throw new Error("transcript links contain a cycle or exceed the declared length");
    visited.add(tail);
    const component = read(tail, "message");
    messages.push(component.value as JsonValue);
    tail = component.previous;
  }
  if (messages.length !== reference.length)
    throw new Error("transcript ended before its declared length");
  return {
    system: read(reference.system, "system").value as JsonValue,
    tools: read(reference.tools, "tools").value as JsonValue,
    messages: messages.reverse(),
    maxOutputTokens: reference.maxOutputTokens,
    sampling: reference.sampling as JsonValue,
  };
}

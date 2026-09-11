import { z } from "zod";
import { digestOfJson } from "../evidence/canonical-json.ts";
import { freezeJson } from "../evidence/frozen-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const identity = z.string().min(1);
export const securityCorpusSchema = z
  .object({
    version: z.literal(1),
    buildDigest: digest,
    threatModel: identity,
    authorship: z.enum(["maintainer-regression", "independent-submission"]),
    author: identity,
    provenanceDigest: digest,
    backends: z.array(identity).min(1),
    cases: z
      .array(
        z.object({
          id: identity,
          artifactDigest: digest,
          capability: z.enum([
            "host-read",
            "host-write",
            "credentials",
            "environment",
            "dependency-script",
            "report-forgery",
            "peer-access",
            "evidence-write",
            "egress",
            "runtime-escape",
            "descendant-cleanup",
            "functionality",
          ]),
          lifecycle: z.enum([
            "normal",
            "failure",
            "timeout",
            "cancellation",
            "harness-death-repair",
          ]),
        }),
      )
      .min(1),
  })
  .superRefine((corpus, context) => {
    if (
      new Set(corpus.backends).size !== corpus.backends.length ||
      new Set(corpus.cases.map((entry) => entry.id)).size !== corpus.cases.length
    )
      context.addIssue({ code: "custom", message: "duplicate security case or backend" });
    if (!corpus.cases.some((entry) => entry.capability === "functionality"))
      context.addIssue({
        code: "custom",
        message: "a security corpus requires a positive functionality control",
      });
  });
const observationSchema = z.object({
  outcome: z.enum(["denied", "escaped", "functional", "unavailable"]),
  evidenceDigest: digest,
  cleanup: z.enum(["confirmed", "failed", "unmeasured"]),
});

/** Trusted observers execute submitted artifacts by digest, outside candidate workspaces. */
export async function runSecurityCorpus(options: {
  corpus: unknown;
  evidence: EvidenceRecorder;
  signal: AbortSignal;
  execute: (
    test: z.infer<typeof securityCorpusSchema>["cases"][number],
    backend: string,
  ) => Promise<unknown>;
}) {
  const corpus = freezeJson(securityCorpusSchema.parse(options.corpus));
  const corpusDigest = digestOfJson(corpus);
  await options.evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["user"],
    payload: { phase: "security-corpus-frozen", corpusDigest, corpus },
  });
  const observations: { caseId: string; backend: string; outcome: string; cleanup: string }[] = [];
  const planned = corpus.backends.flatMap((backend) =>
    corpus.cases.map((test) => ({ backend, test })),
  );
  for (const { backend, test } of planned) {
    if (options.signal.aborted) break;
    await options.evidence.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { phase: "security-launched", corpusDigest, backend, caseId: test.id },
    });
    let observation: z.infer<typeof observationSchema>;
    try {
      observation = observationSchema.parse(await options.execute(test, backend));
    } catch (cause) {
      const failure = await options.evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          phase: "security-execution-failed",
          corpusDigest,
          backend,
          caseId: test.id,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      });
      observation = {
        outcome: "unavailable",
        evidenceDigest: failure.record.payloadDigest,
        cleanup: "unmeasured",
      };
    }
    await options.evidence.record({
      type: "campaign-observation",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        phase: "security-settled",
        corpusDigest,
        backend,
        caseId: test.id,
        ...observation,
      },
    });
    observations.push({ caseId: test.id, backend, ...observation });
    if (observation.cleanup !== "confirmed") break;
  }
  const controlsPass = planned
    .filter(({ test }) => test.capability === "functionality")
    .every(({ test, backend }) =>
      observations.some(
        (entry) =>
          entry.caseId === test.id && entry.backend === backend && entry.outcome === "functional",
      ),
    );
  const attacksDenied = planned
    .filter(({ test }) => test.capability !== "functionality")
    .every(({ test, backend }) =>
      observations.some(
        (entry) =>
          entry.caseId === test.id && entry.backend === backend && entry.outcome === "denied",
      ),
    );
  return {
    corpusDigest,
    planned: planned.length,
    observed: observations.length,
    observations,
    controlsPass,
    attacksDenied,
    passed:
      observations.length === planned.length &&
      controlsPass &&
      attacksDenied &&
      observations.every((entry) => entry.cleanup === "confirmed"),
    authorship: corpus.authorship,
    limitation:
      "only the declared cases, lifecycle scenarios and observed backends; authorship requires independent provenance review",
  };
}

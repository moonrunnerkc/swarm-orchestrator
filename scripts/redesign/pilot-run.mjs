import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { runFrozenCampaign } from "../../src/eval/frozen-campaign.ts";
import { goalCampaignProtocolSchema } from "../../src/eval/goal-protocol.ts";
import { bundleSourceFromRecorder, exportBundle } from "../../src/evidence/bundle.ts";
import { asJsonValue, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { goalContractSchema } from "../../src/evidence/goal-contract.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createEphemeralSigningKey } from "../../src/evidence/signing.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { pilotCaseIds, pilotSettingsSchema, sourceCaseSchema } from "./pilot-cases.mjs";
import { executePilotGoal } from "./pilot-worker.mjs";

const execute = promisify(execFile);
const sourceRoot = resolve(new URL("../..", import.meta.url).pathname);
const git = async (cwd, ...argv) =>
  (
    await execute("git", argv, {
      cwd,
      env: harnessChildEnvironment().variables,
      timeout: 30000,
      maxBuffer: 64000000,
    })
  ).stdout.trim();
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const preparedCaseSchema = sourceCaseSchema.extend({
  clone: z.string().min(1),
  image: digest.nullable(),
  immutablePaths: z.array(z.string()),
  goal: z.string().min(1),
  referencePatch: z.string(),
  fullPatchDigest: digest,
  referencePatchDigest: digest,
  sourceDigest: digest,
  contracts: z.strictObject({ sealed: goalContractSchema, "held-back": goalContractSchema }),
  checkProvenance: z.string(),
  referenceNormalization: z.string(),
});
const localInventory = async () => {
  const response = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Local model inventory returned ${response.status}`);
  return z
    .object({
      models: z.array(
        z
          .object({
            name: z.string(),
            digest: z.string(),
            size: z.number(),
            remote_host: z.string().optional(),
            remote_model: z.string().optional(),
          })
          .passthrough(),
      ),
    })
    .parse(await response.json());
};
export function assertLocalModel(inventory, name, expectedDigest) {
  const model = inventory.models.find((candidate) => candidate.name === name);
  if (
    !model ||
    model.remote_host ||
    model.remote_model ||
    /cloud/i.test(name) ||
    (expectedDigest && model.digest !== expectedDigest)
  )
    throw new Error(
      "Frozen local weights are unavailable or changed; remote fallback is prohibited",
    );
  return model;
}
export async function freezePilot(root, admissionRoots) {
  if (await git(sourceRoot, "status", "--porcelain"))
    throw new Error("Commit and test the pilot source before freezing it");
  const sourceCommit = await git(sourceRoot, "rev-parse", "HEAD");
  const frozenSource = resolve(sourceRoot, "../swarm-redesign-baseline");
  const frozenCommit = await git(frozenSource, "rev-parse", "HEAD");
  if (
    frozenCommit !== "a950d1bd51474ec24ec647c3fd9ed3c003dc93b8" ||
    (await git(frozenSource, "status", "--porcelain"))
  )
    throw new Error("The fixed-graph comparison must use the clean historical review source");
  const candidates = new Map();
  for (const admissionRoot of admissionRoots)
    for (const id of pilotCaseIds) {
      let raw;
      try {
        raw = await readFile(join(admissionRoot, id, "case.json"), "utf8");
      } catch (cause) {
        if (cause.code === "ENOENT") continue;
        throw cause;
      }
      const candidate = preparedCaseSchema.parse(JSON.parse(raw));
      const admitted = z
        .object({ admitted: z.boolean(), caseDigest: digest })
        .parse(JSON.parse(await readFile(join(admissionRoot, id, "admission.json"), "utf8")));
      if (admitted.caseDigest !== digestOfJson(asJsonValue(candidate)))
        throw new Error(`${id}: admission refers to different case bytes`);
      if (admitted.admitted) candidates.set(id, candidate);
    }
  if (pilotCaseIds.some((id) => !candidates.has(id)))
    throw new Error(
      `Missing admitted instruments: ${pilotCaseIds.filter((id) => !candidates.has(id)).join(", ")}`,
    );
  const settings = pilotSettingsSchema.parse({
    model: "swarm-redesign-qwen36-32k:latest",
    endpoint: "http://127.0.0.1:11434/v1",
    maxSteps: 24,
    plannerSteps: 12,
    attempts: 1,
    repairAttempts: 2,
    graphRevisions: 4,
    modelConcurrency: 1,
    testConcurrency: 1,
    worktreeConcurrency: 2,
    cleanupMs: 60000,
  });
  const model = assertLocalModel(await localInventory(), settings.model);
  const settingsDigest = digestOfJson(asJsonValue(settings));
  const backendDigest = digestOfJson(
    asJsonValue(
      [...candidates.values()].map((candidate) => ({
        id: candidate.id,
        image: candidate.image,
        hostNode: process.version,
        platform: process.platform,
        arch: process.arch,
      })),
    ),
  );
  const arms = ["single", "frozen-parallel", "adaptive", "no-adaptation", "no-peer"].map(
    (role) => ({
      id: role,
      role,
      model: settings.model,
      backendDigest,
      settingsDigest,
      implementationDigest: digestOfJson({
        sourceCommit,
        controllerCommit: role === "frozen-parallel" ? frozenCommit : sourceCommit,
        role,
      }),
      comparability:
        role === "frozen-parallel"
          ? "Unmodified historical planner and fixed-layer controller. The benchmark adds shared model reservations, serial check slots and frozen dependency setup, then the same independent final verifier. Historical scope, repair and cleanup limitations remain. No native external driver is implied."
          : "Same native worker model, required final verifier, inputs and total budget. Single stays one worker with repair; ablations disable controller adaptation or peer information separately.",
    }),
  );
  const protocol = goalCampaignProtocolSchema.parse({
    version: 2,
    stage: "pilot",
    population:
      "24 maintainer-selected public-history goals across eight repositories, with correlated acceptance instruments and mixed prior exposure; not an independent or random sample",
    samplingUnit: "goal-clustered-by-repository",
    exposure: "previously-exposed",
    cases: [...candidates.values()].map((candidate) => ({
      id: candidate.id,
      repository: candidate.repository,
      baseCommit: candidate.baseCommit,
      sourceLocation: candidate.sourceLink,
      sourceDigest: candidate.sourceDigest,
      oracleDigest: digestOfJson(asJsonValue(candidate.contracts.sealed)),
      heldBackDigest: digestOfJson(asJsonValue(candidate.contracts["held-back"])),
      requirementIds: candidate.contracts.sealed.requirements.map((requirement) => requirement.id),
      category: /refactor/i.test(candidate.goal)
        ? "refactor"
        : /support|add |allow /i.test(candidate.goal)
          ? "feature"
          : "bug-fix",
      language: candidate.language,
      stratum: "natural-history",
      previouslyExposed: candidate.previouslyExposed,
    })),
    arms,
    verifierDigest: digestOfJson({ sourceCommit, policy: "goal-obligations-v1" }),
    budgets: { tokens: 600000, wallMs: 900000 },
    limits: {
      maxSteps: settings.maxSteps,
      attempts: settings.attempts,
      repairAttempts: settings.repairAttempts,
      graphRevisions: settings.graphRevisions,
      modelConcurrency: settings.modelConcurrency,
      testConcurrency: settings.testConcurrency,
      worktreeConcurrency: settings.worktreeConcurrency,
      cleanupMs: settings.cleanupMs,
    },
    seeds: [0],
    order: "rotating-arm-order",
    stopping: "fixed-schedule",
    failureDisposition: "retain-all-scheduled",
    baseline: "single",
    baselineSelectionDigest: digestOfJson({
      selection:
        "same largest locally validated model used by all controlled arms; single worker has repair and the same final verifier",
      developmentSource: "07298dcea0092d727f0b4e4658b87de869270986",
    }),
    comparisonCases: pilotCaseIds,
    targetMedianTimeRatio: 0.75,
    interval: "repository-bootstrap-95-descriptive",
    resamplingSeed: 20260914,
    exclusions: "none-after-freeze",
    competitorDisposition:
      "A separate local-only compatibility admission is required before any competitor launch. Native pilot results do not establish superiority to tools absent from this schedule.",
  });
  await mkdir(root, { mode: 0o700 });
  const frozen = {
    protocol,
    settings,
    sourceCommit,
    frozenCommit,
    frozenSource,
    model,
    candidates: [...candidates.values()],
  };
  await writeFile(join(root, "frozen.json"), JSON.stringify(frozen, null, 2), {
    flag: "wx",
    mode: 0o400,
  });
  console.log(
    JSON.stringify({
      phase: "frozen",
      root,
      sourceCommit,
      goals: protocol.cases.length,
      launches: protocol.cases.length * protocol.arms.length,
      digest: digestOfJson(asJsonValue(frozen)),
    }),
  );
}
export async function runPilot(root, resume) {
  const frozen = JSON.parse(await readFile(join(root, "frozen.json"), "utf8"));
  const protocol = goalCampaignProtocolSchema.parse(frozen.protocol);
  const settings = pilotSettingsSchema.parse(frozen.settings);
  const candidates = z.array(preparedCaseSchema).parse(frozen.candidates);
  if (
    (await git(sourceRoot, "rev-parse", "HEAD")) !== frozen.sourceCommit ||
    (await git(sourceRoot, "status", "--porcelain")) ||
    (await git(frozen.frozenSource, "rev-parse", "HEAD")) !== frozen.frozenCommit ||
    (await git(frozen.frozenSource, "status", "--porcelain"))
  )
    throw new Error(
      "Frozen implementation source changed; preserve the campaign and run from the pinned clean checkouts",
    );
  assertLocalModel(await localInventory(), settings.model, frozen.model.digest);
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "pilot",
    clock,
  });
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(new Error("pilot interrupted"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const launchesRoot = join(root, "launches");
  await mkdir(launchesRoot, { recursive: true, mode: 0o700 });
  try {
    const report = await runFrozenCampaign({
      protocol,
      resume,
      evidence,
      now: () => clock.now(),
      signal: cancellation.signal,
      health: async () => {
        assertLocalModel(await localInventory(), settings.model, frozen.model.digest);
        const processes = (
          await execute("ps", ["-e", "-o", "pid="], {
            env: harnessChildEnvironment().variables,
            timeout: 10000,
          })
        ).stdout
          .trim()
          .split("\n").length;
        return { healthy: true, processes, memoryBytes: freemem(), endpoint: "available" };
      },
      executors: protocol.arms.map((arm) => ({
        id: arm.id,
        implementationDigest: arm.implementationDigest,
        run: async (execution) => {
          const candidate = candidates.find((candidate) => candidate.id === execution.caseId);
          if (!candidate) throw new Error("Scheduled case bytes missing");
          console.log(JSON.stringify({ phase: "launch", ...execution, signal: undefined }));
          return executePilotGoal({
            candidate,
            arm,
            execution,
            root: launchesRoot,
            settings,
            frozenSource: frozen.frozenSource,
          });
        },
      })),
      exportEvidence: async () => {
        await exportBundle({
          source: bundleSourceFromRecorder(evidence),
          destination: join(root, `campaign-bundle-${evidence.head().recordCount}`),
          signingKey: createEphemeralSigningKey(),
          clock,
        });
      },
    });
    await writeFile(
      join(root, `report-${evidence.head().recordCount}.json`),
      JSON.stringify(report, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(JSON.stringify(report));
    return report;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [action, root, ...paths] = process.argv.slice(2);
  if (!root) throw new Error("Supply freeze|run|resume and a campaign directory");
  if (action === "freeze")
    await freezePilot(
      resolve(root),
      paths.map((path) => resolve(path)),
    );
  else if (action === "run" || action === "resume")
    await runPilot(resolve(root), action === "resume");
  else throw new Error("Expected freeze, run or resume");
}

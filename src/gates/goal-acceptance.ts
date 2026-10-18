import { writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createPolicyGuard } from "../tools/policy-guard.ts";
import { retainBehaviorArtifacts } from "./behavior-artifacts.ts";
import { describeCliMismatch, runBehaviorCheck } from "./behavior-check.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import {
  goalArtifactUnchanged,
  prepareGoalArtifact,
  snapshotGoalCheckout,
} from "./goal-checkout.ts";
import { assertGoalEffectsSettled, GoalEffectReconciliationError } from "./goal-effects.ts";

export interface GoalVerification {
  readonly policy: "goal-obligations-v1";
  readonly contractDigest: string;
  readonly tree: string;
  readonly obligations: readonly {
    id: string;
    status: "accepted" | "rejected" | "unjudged";
    checks: readonly string[];
  }[];
  readonly upgradeControl?: { manifestRecord: string; resolution: string };
  readonly purpose?: "base-control" | "candidate";
  readonly presetControl?: { kind: "bugfix" | "refactor"; baseTree: string; accepted: boolean };
  readonly checkResults?: readonly {
    id: string;
    status: "accepted" | "rejected" | "unjudged";
    detail: string;
    record: string;
  }[];
  readonly accepted: boolean;
}

/** Only check definitions enter this fresh verifier boundary; producer observations never do. */
export async function verifyGoal(options: {
  contract: GoalContract;
  evidence: EvidenceRecorder;
  checkout: string;
  tree: string;
  commands: GateCommandRunner;
  timeoutMs: number;
  signal?: AbortSignal;
  upgradeControl?: GoalVerification["upgradeControl"];
  purpose?: "base-control" | "candidate";
  presetControl?: GoalVerification["presetControl"];
}): Promise<GoalVerification> {
  assertGoalEffectsSettled(options.evidence.records(), options.evidence.payloads());
  let pending = false;
  const { contract, digest } = freezeGoalContract(options.contract);
  if (contract.preset?.kind === "upgrade" && options.upgradeControl === undefined)
    throw new Error(
      "upgrade acceptance requires recorded authorization and installed-version evidence",
    );
  const run = (argv: readonly string[]) =>
    options.commands.runVouched(argv, { cwd: options.checkout, timeoutMs: options.timeoutMs });
  const staged = await run(["git", "add", "--all"]);
  const observed = await run(["git", "write-tree"]);
  if (staged.exitCode !== 0 || observed.exitCode !== 0 || observed.stdout.trim() !== options.tree)
    throw new Error("goal verifier checkout does not match the exact integrated tree");
  const checks = new Map<
    string,
    { status: "accepted" | "rejected" | "unjudged"; record: string; detail: string }
  >();
  const snapshot = await snapshotGoalCheckout(options.checkout, options.signal);
  try {
    for (const check of contract.checks) {
      options.signal?.throwIfAborted();
      const restored = await run(["git", "read-tree", "--reset", "-u", options.tree]);
      if (restored.exitCode !== 0)
        throw new Error("cannot restore the candidate for goal acceptance");
      try {
        for (const artifact of check.artifacts) {
          const policy = createPolicyGuard({
            workspaceRoot: options.checkout,
            homeDir: options.evidence.directory,
            deniedRoots: [
              join(options.checkout, ".git"),
              ...(() => {
                const within = relative(options.checkout, options.evidence.directory);
                return within === "" ||
                  (!isAbsolute(within) && within !== ".." && !within.startsWith("../"))
                  ? [options.evidence.directory]
                  : [];
              })(),
            ],
            shellAllowlist: [],
          });
          const permission = policy.checkPath(artifact.path);
          if (!permission.allowed)
            throw new Error(`acceptance artifact refused: ${permission.reason}`);
          const path = await prepareGoalArtifact(options.checkout, artifact.path);
          await writeFile(path, artifact.content, { flag: "wx", mode: 0o400 });
        }
        await options.evidence.record({
          type: "goal-check",
          actor: "harness",
          provenance: ["user"],
          payload: asJsonValue({
            phase: "intent",
            contractDigest: digest,
            checkId: check.id,
            tree: options.tree,
          }),
        });
        pending = true;
        const behavior =
          check.behavior === undefined
            ? undefined
            : await runBehaviorCheck(check.behavior, {
                ...options,
                readOnlyFiles: check.artifacts.map((artifact) =>
                  join(options.checkout, artifact.path),
                ),
              });
        const observation =
          behavior?.observation ??
          (await options.commands.run(check.command, {
            cwd: options.checkout,
            timeoutMs: options.timeoutMs,
          }));
        const artifactDigests =
          check.behavior?.kind === "browser"
            ? await retainBehaviorArtifacts(observation.stdout, options.checkout, options.evidence)
            : [];
        const unchanged = await run(["git", "diff", "--exit-code", options.tree, "--"]);
        const artifactsUnchanged = (
          await Promise.all(
            check.artifacts.map((artifact) =>
              goalArtifactUnchanged(options.checkout, artifact.path, artifact.content),
            ),
          )
        ).every(Boolean);
        const status =
          observation.unavailable !== null ||
          observation.outputTruncated ||
          behavior?.reading.status === "unjudged"
            ? "unjudged"
            : (behavior === undefined
                  ? observation.exitCode === 0
                  : behavior.reading.status === "accepted") &&
                unchanged.exitCode === 0 &&
                artifactsUnchanged
              ? "accepted"
              : "rejected";
        const recorded = await options.evidence.record({
          type: "goal-check",
          actor: "harness",
          provenance: ["tool-output"],
          payload: asJsonValue({
            phase: "completed",
            contractDigest: digest,
            checkId: check.id,
            tree: options.tree,
            author: check.author,
            exposure: check.exposure,
            command: check.command,
            observation,
            artifactDigests,
            ...(behavior === undefined
              ? {}
              : { behavior: check.behavior, behaviorReading: behavior.reading }),
            unchanged: unchanged.exitCode === 0 && artifactsUnchanged,
            status,
          }),
        });
        pending = false;
        checks.set(check.id, {
          status,
          record: recorded.record.payloadDigest,
          detail:
            status === "rejected" && behavior?.reading.status === "accepted"
              ? "the check's assertions held, but running it changed the checked tree or its own artifacts"
              : status === "rejected" &&
                  check.exposure === "shared" &&
                  check.behavior?.kind === "cli"
                ? describeCliMismatch(check.behavior, observation)
                : status === "rejected" &&
                    check.exposure === "shared" &&
                    check.behavior === undefined &&
                    observation.unavailable === null
                  ? describeCommandRefusal(observation)
                  : (behavior?.reading.detail ??
                    observation.unavailable ??
                    `command exited ${observation.exitCode}`),
        });
      } finally {
        if (!pending) await snapshot.restore();
      }
    }
  } catch (cause) {
    if (pending)
      throw new GoalEffectReconciliationError(
        `${options.checkout}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    throw cause;
  } finally {
    if (!pending) await snapshot.dispose();
  }
  // A planned requirement is the planner's hypothesis about the task, not a criterion anyone
  // authorized, so it is no obligation: its generated checks run above and are reported in
  // `checkResults`, and it neither certifies nor refuses. Counted as an unjudged obligation, it
  // made every run that planned checks uncertifiable, whatever the supplied checks established.
  const obligations = contract.requirements
    .filter((requirement) => requirement.planned === undefined)
    .map((requirement) => ({
      id: requirement.id,
      status:
        options.presetControl?.accepted === false ||
        requirement.checks.length === 0 ||
        requirement.checks.some((id) => checks.get(id)?.status === "unjudged")
          ? ("unjudged" as const)
          : requirement.checks.every((id) => checks.get(id)?.status === "accepted")
            ? ("accepted" as const)
            : ("rejected" as const),
      checks: requirement.checks.map((id) => checks.get(id)?.record ?? ""),
    }));
  const verification: GoalVerification = {
    policy: "goal-obligations-v1",
    ...(contract.preset === undefined ? {} : { purpose: options.purpose ?? "candidate" }),
    ...(options.presetControl === undefined ? {} : { presetControl: options.presetControl }),
    contractDigest: digest,
    ...(options.upgradeControl === undefined ? {} : { upgradeControl: options.upgradeControl }),
    tree: options.tree,
    obligations,
    checkResults: [...checks].map(([id, result]) => ({ id, ...result })),
    // A contract of hypotheses alone has no obligation, which accepts nothing rather than all.
    accepted:
      obligations.length > 0 &&
      obligations.every((requirement) => requirement.status === "accepted"),
  };
  await options.evidence.record({
    type: "goal-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(verification),
  });
  return verification;
}

const commandOutputChars = 1500;

/**
 * A shared command check's refusal in its own words: the end of what it printed, where a failing
 * assertion says which case and what it got. "command exited 1" was all a repair was told of a
 * supplied check that refused it, so the worker could not see what to fix. A withheld check is
 * never quoted: what it prints is what it withholds.
 */
function describeCommandRefusal(observation: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  const output = `${observation.stdout}\n${observation.stderr}`.trim();
  return output.length === 0
    ? `command exited ${observation.exitCode}`
    : `command exited ${observation.exitCode}; its output ends:\n${output.length > commandOutputChars ? `...${output.slice(-commandOutputChars)}` : output}`;
}

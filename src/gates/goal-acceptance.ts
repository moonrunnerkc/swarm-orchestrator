import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createPolicyGuard } from "../tools/policy-guard.ts";
import type { GateCommandRunner } from "./gate-definition.ts";

export interface GoalVerification {
  readonly policy: "goal-obligations-v1";
  readonly contractDigest: string;
  readonly tree: string;
  readonly obligations: readonly {
    id: string;
    status: "accepted" | "rejected" | "unjudged";
    checks: readonly string[];
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
}): Promise<GoalVerification> {
  const { contract, digest } = freezeGoalContract(options.contract);
  const run = (argv: readonly string[]) =>
    options.commands.runVouched(argv, { cwd: options.checkout, timeoutMs: options.timeoutMs });
  const staged = await run(["git", "add", "--all"]);
  const observed = await run(["git", "write-tree"]);
  if (staged.exitCode !== 0 || observed.exitCode !== 0 || observed.stdout.trim() !== options.tree)
    throw new Error("goal verifier checkout does not match the exact integrated tree");
  const checks = new Map<
    string,
    { status: "accepted" | "rejected" | "unjudged"; record: string }
  >();
  for (const check of contract.checks) {
    const restored = await run(["git", "read-tree", "--reset", "-u", options.tree]);
    if (restored.exitCode !== 0)
      throw new Error("cannot restore the candidate for goal acceptance");
    const created: string[] = [];
    try {
      for (const artifact of check.artifacts) {
        const policy = createPolicyGuard({
          workspaceRoot: options.checkout,
          homeDir: options.evidence.directory,
          deniedRoots: [join(options.checkout, ".git"), options.evidence.directory],
          shellAllowlist: [],
        });
        const permission = policy.checkPath(artifact.path);
        if (!permission.allowed)
          throw new Error(`acceptance artifact refused: ${permission.reason}`);
        const path = permission.absolutePath;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, artifact.content, { flag: "wx", mode: 0o400 });
        created.push(path);
      }
      const observation = await options.commands.run(check.command, {
        cwd: options.checkout,
        timeoutMs: options.timeoutMs,
      });
      const unchanged = await run(["git", "diff", "--exit-code"]);
      const artifactsUnchanged = (
        await Promise.all(
          check.artifacts.map(async (artifact) => {
            try {
              return (
                (await readFile(join(options.checkout, artifact.path), "utf8")) === artifact.content
              );
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
              throw cause;
            }
          }),
        )
      ).every(Boolean);
      const status =
        observation.unavailable !== null
          ? "unjudged"
          : observation.exitCode === 0 && unchanged.exitCode === 0 && artifactsUnchanged
            ? "accepted"
            : "rejected";
      const recorded = await options.evidence.record({
        type: "goal-check",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({
          contractDigest: digest,
          checkId: check.id,
          tree: options.tree,
          author: check.author,
          exposure: check.exposure,
          command: check.command,
          observation,
          unchanged: unchanged.exitCode === 0 && artifactsUnchanged,
          status,
        }),
      });
      checks.set(check.id, { status, record: recorded.record.payloadDigest });
    } finally {
      for (const path of created) await rm(path, { force: true });
    }
  }
  const obligations = contract.requirements.map((requirement) => ({
    id: requirement.id,
    status:
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
    contractDigest: digest,
    tree: options.tree,
    obligations,
    accepted: obligations.every((requirement) => requirement.status === "accepted"),
  };
  await options.evidence.record({
    type: "goal-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(verification),
  });
  return verification;
}

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import {
  acceptancePackageExecutor,
  acceptancePackageSchema,
} from "../../src/gates/acceptance-package.ts";
import { verifyIndependently } from "../../src/gates/independent-verification.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { diffAgainstBase } from "../../src/gates/scratch-index.ts";
import { testSource } from "./cases.mjs";
import {
  campaignRoot,
  clock,
  exportSession,
  load,
  record,
  save,
  session,
  sourceIdentity,
} from "./evidence.mjs";
import { backend, frozenBase, workspaceFor } from "./execute.mjs";
import { models } from "./model.mjs";

export function contractPackage(one, reference, counterexample) {
  const artifact = testSource(one.checks).replace("'./solution.mjs'", "'../solution.mjs'");
  const artifactDigest = digestOfBytes(artifact);
  const referenceDigest = digestOfBytes(reference);
  const violatingControlDigest = digestOfBytes(counterexample);
  return acceptancePackageSchema.parse({
    contract: {
      version: 1,
      author: `local model ${models.checker}; no independent human review`,
      taskId: one.id,
      exposure: "public",
      immutablePaths: ["package.json", "solution.test.mjs"],
      requirements: [
        {
          id: "pagination-contract",
          artifactDigest,
          argv: ["node", "--test", ".swarm-acceptance/pagination-contract.test.mjs"],
          severity: "required",
          applicable: true,
          referenceDigest,
          violatingControlDigest,
        },
      ],
    },
    artifacts: { [artifactDigest]: artifact },
    patches: { [referenceDigest]: reference, [violatingControlDigest]: counterexample },
  });
}

async function main() {
  const evidence = await session("requirement-contract-controls");
  try {
    if (evidence.records().length)
      throw new Error("contract controls already launched; preserve the observations");
    const one = (await load("cases.json")).find((entry) => entry.id === "check-pages");
    if (!one) throw new Error("check-pages was not admitted; no substitute contract is selected");
    const workspace = await workspaceFor(one, "contract-controls");
    const baseCommit = frozenBase(workspace);
    const patchFor = async (source) => {
      await writeFile(join(workspace, "solution.mjs"), source);
      return diffAgainstBase({ workspaceRoot: workspace, baseRef: baseCommit });
    };
    const reference = await patchFor(one.reference);
    const counterexample = await patchFor(one.counterexample);
    const pack = contractPackage(one, reference, counterexample);
    await save("contracts/package.json", pack);
    await record(evidence, "contract-control-protocol", {
      pack,
      baseCommit,
      candidates: ["reference", "counterexample"],
      expectation: "reference accepted and known omission rejected by pagination-contract",
      exposure:
        "previously withheld vectors now supplied explicitly as requirements; development evidence",
      sources: await sourceIdentity([
        "scripts/local-campaign/contracts.mjs",
        "src/gates/contract-executor.ts",
        "src/gates/acceptance-package.ts",
        "src/gates/independent-verification.ts",
      ]),
    });
    const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
    const commandsForCheckout = async (checkout) =>
      createNodeCommandRunner(clock, harnessChildEnvironment(), backend(checkout, evidence));
    const observations = [];
    for (const [target, patch] of [
      ["reference", reference],
      ["counterexample", counterexample],
    ]) {
      const acceptance = await acceptancePackageExecutor(
        join(campaignRoot, "contracts/package.json"),
        {
          repositoryRoot: workspace,
          baseCommit,
          candidatePatch: patch,
          evidence,
          preparationCommands: commands,
          commands: commandsForCheckout,
          timeoutMs: 30000,
        },
      );
      const verification = await verifyIndependently({
        repositoryRoot: workspace,
        checkoutRoot: evidence.directory,
        baseCommit,
        patch,
        commands,
        commandsForCheckout,
        acceptance,
        clock,
        timeoutMs: 30000,
      });
      await evidence.record({
        type: "independent-verification",
        actor: "harness",
        provenance: ["tool-output"],
        payload: JSON.parse(JSON.stringify(verification)),
      });
      observations.push({ target, verification });
    }
    const passed =
      observations[0].verification.verified &&
      !observations[1].verification.verified &&
      observations[1].verification.acceptance?.obligations[0]?.status === "rejected";
    await save("contracts/summary.json", { passed, observations });
    await record(evidence, "contract-controls-finished", { passed, observations });
    console.log(JSON.stringify({ passed, observations }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await exportSession(evidence);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();

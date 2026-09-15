import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { asJsonValue, digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { freezeGoalContract } from "../../src/evidence/goal-contract.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { verifyIndependently } from "../../src/gates/independent-verification.ts";
import {
  filteredCheck,
  pilotCaseIds,
  pythonCheck,
  pythonGoals,
  pythonTyping,
  sourceCaseSchema,
} from "./pilot-cases.mjs";
import { projectGateOptions, runtimeFor } from "./pilot-runtime.mjs";

const execute = promisify(execFile);
const git = async (cwd, ...argv) =>
  (
    await execute("git", argv, {
      cwd,
      env: harnessChildEnvironment().variables,
      timeout: 30000,
      maxBuffer: 64000000,
    })
  ).stdout;
export function instrumentContract(candidate, exposure, content) {
  const python = candidate.language === "python";
  const sourcePath = python ? "swarm_acceptance.py" : candidate.testFile;
  if (!sourcePath) throw new Error(`${candidate.id}: missing acceptance location`);
  const path = join(
    dirname(sourcePath),
    `swarm_${exposure.replaceAll("-", "_")}_${basename(sourcePath)}`,
  );
  const runtimeCommand = python
    ? `python3 ${path}`
    : filteredCheck(
        candidate,
        path,
        exposure === "sealed" ? candidate.sealedCases : candidate.heldBackCases,
      );
  const typing = pythonTyping[candidate.id];
  const typingPath = path.replace(/\.py$/, "_typing.py");
  const command = runtimeCommand + (typing ? ` && mypy ${typingPath}` : "");
  return freezeGoalContract({
    version: 1,
    goal: candidate.goal,
    requirements: [{ id: "requested-behavior", description: candidate.goal, checks: ["behavior"] }],
    checks: [
      {
        id: "behavior",
        command,
        author: python ? "model" : "user",
        exposure: "withheld",
        artifacts: [{ path, content }, ...(typing ? [{ path: typingPath, content: typing }] : [])],
      },
    ],
    immutablePaths: candidate.immutablePaths,
    selection: "stable",
  }).contract;
}

export async function preparePilot({
  root,
  preparationRoot,
  repositoriesRoot,
  runtimeRoot,
  ids = pilotCaseIds,
}) {
  const sources = z
    .array(sourceCaseSchema)
    .parse(JSON.parse(await readFile(join(preparationRoot, "candidates.json"), "utf8")).candidates);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !sources.some((candidate) => candidate.id === id))
  )
    throw new Error("Preparation contains duplicate or unavailable case identities");
  await mkdir(root, { mode: 0o700 });
  const checkoutRoot = join(root, "checkouts");
  await mkdir(checkoutRoot, { mode: 0o700 });
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "admission",
    clock,
  });
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(new Error("pilot preparation interrupted"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const observations = [];
  try {
    for (const id of ids) {
      cancellation.signal.throwIfAborted();
      const source = sources.find((candidate) => candidate.id === id);
      const clone = join(repositoriesRoot, source.repository.replace("/", "--"));
      const paths = (await git(clone, "ls-tree", "-r", "--name-only", source.baseCommit))
        .trim()
        .split("\n");
      const immutablePaths = paths.filter((path) =>
        /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|setup\.(?:py|cfg)|tox\.ini|uv\.lock|(?:jest|vitest|tsconfig|babel|eslint|prettier)\.[^/]+|\.(?:eslintrc|prettierrc)[^/]*)$/.test(
          path,
        ),
      );
      const image =
        source.language === "python"
          ? JSON.parse(
              await readFile(
                join(
                  runtimeRoot,
                  id,
                  ...(source.repository === "pallets/click" ? ["pager-runtime-2"] : []),
                  "image.json",
                ),
                "utf8",
              ),
            ).image
          : source.repository === "iamkun/dayjs"
            ? "sha256:cd59a61258b82b86c1ff0ead50c8a689f6c3483c5ed21036e11ee741add419eb"
            : null;
      const candidate = {
        ...source,
        clone,
        image,
        immutablePaths,
        goal: pythonGoals[id]?.goal ?? source.taskText.replaceAll("\u2014", ","),
      };
      const directory = join(root, id);
      await mkdir(directory, { mode: 0o700 });
      const fullPatch = await git(clone, "diff", "--binary", source.baseCommit, source.mergeCommit);
      const referencePatch = await git(
        clone,
        "diff",
        "--binary",
        source.baseCommit,
        source.mergeCommit,
        "--",
        ".",
        ...immutablePaths.map((path) => `:(exclude)${path}`),
      );
      const contracts = {};
      for (const exposure of ["sealed", "held-back"]) {
        const content =
          source.language === "python"
            ? pythonCheck(id, exposure)
            : await git(clone, "show", `${source.mergeCommit}:${source.testFile}`);
        contracts[exposure] = instrumentContract(candidate, exposure, content);
      }
      const prepared = {
        ...candidate,
        referencePatch,
        fullPatchDigest: digestOfBytes(fullPatch),
        referencePatchDigest: digestOfBytes(referencePatch),
        sourceDigest: digestOfJson(asJsonValue(source)),
        contracts,
        checkProvenance:
          source.language === "python"
            ? "Maintainer model-authored public-API checks; input variants share reasoning and are not independent ground truth."
            : "Historical PR tests split by recorded case names; both partitions share authorship, imports and setup. This is incomplete executable coverage of the prose goal, not independent validation of all intent.",
        referenceNormalization:
          "Preserve frozen base manifests, lockfiles and check configuration. Release metadata and unrelated tool updates in the historical patch are omitted; admission must demonstrate the remaining reference under these exact definitions.",
      };
      await writeFile(join(directory, "case.json"), JSON.stringify(prepared, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      await evidence.record({
        type: "campaign-protocol",
        actor: "harness",
        provenance: ["file", "model"],
        payload: asJsonValue({ phase: "instrument-admission", id, ...prepared }),
      });
      const measured = [];
      for (const target of ["base", "reference"])
        for (const exposure of ["sealed", "held-back"]) {
          const patch = target === "base" ? "" : referencePatch;
          const commandsForCheckout = async (checkout) =>
            runtimeFor({
              candidate,
              workspace: checkout,
              evidence,
              clock,
              signal: cancellation.signal,
            }).commands;
          const tree =
            target === "base"
              ? (await git(clone, "rev-parse", `${source.baseCommit}^{tree}`)).trim()
              : null;
          // The independent path applies the normalized patch before computing this exact tree.
          const verification = await verifyIndependently({
            repositoryRoot: clone,
            checkoutRoot,
            baseCommit: source.baseCommit,
            patch,
            immutablePaths,
            clock,
            signal: cancellation.signal,
            timeoutMs: 180000,
            commands: runtimeFor({
              candidate: { ...candidate, image: null },
              workspace: clone,
              evidence,
              clock,
              signal: cancellation.signal,
            }).commands,
            commandsForCheckout,
            goal: {
              contract: contracts[exposure],
              evidence,
              tree:
                tree ?? (await normalizedTree(clone, source.baseCommit, referencePatch, directory)),
            },
            installDependencies: source.language !== "python",
            repositoryChecks: "skip",
            gateOptions: projectGateOptions(candidate),
          });
          const observed = { target, exposure, verification };
          measured.push(observed);
          await evidence.record({
            type: "campaign-observation",
            actor: "harness",
            provenance: ["tool-output"],
            payload: asJsonValue({ id, ...observed }),
          });
          console.log(
            JSON.stringify({
              id,
              target,
              exposure,
              task: verification.task,
              refusal: verification.refusal,
              advice: verification.advice,
            }),
          );
        }
      const admitted =
        measured
          .filter((item) => item.target === "base")
          .every((item) => item.verification.task === "rejected") &&
        measured
          .filter((item) => item.target === "reference")
          .every((item) => item.verification.task === "accepted");
      const observation = {
        id,
        admitted,
        measured,
        caseDigest: digestOfJson(asJsonValue(prepared)),
      };
      observations.push(observation);
      await writeFile(join(directory, "admission.json"), JSON.stringify(observation, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
    }
    await writeFile(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        admitted: observations.filter((item) => item.admitted).length,
        total: observations.length,
        head: evidence.head(),
      }),
    );
    return observations;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
async function normalizedTree(clone, base, patch, directory) {
  const index = join(directory, "reference.index");
  const patchPath = join(directory, "reference.patch");
  try {
    await writeFile(patchPath, patch, { flag: "wx", mode: 0o600 });
  } catch (cause) {
    if (cause.code !== "EEXIST") throw cause;
    if ((await readFile(patchPath, "utf8")) !== patch) throw new Error("Reference bytes changed");
  }
  const run = async (argv) =>
    (
      await execute("git", argv, {
        cwd: clone,
        env: { ...harnessChildEnvironment().variables, GIT_INDEX_FILE: index },
        timeout: 30000,
        maxBuffer: 64000000,
      })
    ).stdout;
  await run(["read-tree", base]);
  await run(["apply", "--cached", patchPath]);
  return (await run(["write-tree"])).trim();
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [root, preparationRoot, repositoriesRoot, runtimeRoot, ...ids] = process.argv.slice(2);
  if (!root || !preparationRoot || !repositoriesRoot || !runtimeRoot)
    throw new Error(
      "Supply a new output directory, candidate metadata, repository clones and runtime images.",
    );
  await preparePilot({
    root: resolve(root),
    preparationRoot: resolve(preparationRoot),
    repositoriesRoot: resolve(repositoriesRoot),
    runtimeRoot: resolve(runtimeRoot),
    ...(ids.length ? { ids } : {}),
  });
}

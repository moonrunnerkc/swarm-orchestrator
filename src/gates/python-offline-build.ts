import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import {
  archiveExtractScript,
  archiveFetchScript,
  buildSystemOf,
  isPlainRequirement,
  type PythonBuildSystem,
  pep517BuildScript,
  type UvSourceBuild,
  uvEditableProject,
  uvEnvironmentPython,
  uvSourceBuilds,
  wheelFileName,
} from "./deferred-setup.ts";
import {
  type DeferredWork,
  type FollowUpContext,
  notRunOffline,
  type OfflineProof,
  offlineProbe,
  outputTail,
  type SetupEffectOutcome,
} from "./setup-effect.ts";

/** Where the Python build frontend keeps archives, requirements and wheels, inside uv's own ignored .venv. */
const pythonBuildRoot = ".venv/.swarm-build";
const rootProjectLabel = "the project's own editable install";

/**
 * Everything the lockfile install left unbuilt, built the way uv would, with nothing
 * registry-served executed while the network is reachable. The lockfile install ran with
 * `--no-build` and left these packages out; here a source archive's bytes are fetched and checked
 * against the lockfile's hash, each build backend's wheels are fetched without being run
 * (`--only-binary :all:`, into a target directory, by the image's interpreter rather than the
 * environment that holds the project's packages), and every backend runs offline where the
 * checks run, as does the install of what it built. Tests then import the packages and find
 * their console scripts.
 */
export async function uvDeferredWork(context: FollowUpContext): Promise<DeferredWork | null> {
  const project = await uvEditableProject(context.workspace);
  const plan = await uvSourceBuilds(context.workspace);
  if (project === null && plan.builds.length === 0 && plan.leftOut.length === 0) return null;
  const details = plan.leftOut.map(
    (entry) =>
      `${entry.name} was left out of the install: ${entry.reason}, so a check that needs it cannot pass`,
  );
  const units: { label: string; build: () => Promise<Built> }[] = [];
  if (project?.kind === "refused")
    details.push(`${rootProjectLabel} did not run: ${project.reason}`);
  const finish = (): DeferredWork | null =>
    details.length === 0 ? null : { detail: details.join("; "), sourceChanged: false };
  const python = await uvEnvironmentPython(context.workspace);
  const pending = [
    ...plan.builds.map(labelOf),
    ...(project?.kind === "editable" ? [rootProjectLabel] : []),
  ];
  if (pending.length === 0) return finish();
  if (python === null) {
    details.push(
      `${pending.join(", ")} did not run: .venv/pyvenv.cfg names no interpreter version`,
    );
    return finish();
  }
  const { proof, probe } = await offlineProbe(context);
  if (proof === null) {
    details.push(notRunOffline(pending.join(", "), probe));
    return finish();
  }
  const builder = { context, python, proof };
  plan.builds.forEach((build, index) => {
    units.push({
      label: labelOf(build),
      build: () =>
        build.kind === "archive"
          ? buildArchive(builder, build, `${index}`)
          : buildTree(builder, {
              label: labelOf(build),
              source: join(context.workspace, build.path),
              kind: build.editable ? "editable" : "wheel",
              slot: `${index}`,
            }),
    });
  });
  if (project?.kind === "editable")
    units.push({
      label: rootProjectLabel,
      build: () =>
        buildTree(builder, {
          label: rootProjectLabel,
          source: context.workspace,
          kind: "editable",
          slot: "project",
          system: project,
        }),
    });
  const buildRoot = join(context.workspace, pythonBuildRoot);
  await rm(buildRoot, { recursive: true, force: true });
  try {
    for (const unit of units) {
      const built = await unit.build();
      details.push(built.detail);
      if (built.sourceChanged) return { detail: details.join("; "), sourceChanged: true };
    }
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
  return finish();
}

interface Built {
  readonly detail: string;
  readonly sourceChanged: boolean;
}

interface Builder {
  readonly context: FollowUpContext;
  readonly python: string;
  readonly proof: OfflineProof;
}

function labelOf(build: UvSourceBuild): string {
  return build.kind === "archive"
    ? `${build.name} ${build.version} (a source archive only)`
    : build.editable
      ? `workspace member ${build.name}`
      : `local package ${build.name}`;
}

function failedStep(label: string, outcome: SetupEffectOutcome): Built {
  return {
    detail: outcome.sourceChanged ? outcome.detail : `${label} did not complete: ${outcome.detail}`,
    sourceChanged: outcome.sourceChanged,
  };
}

/**
 * A registry release that ships only a source archive: its bytes fetched with the registry
 * access the install had and nothing run, checked against the lockfile's sha256 by the fetch and
 * again here, unpacked offline, then built like any other tree.
 */
async function buildArchive(
  builder: Builder,
  build: Extract<UvSourceBuild, { kind: "archive" }>,
  slot: string,
): Promise<Built> {
  const { context, proof } = builder;
  const label = labelOf(build);
  const archive = `${pythonBuildRoot}/${slot}/archive/${build.file}`;
  const unpacked = `${pythonBuildRoot}/${slot}/source`;
  const fetched = await context.effect({
    argv: ["python3", "-I", "-S", "-c", archiveFetchScript, build.url, archive, build.hash],
    network: "registry",
    stage: "source-archive",
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${build.file} fetched as bytes and matched the lockfile's ${build.hash}, nothing executed`
        : `${build.file} could not be fetched and matched to the lockfile (exit ${observed.exitCode}): ${outputTail(observed)}`,
  });
  if (!fetched.succeeded) return failedStep(label, fetched);
  let digest = "";
  try {
    digest = digestOfBytes(await readFile(join(context.workspace, archive)));
  } catch {
    digest = "";
  }
  if (digest !== build.hash)
    return {
      detail: `${label} did not complete: the fetched archive's digest ${digest || "(unreadable)"} is not the lockfile's ${build.hash}`,
      sourceChanged: false,
    };
  const extracted = await context.effect({
    argv: ["python3", "-I", "-S", "-c", archiveExtractScript, archive, unpacked],
    network: "none",
    stage: "offline-lifecycle",
    networkProbe: proof,
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${build.file} unpacked offline`
        : `${build.file} could not be unpacked (exit ${observed.exitCode}): ${outputTail(observed)}`,
  });
  if (!extracted.succeeded) return failedStep(label, extracted);
  let entries: string[] = [];
  try {
    entries = (await readdir(join(context.workspace, unpacked), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    entries = [];
  }
  if (entries.length !== 1)
    return {
      detail: `${label} did not complete: the archive does not unpack to one source directory`,
      sourceChanged: false,
    };
  return buildTree(builder, {
    label,
    source: join(context.workspace, unpacked, entries[0] as string),
    kind: "wheel",
    slot,
  });
}

/**
 * One source tree built into a wheel (or an editable wheel) and installed, each command that
 * runs the backend offline and each fetch of its requirements a recorded effect of its own.
 */
async function buildTree(
  builder: Builder,
  unit: {
    readonly label: string;
    readonly source: string;
    readonly kind: "editable" | "wheel";
    readonly slot: string;
    readonly system?: PythonBuildSystem;
  },
): Promise<Built> {
  const { context, python, proof } = builder;
  const system = unit.system ?? (await buildSystemOf(unit.source));
  if ("refused" in system)
    return { detail: `${unit.label} did not run: ${system.refused}`, sourceChanged: false };
  const backendDirectory = `${pythonBuildRoot}/${unit.slot}/backend`;
  const wheelDirectory = `${pythonBuildRoot}/${unit.slot}/wheel`;
  // The backend runs in its own tree; everything it is handed is named relative to it.
  const fromSource = (path: string) => relative(unit.source, join(context.workspace, path)) || ".";
  const directory = relative(context.workspace, unit.source);
  const fetch = (requirements: readonly string[]) =>
    context.effect({
      argv: [
        "uv",
        "pip",
        "install",
        "--system",
        "--target",
        backendDirectory,
        "--only-binary",
        ":all:",
        "--python-version",
        python,
        "--",
        ...requirements,
      ],
      network: "registry",
      stage: "build-requirements",
      describe: ({ observed, succeeded }) =>
        succeeded
          ? `build requirements ${requirements.join(", ")} fetched as wheels, nothing executed`
          : `build requirements ${requirements.join(", ")} could not be fetched as wheels (exit ${observed.exitCode}): ${outputTail(observed)}`,
    });
  const hook = (mode: "requires" | "build") =>
    context.effect({
      argv: [
        fromSource(".venv/bin/python"),
        "-I",
        "-S",
        "-c",
        pep517BuildScript,
        mode,
        unit.kind,
        fromSource(backendDirectory),
        fromSource(wheelDirectory),
        system.backend,
        ...system.backendPath,
      ],
      network: "none",
      stage: "offline-lifecycle",
      ...(directory === "" ? {} : { directory }),
      networkProbe: proof,
      describe: ({ observed, succeeded }) =>
        succeeded
          ? `${system.backend} ${mode === "requires" ? `named its ${unit.kind} requirements` : `built the ${unit.kind} wheel`} offline where the checks run (network measured off)`
          : `${system.backend} failed offline (${mode === "requires" ? `naming its ${unit.kind} requirements` : `building the ${unit.kind} wheel`}, exit ${observed.exitCode}): ${outputTail(observed)}`,
    });
  const declared = await fetch(system.requires);
  if (!declared.succeeded) return failedStep(unit.label, declared);
  const named = await hook("requires");
  if (!named.succeeded) return failedStep(unit.label, named);
  let extra: unknown;
  try {
    extra = JSON.parse(named.observed.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    extra = null;
  }
  if (
    !Array.isArray(extra) ||
    !extra.every((entry) => typeof entry === "string" && isPlainRequirement(entry))
  )
    return {
      detail: `${unit.label} did not complete: the backend named build requirements that are not plain registry requirements`,
      sourceChanged: false,
    };
  if (extra.length > 0) {
    const fetched = await fetch(extra as string[]);
    if (!fetched.succeeded) return failedStep(unit.label, fetched);
  }
  const built = await hook("build");
  if (!built.succeeded) return failedStep(unit.label, built);
  const wheel = built.observed.stdout.trim().split("\n").at(-1) ?? "";
  if (!wheelFileName.test(wheel))
    return {
      detail: `${unit.label} did not complete: the backend named no wheel file`,
      sourceChanged: false,
    };
  const installed = await context.effect({
    argv: [
      "uv",
      "pip",
      "install",
      "--offline",
      "--no-deps",
      "--python",
      ".venv/bin/python",
      `${wheelDirectory}/${wheel}`,
    ],
    network: "none",
    stage: "offline-lifecycle",
    networkProbe: proof,
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${unit.label} built by ${system.backend} and installed offline where the checks run (network measured off)`
        : `${unit.label} could not be installed offline (exit ${observed.exitCode}): ${outputTail(observed)}`,
  });
  return installed.succeeded
    ? { detail: installed.detail, sourceChanged: false }
    : failedStep(unit.label, installed);
}

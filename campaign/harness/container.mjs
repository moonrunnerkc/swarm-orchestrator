/**
 * Every docker invocation the campaign makes, as an argument vector built here and spawned
 * directly: no shell between the harness and the process, the same discipline the coverage
 * arm applies and for the same reason. Images are named by digest. A run's container is on
 * an internal network whose only other member is the forwarder for its arm's backend, so
 * "no network beyond the model backend" is a property of the network rather than a request.
 */
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { budgets } from "./criteria.mjs";

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const imageDigests = Object.freeze({
  node: "node@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2",
  python: "python@sha256:581429e3df12d76e6af4be5ab7d0e7fc2013eb57dc23d2de691411c8efdbb970",
  go: "golang@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b",
  rust: "rust@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1",
  forwarder: "alpine/socat@sha256:a6be4c0262b339c53ddad723cdd178a1a13271e1137c65e27f90a08c16de02b8",
});

export const imageTags = Object.freeze({
  node: "campaign-node",
  python: "campaign-python",
  go: "campaign-go",
  rust: "campaign-rust",
});

export const internalNetwork = "campaign-internal";
export const hostGateway = "host.docker.internal";

export function forwarderName(arm) {
  return `campaign-backend-${arm.port}`;
}

export function createNetworkArgv() {
  return ["docker", "network", "create", "--internal", internalNetwork];
}

/**
 * The label every campaign image carries naming the CLI tarball it installed, by digest. A
 * result record reads it back from the image the run used, so which CLI a bundle measures is
 * a fact about the image rather than a note about the tree.
 */
export const cliTarballLabel = "org.swarm-orchestrator.cli.tarball-sha256";

const sha256Hex = /^[0-9a-f]{64}$/;

/** The tarball has to sit inside the build context, so the driver copies it there first. */
export function buildImageArgv({ type, imagesDirectory, tarball, tarballSha256 }) {
  if (!sha256Hex.test(tarballSha256 ?? "")) {
    throw new Error(`an image build needs the tarball's sha256 to label it with, got ${JSON.stringify(tarballSha256)}`);
  }
  return [
    "docker",
    "build",
    "--file",
    `${imagesDirectory}/Dockerfile.${type}`,
    "--build-arg",
    `SWARM_TARBALL=${basename(tarball)}`,
    "--build-arg",
    `SWARM_TARBALL_SHA256=${tarballSha256}`,
    "--tag",
    imageTags[type],
    imagesDirectory,
  ];
}

export function imageLabelArgv(type) {
  return ["docker", "image", "inspect", "--format", `{{index .Config.Labels "${cliTarballLabel}"}}`, imageTags[type]];
}

export function imageIdArgv(type) {
  return ["docker", "image", "inspect", "--format", "{{.Id}}", imageTags[type]];
}

/**
 * What a result records about the CLI, from what the image said. An image built before the
 * label existed answers with nothing, and that is recorded as not known rather than guessed
 * from the tree, since the tree is not what ran.
 */
export function cliRecordFromLabel(inspectOutput) {
  const value = (inspectOutput ?? "").trim();
  if (sha256Hex.test(value)) {
    return { tarballSha256: value };
  }
  return { tarballSha256: null, reason: "the image carries no CLI tarball label, so which CLI it holds is not known from the image" };
}

/**
 * Two commands: start the forwarder on the internal network, then attach it to the bridge
 * so it can reach the host. Its listener is the one address a run can reach.
 *
 * A local arm's forwarder is an HTTP relay, `forwarder.mjs` run from the node image, because
 * Ollama refuses a request whose Host header names anything but its own loopback and a TCP
 * relay carries the container's name there. A frontier arm's forwarder stays a TCP relay,
 * since TLS has to pass through it untouched.
 */
export function forwarderArgv(arm, harnessDirectory = HARNESS_DIRECTORY) {
  const start = arm.frontier
    ? [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--name",
        forwarderName(arm),
        "--network",
        internalNetwork,
        imageDigests.forwarder,
        `TCP-LISTEN:${arm.port},fork,reuseaddr`,
        `TCP:${arm.host}:${arm.port}`,
      ]
    : [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--name",
        forwarderName(arm),
        "--network",
        internalNetwork,
        "--volume",
        `${harnessDirectory}/forwarder.mjs:/forwarder.mjs:ro`,
        imageTags.node,
        "node",
        "/forwarder.mjs",
        String(arm.port),
        hostGateway,
      ];
  return [start, ["docker", "network", "connect", "bridge", forwarderName(arm)]];
}

export function stopForwarderArgv(arm) {
  return ["docker", "stop", forwarderName(arm)];
}

/**
 * Where each toolchain keeps what preparation fetched. A container is gone when its run
 * ends, so every cache lives under the mounted workspace, in a directory the workspace's
 * git is told to ignore; the offline runs then find what the one networked run installed.
 */
export const workspaceCacheDirectory = ".campaign";

export function typeEnvironment(type) {
  const cache = `/work/${workspaceCacheDirectory}`;
  switch (type) {
    case "node":
      return [`COREPACK_HOME=${cache}/corepack`, `npm_config_store_dir=${cache}/pnpm-store`];
    case "python":
      return [`PATH=${cache}/venv/bin:/usr/local/bin:/usr/bin:/bin`, `VIRTUAL_ENV=${cache}/venv`];
    case "go":
      return [`GOMODCACHE=${cache}/gomod`, `GOCACHE=${cache}/gocache`, "GOFLAGS=-modcacherw"];
    case "rust":
      return [`CARGO_HOME=${cache}/cargo`];
    default:
      throw new Error(`no toolchain environment is defined for ${type}`);
  }
}

/**
 * An arm run holds the CLI, the suite it runs, and the probes and coverage cycle the gates
 * spawn beside it, which is more than the suite alone that selection measured under the
 * sealed 4 GB. Sized separately, and named in the methodology's amendment of 2026-09-03.
 */
export const armMemoryGigabytes = 8;

function runArgv({ type, workspace, network, argv, mounts = [], environment = [], hosts = [], timeoutSeconds, memoryGigabytes = budgets.containerMemoryGigabytes }) {
  return [
    "docker",
    "run",
    "--rm",
    "--network",
    network,
    "--cpus",
    String(budgets.containerCpus),
    "--memory",
    `${memoryGigabytes}g`,
    "--volume",
    `${workspace}:/work`,
    ...mounts.flatMap((mount) => ["--volume", `${mount.host}:${mount.container}`]),
    ...environment.flatMap((entry) => ["--env", entry]),
    ...hosts.flatMap((entry) => ["--add-host", entry]),
    "--workdir",
    "/work",
    "--env",
    "HOME=/home/campaign",
    ...typeEnvironment(type).flatMap((entry) => ["--env", entry]),
    imageTags[type],
    "timeout",
    "--signal=KILL",
    String(timeoutSeconds),
    ...argv,
  ];
}

/** Preparation, with the network on: the one time a run's tree may fetch anything. */
export function prepareArgv({ type, workspace, argv }) {
  return runArgv({
    type,
    workspace,
    network: "bridge",
    argv,
    timeoutSeconds: budgets.installTimeoutMinutes * 60,
  });
}

/** Everything after preparation: the suite, the seed attempts, the arm runs, the checks. */
export function offlineArgv({ type, workspace, argv, mounts, timeoutSeconds }) {
  return runArgv({
    type,
    workspace,
    network: internalNetwork,
    argv,
    mounts,
    timeoutSeconds: timeoutSeconds ?? budgets.suiteTimeoutMinutes * 60,
  });
}

/**
 * The arm run itself: the packaged CLI inside the container, pointed at the forwarder by
 * name, writing its bundle to a mounted output directory. A frontier arm's key travels as
 * an environment variable the harness read from its own environment, never from a file in
 * the workspace, and the container resolves the provider's host to the forwarder.
 */
/**
 * What the CLI may spend on its loops inside a run's container budget: the budget less the
 * suite's own timeout and two minutes, so the final gates and the bundle export have room
 * to finish before the container is killed. A run that reaches this ends as a wall-time stop
 * with its gates run and its bundle written; under the first campaign's CLI the same run
 * ended as a kill with nothing.
 */
export function wallBudgetMinutes(timeoutMinutes) {
  const minutes = timeoutMinutes - budgets.suiteTimeoutMinutes - 2;
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(`a ${timeoutMinutes} minute container budget leaves no wall budget after the ${budgets.suiteTimeoutMinutes} minute suite timeout and two minutes to export`);
  }
  return minutes;
}

export function armRunArgv({ type, workspace, outputDirectory, arm, task, maxSteps, attempts, timeoutSeconds, forwarderAddress, key }) {
  const swarm = [
    "swarm",
    "--workspace",
    "/work",
    "--model",
    arm.model,
    ...(arm.frontier ? [] : ["--local-endpoint", `http://${forwarderName(arm)}:${arm.port}/v1`]),
    "--bundle",
    "/out/bundle",
    "--max-steps",
    String(maxSteps),
    "--attempts",
    String(attempts),
    "--max-wall-minutes",
    String(wallBudgetMinutes(timeoutSeconds / 60)),
    "--no-tui",
    "--no-open-evidence",
    task,
  ];
  return runArgv({
    type,
    workspace,
    network: internalNetwork,
    argv: swarm,
    mounts: [{ host: outputDirectory, container: "/out" }],
    environment: arm.frontier ? [`${arm.keyVariable}=${key}`] : [],
    hosts: arm.frontier ? [`${arm.host}:${forwarderAddress}`] : [],
    timeoutSeconds,
    memoryGigabytes: armMemoryGigabytes,
  });
}

export function forwarderAddressArgv(arm) {
  return [
    "docker",
    "inspect",
    "--format",
    `{{(index .NetworkSettings.Networks "${internalNetwork}").IPAddress}}`,
    forwarderName(arm),
  ];
}

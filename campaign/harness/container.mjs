/**
 * Every docker invocation the campaign makes, as an argument vector built here and spawned
 * directly: no shell between the harness and the process, the same discipline the coverage
 * arm applies and for the same reason. Images are named by digest. A run's container is on
 * an internal network whose only other member is the forwarder for its arm's backend, so
 * "no network beyond the model backend" is a property of the network rather than a request.
 */
import { basename } from "node:path";
import { budgets } from "./criteria.mjs";

export const imageDigests = Object.freeze({
  node: "node@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2",
  python: "python@sha256:581429e3df12d76e6af4be5ab7d0e7fc2013eb57dc23d2de691411c8efdbb970",
  go: "golang@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db",
  rust: "rust@sha256:d9c3c6f1264a547d84560e06ffd79ed7a799ce0bff0980b26cf10d29af888377",
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

/** The tarball has to sit inside the build context, so the driver copies it there first. */
export function buildImageArgv({ type, imagesDirectory, tarball }) {
  return [
    "docker",
    "build",
    "--file",
    `${imagesDirectory}/Dockerfile.${type}`,
    "--build-arg",
    `SWARM_TARBALL=${basename(tarball)}`,
    "--tag",
    imageTags[type],
    imagesDirectory,
  ];
}

/**
 * Two commands: start the forwarder on the internal network, then attach it to the bridge
 * so it can reach the host. Its listener is the one address a run can reach.
 */
export function forwarderArgv(arm) {
  const upstream = arm.frontier ? arm.host : hostGateway;
  return [
    [
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
      `TCP:${upstream}:${arm.port}`,
    ],
    ["docker", "network", "connect", "bridge", forwarderName(arm)],
  ];
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

function runArgv({ type, workspace, network, argv, mounts = [], environment = [], hosts = [], timeoutSeconds }) {
  return [
    "docker",
    "run",
    "--rm",
    "--network",
    network,
    "--cpus",
    String(budgets.containerCpus),
    "--memory",
    `${budgets.containerMemoryGigabytes}g`,
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

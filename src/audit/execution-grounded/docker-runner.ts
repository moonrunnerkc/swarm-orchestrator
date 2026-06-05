// Optional docker isolation for the execution-grounded layer. When the audit
// config sets `executionGrounded.runner: docker`, the commands that execute a
// PR's own (untrusted) code -- mutation, coverage, issue-repro -- run inside a
// container built from the repo Dockerfile instead of directly on the host,
// with only the checkout bind-mounted and the network locked down by default.
//
// Provisioning (clone, install) stays on the host: install's postinstall
// scripts are untrusted too, but their host secrets are already scrubbed by
// execEnv, and containerizing the install plus its node_modules over a bind
// mount adds failure modes (monorepo install dirs, native-module glibc) for
// less marginal benefit. Containerizing the install is a documented follow-up;
// this module covers the test-execution surface.
//
// This file is the wrapper only: an availability probe, network and image
// resolution, and the pure `docker run` argv builder. execFileGuarded consumes
// the argv builder; nothing here imports exec-env, so there is no cycle.

import { execFileSync } from 'child_process';

export interface DockerContext {
  /** Image the sandboxed command runs in (built from the repo Dockerfile). */
  image: string;
  /** Docker network mode for the container. `none` locks out the network. */
  network: string;
}

const DEFAULT_IMAGE_TAG = 'swarm-orchestrator:audit';

/** Resolve the sandbox image tag: `SWARM_EG_DOCKER_IMAGE` when set, else the
 *  default tag an operator builds from the repo Dockerfile. */
export function resolveDockerImage(): string {
  const fromEnv = process.env.SWARM_EG_DOCKER_IMAGE;
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : DEFAULT_IMAGE_TAG;
}

/** Network mode for the untrusted-execution container. Locked to `none` by
 *  default so a PR's test code cannot reach the network; an operator whose
 *  suite needs it (a localhost service, a registry) overrides
 *  `SWARM_EG_DOCKER_NETWORK`. */
export function dockerSandboxNetwork(): string {
  const value = process.env.SWARM_EG_DOCKER_NETWORK;
  return value !== undefined && value.trim().length > 0 ? value.trim() : 'none';
}

/** True when the docker CLI is installed and its daemon answers. `docker
 *  version` (not `--version`) round-trips to the daemon, so a CLI with no
 *  daemon reads as unavailable, which is correct: we could not run a container. */
export function dockerAvailable(dockerBin = 'docker'): boolean {
  try {
    execFileSync(dockerBin, ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** True when the named image is present locally, so the audit can run it
 *  without a build or pull mid-run. */
export function dockerImagePresent(image: string, dockerBin = 'docker'): boolean {
  try {
    execFileSync(dockerBin, ['image', 'inspect', image], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Why the docker runner cannot run, or null when it can. Pure, so the gate is
 * testable without a docker daemon. The deliberate design: when docker is
 * requested but unavailable, the execution-grounded layer is skipped, never
 * silently moved back to the host. An operator who asked for container
 * isolation must not have untrusted code run unsandboxed behind their back.
 */
export function dockerSkipReason(opts: {
  runnerRequested: boolean;
  dockerOk: boolean;
  imageOk: boolean;
  image: string;
}): string | null {
  if (!opts.runnerRequested) return null;
  if (!opts.dockerOk) {
    return 'executionGrounded.runner is docker but the docker daemon is not available; skipping (no host fallback when isolation was requested)';
  }
  if (!opts.imageOk) {
    return `executionGrounded.runner is docker but image ${opts.image} is not built; run \`docker build -t ${opts.image} .\` in the swarm-orchestrator checkout first`;
  }
  return null;
}

export interface DockerRunArgsInput {
  image: string;
  network: string;
  /** Host directory bind-mounted into the container at the same absolute path. */
  checkoutDir: string;
  /** Working directory inside the container (under the bind mount). */
  workdir: string;
  /** Environment injected into the container via `-e`. Host PATH/HOME are NOT
   *  forwarded: the image provides its own. */
  env: Readonly<Record<string, string>>;
  /** Run as this `uid:gid` so files written to the bind mount keep host
   *  ownership. Omitted on platforms without POSIX uids. */
  user?: string;
  bin: string;
  args: readonly string[];
}

/**
 * Build the `docker run` argv that executes `bin args` inside an ephemeral
 * container: `--rm`, the locked network, the single checkout bind, the working
 * directory, the injected env, and the command via `--entrypoint` (so the
 * image's own entrypoint does not intercept it). Pure and order-stable for
 * testing.
 */
export function buildDockerRunArgs(input: DockerRunArgsInput): string[] {
  const argv: string[] = ['run', '--rm', '--network', input.network];
  if (input.user !== undefined) argv.push('--user', input.user);
  argv.push('-v', `${input.checkoutDir}:${input.checkoutDir}`, '-w', input.workdir);
  for (const [key, value] of Object.entries(input.env)) argv.push('-e', `${key}=${value}`);
  argv.push('--entrypoint', input.bin, input.image, ...input.args);
  return argv;
}

import { type ContainerBackendOptions, containerRuntimeAvailable } from "./container-backend.ts";

/**
 * `--isolation docker`, `--isolation podman:python:3.12-bookworm`, or `none`.
 *
 * Refused here rather than at the first command, because a run that discovers its runtime is
 * missing after the model has already edited files has spent the interesting part of its budget
 * finding out. The default is the host: turning containment on is a decision somebody makes,
 * and the execution envelope says which one they made.
 */
const supportedRuntimes = ["docker", "podman", "nerdctl"] as const;
const defaultImage = "node:24-bookworm";

export function parseIsolationOption(
  value: string | null,
  workspaceRoot: string,
  /** Injected so parsing is testable without the runtime the caller happens to have. */
  isAvailable: (runtime: string) => boolean = containerRuntimeAvailable,
): ContainerBackendOptions | null {
  if (value === null || value === "none" || value.length === 0) {
    return null;
  }

  const [runtime, ...imageParts] = value.split(":");
  if (runtime === undefined || !supportedRuntimes.includes(runtime as never)) {
    throw new Error(
      `--isolation "${value}" names no runtime this build knows. ` +
        `Use one of: ${supportedRuntimes.join(", ")}, optionally with an image ` +
        `("docker:python:3.12-bookworm"), or "none" to run on the host.`,
    );
  }
  if (!isAvailable(runtime)) {
    throw new Error(
      `--isolation "${value}" needs ${runtime}, which is not installed or is not answering. ` +
        `Start it, or pass --isolation none to run on the host and accept the restricted mode.`,
    );
  }

  return {
    runtime,
    image: imageParts.length === 0 ? defaultImage : imageParts.join(":"),
    workspaceRoot,
    // The person who started the run, so files the command writes belong to them rather than
    // to root, which is what a container writes as by default and what leaves a workspace the
    // operator then cannot edit.
    user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
  };
}

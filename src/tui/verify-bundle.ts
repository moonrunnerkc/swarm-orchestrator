import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { harnessControlledEnvironment } from "../gates/node-test-command.ts";
import type { BundleVerification } from "./evidence-panel.ts";
import { verifyCommandFor } from "./evidence-panel.ts";
import type { EvidenceLocation } from "./open-path.ts";

/**
 * Runs the bundle's own embedded verifier, so the panel can say verified rather than opened.
 * Spawned as an argument vector under an environment the harness built: the same reason the
 * coverage arm does it that way, since a `NODE_OPTIONS` preload would decide what the
 * verifying process loads and no reading of a command string can see one.
 */
export async function runEmbeddedVerifier(input: {
  readonly location: EvidenceLocation;
  readonly nodeExecutable: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}): Promise<BundleVerification> {
  const command = verifyCommandFor(input.location, input.nodeExecutable);
  const verifier = command.args[0] ?? "";

  // Asked before it is spawned, because node exits 1 on a module it cannot find and that is
  // indistinguishable at the exit code from a verifier that ran and refused the bundle. One
  // of those is a verdict and the other is the absence of one, which is the distinction the
  // ratchet spends its whole length on. No verifier means not verified, never refused.
  try {
    await access(verifier);
  } catch {
    return { kind: "not-run", reason: `there is no verifier at ${verifier}` };
  }

  return new Promise((settle) => {
    execFile(
      command.file,
      [...command.args],
      {
        env: harnessControlledEnvironment(input.environment),
        timeout: input.timeoutMs,
        maxBuffer: 8_000_000,
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          settle({ kind: "verified", exitCode: 0 });
          return;
        }
        const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code;
        if (typeof exitCode !== "number") {
          settle({ kind: "not-run", reason: error.message.split("\n")[0] ?? "it could not start" });
          return;
        }
        settle({
          kind: "refused",
          exitCode,
          detail: stderr.split("\n").find((line) => line.trim().length > 0) ?? "no detail given",
        });
      },
    );
  });
}

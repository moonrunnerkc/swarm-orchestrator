import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { childEnvironment, defaultChildHome } from "../exec/child-environment.ts";
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
        env: childEnvironment(input.environment, { homeDir: defaultChildHome() }).variables,
        timeout: input.timeoutMs,
        maxBuffer: 8_000_000,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          settle({ kind: "verified", exitCode: 0 });
          return;
        }
        const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code;
        if (typeof exitCode !== "number") {
          settle({ kind: "not-run", reason: error.message.split("\n")[0] ?? "it could not start" });
          return;
        }
        settle({ kind: "refused", exitCode, detail: refusalDetail(stdout, stderr) });
      },
    );
  });
}

/**
 * Which check refused the bundle, taken from the stream the verifier actually writes on.
 *
 * It reports through `console.log`, so every `FAIL` line is on stdout and there is nothing on
 * stderr at all unless node itself failed. Reading stderr therefore turned every genuine
 * refusal into "exit 1, no detail given": the one moment the panel exists for, and it named
 * nothing. The named check is what a reader needs, so it is preferred over the tally line
 * under it, and stderr is still consulted for the case where node rather than the bundle is
 * what went wrong.
 */
export function refusalDetail(stdout: string, stderr: string): string {
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const failed = lines(stdout).filter((line) => line.startsWith("FAIL"));
  if (failed.length > 0) {
    const [first] = failed;
    const rest = failed.length > 1 ? ` (and ${failed.length - 1} more)` : "";
    return `${first ?? ""}${rest}`;
  }

  const verdict = lines(stdout).find((line) => line.startsWith("bundle FAILED"));
  if (verdict !== undefined) {
    return verdict;
  }

  const [fromStderr] = lines(stderr);
  return fromStderr ?? "no detail given";
}

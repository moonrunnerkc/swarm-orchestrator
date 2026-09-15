import type { VerifyCommand } from "./cli-verify-options.ts";
import { verifyBundleAt } from "./evidence/verify-report.ts";

/**
 * The bundle's own consistency and the identity that signed it, reported apart. A bundle
 * carries the public key its signature verifies against, so checking it against itself can
 * only ever say "unchanged since written". Who wrote it is a question the caller answers, by
 * naming the signers it expects.
 */
export async function verifyBundle(options: VerifyCommand): Promise<number> {
  const verification = await verifyBundleAt(options.bundleDirectory, options.expectedSigners);
  for (const line of verification.lines) {
    process.stdout.write(`${line}\n`);
  }
  if (options.expectedSigners.length === 0) {
    process.stdout.write(
      "\nname the signer you expect with --signer <fingerprint> to check authenticity.\n",
    );
  }
  return verification.exitCode;
}

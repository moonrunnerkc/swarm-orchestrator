import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bundleFileNames } from "./bundle-manifest.ts";
import { judgeSigner, type SignerJudgement, type TrustPolicy } from "./signer-trust.ts";

export interface BundleVerification {
  readonly integrity: "valid" | "invalid" | "unverified";
  readonly signerJudgement: SignerJudgement | null;
  readonly lines: readonly string[];
  /** Zero only where the bundle is internally consistent and its signer was accepted. */
  readonly exitCode: number;
}

/**
 * Reads a bundle and reports the two questions separately, because they are two questions.
 * Integrity is what the bundle can prove about itself; the signer is what it cannot, and the
 * expected identities for that come from the caller rather than from the file being checked.
 */
export async function verifyBundleAt(
  directory: string,
  expectedSigners: readonly string[],
): Promise<BundleVerification> {
  let manifest: { chainHead?: string; signature?: unknown };
  try {
    manifest = JSON.parse(await readFile(join(directory, bundleFileNames.manifest), "utf8"));
  } catch (cause) {
    return {
      integrity: "unverified",
      signerJudgement: null,
      lines: [
        `integrity:  unverified (${cause instanceof Error ? cause.message : String(cause)})`,
        `signer:     unverified (there was no manifest to read a signature from)`,
      ],
      exitCode: 2,
    };
  }

  const policy: TrustPolicy =
    expectedSigners.length === 0
      ? { mode: "any-key" }
      : { mode: "expected-signers", signers: expectedSigners };

  const signature = manifest.signature as Parameters<typeof judgeSigner>[1] | undefined;
  if (signature === undefined || typeof manifest.chainHead !== "string") {
    return {
      integrity: "unverified",
      signerJudgement: null,
      lines: [
        "integrity:  unverified (the manifest carries no chain head or no signature)",
        "signer:     unverified (there was no signature to judge)",
      ],
      exitCode: 2,
    };
  }

  const judgement = judgeSigner(manifest.chainHead, signature, policy);
  const integrity = judgement.signer === "invalid" ? "invalid" : "valid";

  return {
    integrity,
    signerJudgement: judgement,
    lines: [
      `integrity:  ${integrity} (the signature over the chain head ${
        integrity === "valid" ? "verifies" : "does not verify"
      })`,
      `signer:     ${judgement.signer}`,
      `            ${judgement.reason}`,
      `fingerprint: ${judgement.fingerprint}`,
      ...(judgement.signer === "trusted"
        ? []
        : [
            "",
            "what this does not establish: a valid signature says the bundle is unchanged since",
            "it was written. It says nothing about whether the machine that wrote it was sound.",
          ]),
    ],
    exitCode: judgement.signer === "trusted" ? 0 : 1,
  };
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVerificationCommand } from './command-runner';
import type {
  AttestationSignature,
  AttestationVerificationResult,
  CosignKeySigningOptions,
  InTotoStatement,
  SignedAttestation,
} from './attestation';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeEnvelope(prefix: string, envelope: InTotoStatement): {
  tmp: string;
  envelopePath: string;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const envelopePath = path.join(tmp, 'envelope.json');
  fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2), 'utf8');
  return { tmp, envelopePath };
}

/**
 * Sign an attestation envelope with cosign keyless signing.
 *
 * @param envelope - In-toto statement to sign.
 * @param repoPath - Repository root for temporary signing files.
 * @returns Cosign signature metadata.
 */
export async function signWithCosign(
  envelope: InTotoStatement,
  repoPath: string,
): Promise<AttestationSignature> {
  const { tmp, envelopePath } = writeEnvelope('swarm-attest-', envelope);
  const bundlePath = path.join(tmp, 'bundle.json');
  const command = `cosign sign-blob --yes --bundle ${shellQuote(bundlePath)} ${shellQuote(envelopePath)}`;
  const result = await runVerificationCommand(command, repoPath, 300_000);
  if (result.exitCode !== 0) {
    throw new Error(`cosign sign-blob failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return {
    kind: 'cosign',
    signature: result.stdout.trim(),
    bundlePath,
  };
}

/**
 * Sign an attestation envelope with a local cosign key pair.
 *
 * This is intended for offline integration tests and controlled environments.
 * Production attestations should use keyless `signWithCosign`.
 *
 * @param envelope - In-toto statement to sign.
 * @param repoPath - Repository root for temporary signing files.
 * @param options - Cosign key paths and optional password.
 * @returns Cosign key signature metadata.
 */
export async function signWithCosignKey(
  envelope: InTotoStatement,
  repoPath: string,
  options: CosignKeySigningOptions,
): Promise<AttestationSignature> {
  const { tmp, envelopePath } = writeEnvelope('swarm-attest-key-', envelope);
  const signaturePath = path.join(tmp, 'signature.sig');
  const password = options.password ?? '';
  const command = `COSIGN_PASSWORD=${shellQuote(password)} cosign sign-blob --key ${shellQuote(options.privateKeyPath)} --output-signature ${shellQuote(signaturePath)} ${shellQuote(envelopePath)}`;
  const result = await runVerificationCommand(command, repoPath, 300_000);
  if (result.exitCode !== 0) {
    throw new Error(`cosign key sign-blob failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return {
    kind: 'cosign',
    signature: fs.readFileSync(signaturePath, 'utf8').trim(),
    signaturePath,
    publicKeyPath: options.publicKeyPath,
  };
}

function missingCosignMetadata(attestation: SignedAttestation): AttestationVerificationResult {
  return {
    found: true,
    verified: false,
    reason: 'cosign bundle or key signature metadata missing',
    attestation,
  };
}

/**
 * Verify a cosign-backed attestation signature.
 *
 * @param repoPath - Repository root.
 * @param attestation - Parsed signed attestation.
 * @returns Verification result.
 */
export async function verifyCosignSignature(
  repoPath: string,
  attestation: SignedAttestation,
): Promise<AttestationVerificationResult> {
  const { tmp, envelopePath } = writeEnvelope('swarm-attest-verify-', attestation.envelope);
  const sig = attestation.signature;
  const command = sig.bundlePath
    ? `cosign verify-blob --bundle ${shellQuote(sig.bundlePath)} ${shellQuote(envelopePath)}`
    : sig.signaturePath && sig.publicKeyPath
      ? `cosign verify-blob --key ${shellQuote(sig.publicKeyPath)} --signature ${shellQuote(sig.signaturePath)} ${shellQuote(envelopePath)}`
      : '';

  if (!command) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return missingCosignMetadata(attestation);
  }

  const result = await runVerificationCommand(command, repoPath, 300_000);
  fs.rmSync(tmp, { recursive: true, force: true });
  return {
    found: true,
    verified: result.exitCode === 0,
    reason: result.exitCode === 0
      ? (sig.bundlePath ? 'cosign signature verified' : 'cosign key signature verified')
      : (result.stderr || result.stdout).trim(),
    attestation,
  };
}

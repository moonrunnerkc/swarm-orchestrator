import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVerificationCommand } from './command-runner';

export interface AttestationLayerResult {
  layer: string;
  status: string;
  evidenceSummary: string;
  durationMs: number;
}

export interface AttestationAgentIdentity {
  tool: string;
  version: string;
  model: string;
}

export interface AttestationInput {
  repoPath: string;
  commit: string;
  goalText: string;
  planHash: string;
  agent: AttestationAgentIdentity;
  transcript: string;
  layerResults: AttestationLayerResult[];
  compositeScore: number;
  timestamp?: string;
  signer?: AttestationSigner;
}

export interface InTotoStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{
    name: string;
    digest: { sha1: string };
  }>;
  predicateType: 'https://slsa.dev/provenance/v1';
  predicate: {
    buildType: string;
    invocation: {
      parameters: {
        goalHash: string;
        planHash: string;
      };
    };
    buildConfig: AttestationAgentIdentity;
    metadata: {
      transcriptHash: string;
      layerResults: AttestationLayerResult[];
      compositeScore: number;
      timestamp: string;
    };
  };
}

export interface AttestationSignature {
  kind: 'cosign' | 'unsigned-test';
  signature: string;
  bundlePath?: string;
}

export interface SignedAttestation {
  envelope: InTotoStatement;
  signature: AttestationSignature;
}

export type AttestationSigner = (
  envelope: InTotoStatement,
  repoPath: string,
) => Promise<AttestationSignature>;

export interface AttestationVerificationResult {
  found: boolean;
  verified: boolean;
  reason: string;
  attestation?: SignedAttestation;
}

const NOTE_REF = 'refs/notes/swarm-attestation';
const BUILD_TYPE = 'https://github.com/moonrunnerkc/swarm-orchestrator/attestation/v7';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSignedAttestation(raw: string): SignedAttestation {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.envelope) || !isRecord(parsed.signature)) {
    throw new Error('attestation note is not a signed attestation object');
  }
  return parsed as unknown as SignedAttestation;
}

/**
 * Build an in-toto SLSA v1.0 provenance statement for an agent-authored commit.
 *
 * @param input - Attestation fields collected from the verification run.
 * @returns Unsigned in-toto statement.
 */
export function createAttestationEnvelope(input: AttestationInput): InTotoStatement {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: 'git-commit',
      digest: { sha1: input.commit },
    }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildType: BUILD_TYPE,
      invocation: {
        parameters: {
          goalHash: sha256(input.goalText),
          planHash: input.planHash,
        },
      },
      buildConfig: input.agent,
      metadata: {
        transcriptHash: sha256(input.transcript),
        layerResults: input.layerResults,
        compositeScore: input.compositeScore,
        timestamp,
      },
    },
  };
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-attest-'));
  const envelopePath = path.join(tmp, 'envelope.json');
  const bundlePath = path.join(tmp, 'bundle.json');
  fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2), 'utf8');

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
 * Deterministic non-production signer for local tests.
 *
 * @param envelope - In-toto statement to mark as test-signed.
 * @returns Test signature marker.
 */
export async function unsignedTestSigner(envelope: InTotoStatement): Promise<AttestationSignature> {
  return {
    kind: 'unsigned-test',
    signature: sha256(JSON.stringify(envelope)),
  };
}

/**
 * Generate and sign an attestation.
 *
 * @param input - Attestation input and optional signer override.
 * @returns Signed attestation object.
 */
export async function generateSignedAttestation(input: AttestationInput): Promise<SignedAttestation> {
  const envelope = createAttestationEnvelope(input);
  const signer = input.signer ?? signWithCosign;
  return {
    envelope,
    signature: await signer(envelope, input.repoPath),
  };
}

/**
 * Attach a signed attestation to a commit as a git note.
 *
 * @param repoPath - Repository root.
 * @param commit - Commit hash to annotate.
 * @param attestation - Signed attestation payload.
 */
export function attachAttestationNote(
  repoPath: string,
  commit: string,
  attestation: SignedAttestation,
): void {
  git(repoPath, [
    'notes',
    `--ref=${NOTE_REF}`,
    'add',
    '-f',
    '-m',
    JSON.stringify(attestation),
    commit,
  ]);
}

/**
 * Read a swarm attestation git note for a commit.
 *
 * @param repoPath - Repository root.
 * @param commit - Commit hash.
 * @returns Parsed attestation, or undefined when no note exists.
 */
export function readAttestationNote(repoPath: string, commit: string): SignedAttestation | undefined {
  try {
    return parseSignedAttestation(git(repoPath, ['notes', `--ref=${NOTE_REF}`, 'show', commit]));
  } catch {
    return undefined;
  }
}

/**
 * Verify a swarm attestation note.
 *
 * Cosign signatures are verified with `cosign verify-blob` when present. The
 * `unsigned-test` signature kind is accepted only for local deterministic tests.
 *
 * @param repoPath - Repository root.
 * @param commit - Commit hash to verify.
 * @returns Verification result and parsed attestation when found.
 */
export async function verifyAttestation(
  repoPath: string,
  commit: string,
): Promise<AttestationVerificationResult> {
  const attestation = readAttestationNote(repoPath, commit);
  if (!attestation) {
    return { found: false, verified: false, reason: 'no attestation found' };
  }

  const subject = attestation.envelope.subject[0]?.digest.sha1;
  if (subject !== commit) {
    return {
      found: true,
      verified: false,
      reason: `attestation subject ${subject ?? 'missing'} does not match commit ${commit}`,
      attestation,
    };
  }

  if (attestation.signature.kind === 'unsigned-test') {
    const expected = sha256(JSON.stringify(attestation.envelope));
    return {
      found: true,
      verified: attestation.signature.signature === expected,
      reason: attestation.signature.signature === expected
        ? 'unsigned test attestation verified structurally'
        : 'unsigned test attestation signature mismatch',
      attestation,
    };
  }

  if (!attestation.signature.bundlePath) {
    return { found: true, verified: false, reason: 'cosign bundle path missing', attestation };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-attest-verify-'));
  const envelopePath = path.join(tmp, 'envelope.json');
  fs.writeFileSync(envelopePath, JSON.stringify(attestation.envelope, null, 2), 'utf8');
  const command = `cosign verify-blob --bundle ${shellQuote(attestation.signature.bundlePath)} ${shellQuote(envelopePath)}`;
  const result = await runVerificationCommand(command, repoPath, 300_000);
  fs.rmSync(tmp, { recursive: true, force: true });

  return {
    found: true,
    verified: result.exitCode === 0,
    reason: result.exitCode === 0 ? 'cosign signature verified' : (result.stderr || result.stdout).trim(),
    attestation,
  };
}

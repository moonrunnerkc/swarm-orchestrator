import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  generateSignedAttestation,
  attachAttestationNote,
  type AttestationInput,
  type AttestationLayerResult,
  type AttestationSigner,
} from '../verification/attestation';
import type { BatteryResult } from '../verification/battery-types';
import type { ExecutionPlan } from '../plan-generator';
import { getLogger } from '../logger';

const logger = getLogger('post-battery-attestation');

export interface PostBatteryAttestationInput {
  repoPath: string;
  runDir: string;
  plan: ExecutionPlan;
  batteryResult: BatteryResult;
  /** Agent tool name (copilot, claude-code, etc.). */
  agentTool: string;
  /** Model name used. */
  agentModel: string;
  /** Optional override signer. Defaults to cosign keyless in production. */
  signer?: AttestationSigner;
}

/**
 * Generate and attach a signed SLSA v1.0 in-toto attestation after a
 * successful battery run.
 *
 * Best-effort: any failure (cosign not installed, no OIDC token) is logged
 * as a warning and swallowed. The attestation is advisory — it should not
 * block a run that already passed the hard gates.
 *
 * On success, the attestation is:
 *  - attached to HEAD as a git note under refs/notes/swarm-attestation
 *  - written to runs/<id>/verification/attestation.json for artifact archival
 *
 * @param input - All data needed to build and sign the envelope.
 */
export async function generateAndAttachAttestation(
  input: PostBatteryAttestationInput,
): Promise<void> {
  let headCommit: string;
  try {
    headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: input.repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    logger.warn('attestation: could not determine HEAD commit; skipping', { cause: err });
    return;
  }

  const transcript = gatherTranscript(input.runDir);
  const planHash = sha256(JSON.stringify(input.plan));

  const layerResults: AttestationLayerResult[] = input.batteryResult.layerResults.map(
    (lr) => ({
      layer: lr.layer,
      status: lr.status,
      evidenceSummary: lr.evidenceSummary,
      durationMs: lr.durationMs,
    }),
  );

  const attestationInput: AttestationInput = {
    repoPath: input.repoPath,
    commit: headCommit,
    goalText: input.plan.goal,
    planHash,
    agent: {
      tool: input.agentTool,
      version: readPackageVersion(),
      model: input.agentModel,
    },
    transcript,
    layerResults,
    compositeScore: input.batteryResult.compositeScore,
    ...(input.signer !== undefined ? { signer: input.signer } : {}),
  };

  let attestation;
  try {
    attestation = await generateSignedAttestation(attestationInput);
  } catch (err) {
    logger.warn(
      'attestation: signing failed (cosign may not be installed or OIDC unavailable); ' +
        'run will proceed without an attestation note',
      { cause: err },
    );
    return;
  }

  // Attach as a git note.
  try {
    attachAttestationNote(input.repoPath, headCommit, attestation);
    logger.info('attestation: signed and attached to ' + headCommit.slice(0, 12));
  } catch (err) {
    logger.warn('attestation: signed but could not attach git note', { cause: err });
  }

  // Write attestation JSON to verification evidence directory.
  const verificationDir = path.join(input.runDir, 'verification');
  try {
    fs.mkdirSync(verificationDir, { recursive: true });
    fs.writeFileSync(
      path.join(verificationDir, 'attestation.json'),
      JSON.stringify(attestation, null, 2),
      'utf8',
    );
  } catch (err) {
    logger.warn('attestation: could not write attestation.json to run artifacts', { cause: err });
  }
}

function gatherTranscript(runDir: string): string {
  const stepsDir = path.join(runDir, 'steps');
  if (!fs.existsSync(stepsDir)) {
    return '';
  }
  const parts: string[] = [];
  try {
    const stepDirs = fs
      .readdirSync(stepsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const stepDir of stepDirs) {
      const sharePath = path.join(stepsDir, stepDir, 'share.md');
      if (fs.existsSync(sharePath)) {
        parts.push(fs.readFileSync(sharePath, 'utf8'));
      }
    }
  } catch {
    // Best-effort; partial transcript is acceptable.
  }
  return parts.join('\n\n---\n\n');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

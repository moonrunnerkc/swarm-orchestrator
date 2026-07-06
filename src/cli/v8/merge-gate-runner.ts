// CLI adapter that runs the positive merge-safety gate for a --pr audit. It
// provisions the merged tree (a real checkout of the PR head), hands it to the
// deterministic runMergeGate core, and always cleans up. Provisioning is the
// one network/disk step, injected as `provision` so the gate logic and the
// fail-closed behavior are testable offline against a local workspace; the
// default provisioner wraps provisionPRWorkspaces.
//
// Fail-closed: if the tree cannot be provisioned at all (fetch or install
// failed), the merged proof could not run, so the decision is HUMAN via an
// unavailable control, never a pass.

import * as os from 'os';
import { composeMergeDecision } from '../../audit/gate/merge-decision';
import { runMergeGate, type MergeGateOutcome } from '../../audit/gate/merge-gate';
import { provisionPRWorkspaces } from '../../audit/execution-grounded/sandbox';

/** The PR coordinates the provisioner needs to fetch the merged tree. */
export interface PrProvisionRequest {
  readonly repo: string;
  readonly prNumber: number;
  readonly prHeadSha: string;
  readonly prBaseSha?: string;
  readonly baseDir: string;
}

/** A provisioned workspace: the checkout path plus its cleanup. */
export interface ProvisionedWorkspace {
  readonly workspacePath: string;
  readonly cleanup: () => void;
}

/** Fetches and installs the merged tree. Injected so tests can supply a local dir. */
export type PrProvisioner = (request: PrProvisionRequest) => ProvisionedWorkspace;

/** Default provisioner: a real GitHub checkout of the PR head via the sandbox. */
export const defaultPrProvisioner: PrProvisioner = (request) => {
  const workspaces = provisionPRWorkspaces({
    repo: request.repo,
    prNumber: request.prNumber,
    prHeadSha: request.prHeadSha,
    ...(request.prBaseSha !== undefined ? { prBaseSha: request.prBaseSha } : {}),
    baseDir: request.baseDir,
  });
  // The positive gate proves build+test itself (build-must-pass runs before
  // test-must-pass), so provisioning installs but does not pre-build.
  return { workspacePath: workspaces.post.workspacePath, cleanup: workspaces.cleanup };
};

export interface MergeGateForPrInput {
  readonly prMetadata: {
    readonly number: number;
    readonly repository: string;
    readonly headSha: string;
    readonly baseSha?: string;
  };
  readonly negativeGateClean: boolean;
  readonly negativeGateDetail: string;
  /** Parent directory for the temp checkout. Defaults to the OS temp dir. */
  readonly baseDir?: string;
  readonly commandTimeoutMs?: number;
  /** Injected provisioner. Defaults to a real GitHub checkout. */
  readonly provision?: PrProvisioner;
}

function provisionFailedOutcome(
  detail: string,
  negativeGateClean: boolean,
  negativeGateDetail: string,
): MergeGateOutcome {
  const decision = composeMergeDecision({
    egViable: true,
    egViabilityReason: '',
    negativeGateClean,
    negativeGateDetail,
    controls: [{ id: 'provision', kind: 'obligation', status: 'unavailable', detail }],
  });
  return { decision, viable: true, viabilityReason: '', obligationCount: 0, configErrors: [] };
}

/**
 * Provision a PR's merged tree and run the positive merge-safety gate against
 * it, composing the final AUTO-MERGE / HUMAN decision.
 *
 * @param input the PR metadata, the negative-gate verdict, and options.
 * @returns the merge-gate outcome; HUMAN via an unavailable control if the tree
 *   could not be provisioned.
 */
export function runMergeGateForPr(input: MergeGateForPrInput): MergeGateOutcome {
  const provision = input.provision ?? defaultPrProvisioner;
  const baseDir = input.baseDir ?? os.tmpdir();

  let workspace: ProvisionedWorkspace;
  try {
    workspace = provision({
      repo: input.prMetadata.repository,
      prNumber: input.prMetadata.number,
      prHeadSha: input.prMetadata.headSha,
      ...(input.prMetadata.baseSha !== undefined ? { prBaseSha: input.prMetadata.baseSha } : {}),
      baseDir,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return provisionFailedOutcome(
      `could not provision the merged tree: ${message}`,
      input.negativeGateClean,
      input.negativeGateDetail,
    );
  }

  try {
    return runMergeGate({
      workspacePath: workspace.workspacePath,
      negativeGateClean: input.negativeGateClean,
      negativeGateDetail: input.negativeGateDetail,
      ...(input.commandTimeoutMs !== undefined ? { commandTimeoutMs: input.commandTimeoutMs } : {}),
    });
  } finally {
    workspace.cleanup();
  }
}

/**
 * Re-export the Copilot predicate-runner. ClaudeCode and Copilot apply
 * candidates the same way (snapshot existing files, write or overwrite,
 * run `verifyObligation`, restore snapshot) so the runner is the same
 * code. Phase 4's measurement question concerns the *generation* axis
 * (which model proposes which perturbations), not the verification
 * axis; pinning the verifier to a single shared implementation keeps
 * the cross-adapter comparison apples-to-apples.
 */

export {
  runCandidateAgainstObligation,
  checkObligationBaseline,
} from '../copilot/predicate-runner';
export type { CandidateRunResult } from '../copilot/predicate-runner';

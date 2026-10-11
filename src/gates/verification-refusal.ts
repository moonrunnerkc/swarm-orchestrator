/**
 * A verification that decided against the change before measuring it, as a typed error rather
 * than a message. The independent verifier raises these for policy decisions it cannot measure
 * past: an upgrade that changes a file outside its authorized scope, a manifest that does not
 * target the authorized versions, a change outside the selected packages. On the worker's task
 * path such a decision has to reach the acceptance gate as a failed observation the bounded
 * repair can read, and the final verification as a refused result the assessment can record;
 * an untyped error there ended the run with no result line and no verdict, which is what the
 * September development pilot observed on every upgrade policy refusal.
 */
export class VerificationRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationRefusalError";
  }
}

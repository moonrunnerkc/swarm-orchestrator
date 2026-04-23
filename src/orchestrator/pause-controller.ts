/**
 * Owns the pause/resume state that `SwarmOrchestrator` uses to suspend
 * the scheduling loop mid-execution. Extracted from swarm-orchestrator.ts
 * so the orchestrator class only forwards to an isolated controller.
 *
 * Two flags coordinate the handshake:
 *   - `pauseRequested` signals the scheduler to stop launching new steps
 *     the next time the loop checks.
 *   - `resumeRequested` is set by `requestResume` and consumed by
 *     `waitForResume` to release the pause.
 */
export class PauseController {
  private pauseRequested: boolean = false;
  private resumeRequested: boolean = false;

  /**
   * Request pause of current execution. The scheduler observes the flag
   * at the top of its loop and suspends launching further steps.
   */
  requestPause(): void {
    this.pauseRequested = true;
  }

  /**
   * Request resume of paused execution. Clears the pause flag and signals
   * `waitForResume` to return.
   */
  requestResume(): void {
    this.resumeRequested = true;
    this.pauseRequested = false;
  }

  /**
   * @returns `true` when a pause has been requested and not yet resumed.
   */
  isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  /**
   * Block until `requestResume` fires or the pause is otherwise cleared.
   * Polls every 500ms, matching the original inline implementation.
   */
  async waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.resumeRequested || !this.pauseRequested) {
          clearInterval(checkInterval);
          this.resumeRequested = false;
          resolve();
        }
      }, 500); // Check every 500ms
    });
  }
}

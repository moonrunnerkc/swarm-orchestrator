/**
 * The screen settings a run resolves, owned by config rather than by the screen. The settings
 * module has to name these types, and the standalone verifier carries the settings module
 * without carrying a screen, so the types live where both can reach them.
 */

export type ColorMode = "auto" | "always" | "never";

/** What happens when a run finishes: ask, always open, or never open. Never opens off a TTY. */
export type OpenEvidencePolicy = "ask" | "always" | "never";

/**
 * What the command line said about the screen. Null wherever it said nothing, so swarm.toml
 * and the defaults below it still get their turn (src/config/settings.ts).
 */
export interface InterfaceFlags {
  /** False for --no-tui: plain lines even on a terminal. */
  readonly tui: boolean | null;
  readonly color: "always" | "never" | null;
  readonly openEvidence: "always" | "never" | null;
}

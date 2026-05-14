// Public entry point for the falsification adapter subsystem.

import { AdapterRegistry } from './registry';
import { CliFalsifier } from './cli-falsifier';
import { copilotProfile } from './profiles/copilot';
import { codexProfile } from './profiles/codex';
import { claudeCodeProfile } from './profiles/claude-code';

export type * from './types';
export { AdapterRegistry } from './registry';
export { CliFalsifier } from './cli-falsifier';
export type * from './cli-falsifier';
export { copilotProfile } from './profiles/copilot';
export { codexProfile } from './profiles/codex';
export { claudeCodeProfile } from './profiles/claude-code';

// Codex is always registered; Copilot is on by default per the Phase
// 3 close-out; ClaudeCode is gated behind explicit opt-in (Phase 4).
export interface DefaultRegistryOptions {
  readonly includeCopilot?: boolean;
  readonly includeClaudeCode?: boolean;
}

/** Build a registry pre-populated with the built-in falsifier adapters. */
export function defaultAdapterRegistry(options: DefaultRegistryOptions = {}): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new CliFalsifier(codexProfile));
  if ((options.includeCopilot ?? true) === true) registry.register(new CliFalsifier(copilotProfile));
  if (options.includeClaudeCode === true) registry.register(new CliFalsifier(claudeCodeProfile));
  return registry;
}

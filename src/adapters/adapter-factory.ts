import { AgentAdapter } from './agent-adapter';
import { CopilotAdapter } from './copilot-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { ClaudeCodeTeamsAdapter } from './claude-code-teams';

const adapterRegistry: Record<string, () => AgentAdapter> = {
  'copilot': () => new CopilotAdapter(),
  'claude-code': () => new ClaudeCodeAdapter(),
  'claude-code-teams': () => new ClaudeCodeTeamsAdapter(),
};

// Resolve an adapter by CLI tool name. Throws with the list of valid
// names when the requested tool is unknown.
export function resolveAdapter(toolName: string): AgentAdapter {
  const factory = adapterRegistry[toolName];
  if (!factory) {
    const valid = Object.keys(adapterRegistry).join(', ');
    throw new Error(`Unknown tool "${toolName}". Valid tools: ${valid}`);
  }
  return factory();
}

export function registerAdapter(name: string, factory: () => AgentAdapter): void {
  adapterRegistry[name] = factory;
}

export function listAdapterNames(): string[] {
  return Object.keys(adapterRegistry);
}

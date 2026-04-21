import { AgentAdapter } from './agent-adapter';
import { CopilotAdapter } from './copilot-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { ClaudeCodeTeamsAdapter } from './claude-code-teams';

export interface AdapterFactoryOptions {
  teamSize?: number | undefined;
}

const adapterRegistry: Record<string, (opts?: AdapterFactoryOptions) => AgentAdapter> = {
  'copilot': () => new CopilotAdapter(),
  'claude-code': () => new ClaudeCodeAdapter(),
  'claude-code-teams': (opts) => new ClaudeCodeTeamsAdapter(
    opts?.teamSize ? { teamSize: opts.teamSize } : undefined
  ),
};

// Resolve an adapter by CLI tool name. Throws with the list of valid
// names when the requested tool is unknown.
export function resolveAdapter(toolName: string, opts?: AdapterFactoryOptions): AgentAdapter {
  const factory = adapterRegistry[toolName];
  if (!factory) {
    const valid = Object.keys(adapterRegistry).join(', ');
    throw new Error(`Unknown tool "${toolName}". Valid tools: ${valid}`);
  }
  return factory(opts);
}

export function registerAdapter(name: string, factory: (opts?: AdapterFactoryOptions) => AgentAdapter): void {
  adapterRegistry[name] = factory;
}

export function listAdapterNames(): string[] {
  return Object.keys(adapterRegistry);
}

import { AgentAdapter, AgentResult, AgentSpawnOptions } from './agent-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { supervisedSpawn } from './process-supervisor';
import { getLogger } from '../logger';
const logger = getLogger('claude-code-teams');

export interface TeamWaveResult {
  results: AgentResult[];
  usedTeams: boolean;
  fallbackReason?: string | undefined;
}

export interface TeamsAdapterOptions {
  teamSize?: number | undefined;
}

// Maximum concurrent teammates per wave. Agent Teams performance degrades
// beyond 5 concurrent teammates based on Anthropic's documentation.
const MAX_TEAM_SIZE = 5;

export class ClaudeCodeTeamsAdapter implements AgentAdapter {
  readonly name = 'claude-code-teams';
  private teamSize: number;
  private fallbackAdapter: ClaudeCodeAdapter;

  constructor(options?: TeamsAdapterOptions) {
    this.teamSize = Math.min(options?.teamSize ?? MAX_TEAM_SIZE, MAX_TEAM_SIZE);
    this.fallbackAdapter = new ClaudeCodeAdapter();
  }

  // Single-step spawn delegates to team execution with one step.
  // Preserves the AgentAdapter contract for callers that don't batch.
  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
    const results = await this.executeWave([opts]);
    return results[0];
  }

  async executeWave(steps: AgentSpawnOptions[]): Promise<AgentResult[]> {
    if (steps.length === 0) return [];

    try {
      return await this.spawnTeamWave(steps);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return this.fallbackToPerStep(steps, error);
    }
  }

  // Check if a model string indicates Opus 4.6+, which is required for
  // Agent Teams. Non-Opus models will trigger a fallback to per-step execution.
  static isOpusModel(model: string | undefined): boolean {
    if (!model) return false;
    return /opus/i.test(model);
  }

  private async spawnTeamWave(steps: AgentSpawnOptions[]): Promise<AgentResult[]> {
    // Build the team lead prompt that spawns teammates for each step
    const teamLeadPrompt = this.buildTeamLeadPrompt(steps);
    const workdir = steps[0].workdir;
    const model = steps[0].model;

    // Agent Teams requires Opus model. Check before attempting to spawn.
    if (model && !ClaudeCodeTeamsAdapter.isOpusModel(model)) {
      throw new Error(
        `Agent Teams requires Opus 4.6+, got "${model}". Use --tool claude-code for non-Opus models.`
      );
    }

    const startTime = Date.now();

    // Spawn the team lead as a single claude session with the
    // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var enabled
    const spawnOpts: AgentSpawnOptions = {
      prompt: teamLeadPrompt,
      workdir,
    };
    if (model) spawnOpts.model = model;

    const result = await this.fallbackAdapter.spawn(spawnOpts);

    const durationMs = Date.now() - startTime;

    // If the team lead failed, throw to trigger fallback
    if (result.exitCode !== 0) {
      throw new Error(
        `Team lead exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`
      );
    }

    // Map the single team lead output to per-step results.
    // Each step gets the same transcript since the team lead orchestrated all work.
    return steps.map((_step, _i) => ({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs,
      shareTranscriptPath: undefined
    }));
  }

  private buildTeamLeadPrompt(steps: AgentSpawnOptions[]): string {
    const batchSize = Math.min(steps.length, this.teamSize);
    const sections: string[] = [
      `You are the team lead for a wave of ${steps.length} parallel tasks.`,
      `Spawn up to ${batchSize} teammates to execute these tasks concurrently.`,
      '',
      'For each task below, spawn a teammate with the given prompt.',
      'Wait for all teammates to complete before reporting results.',
      ''
    ];

    for (let i = 0; i < steps.length; i++) {
      sections.push(`=== Teammate ${i + 1} ===`);
      sections.push(steps[i].prompt);
      sections.push('');
    }

    sections.push('Report the combined results of all teammates when done.');

    return sections.join('\n');
  }

  private async fallbackToPerStep(
    steps: AgentSpawnOptions[],
    error: Error
  ): Promise<AgentResult[]> {
    logger.warn(`Teams fallback: ${error.message}`);

    // Execute each step individually via the standard claude-code adapter
    const results: AgentResult[] = [];
    for (const step of steps) {
      results.push(await this.fallbackAdapter.spawn(step));
    }
    return results;
  }

  private spawnClaudeProcess(
    prompt: string,
    opts: {
      workdir: string;
      model?: string;
      additionalEnv?: Record<string, string>;
      logPrefix?: string;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = ['-p', prompt, '--yes'];
    if (opts.model) {
      args.push('--model', opts.model);
    }

    const spawnOpts: Parameters<typeof supervisedSpawn>[0] = {
      command: 'claude',
      args,
      cwd: opts.workdir
    };
    if (opts.additionalEnv) spawnOpts.env = opts.additionalEnv;
    if (opts.logPrefix) spawnOpts.logPrefix = `${opts.logPrefix} [teams]`;

    return supervisedSpawn(spawnOpts);
  }
}

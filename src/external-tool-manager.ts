import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';
const logger = getLogger('external-tool-manager');

export interface ExternalToolConfig {
  enableExternal: boolean;
  dryRun: boolean;
  logFile?: string;
}

export interface CommandExecution {
  command: string;
  args: string[];
  workingDir: string;
  timestamp: string;
  exitCode?: number;
  output?: string;
  error?: string;
  duration?: number;
}

export interface ToolAvailability {
  gh: boolean;
  vercel: boolean;
  netlify: boolean;
}

/**
 * External Tool Manager - handles external CLI tool execution with safety gating
 * All external commands require explicit user confirmation via enableExternal flag
 */
export class ExternalToolManager {
  private config: ExternalToolConfig;
  private executionLog: CommandExecution[] = [];
  private toolAvailability?: ToolAvailability;

  constructor(config: ExternalToolConfig) {
    this.config = config;
  }

  /**
   * Detect which external tools are available
   */
  async detectAvailableTools(): Promise<ToolAvailability> {
    if (this.toolAvailability) {
      return this.toolAvailability;
    }

    const availability: ToolAvailability = {
      gh: await this.isToolAvailable('gh'),
      vercel: await this.isToolAvailable('vercel'),
      netlify: await this.isToolAvailable('netlify')
    };

    this.toolAvailability = availability;
    return availability;
  }

  /**
   * Check if a specific tool is available
   */
  private async isToolAvailable(toolName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', [toolName]);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  /**
   * Execute external command with safety gating
   */
  async executeCommand(
    command: string,
    args: string[],
    options: {
      workingDir?: string;
      requireTool?: keyof ToolAvailability;
    } = {}
  ): Promise<CommandExecution> {
    const execution: CommandExecution = {
      command,
      args: this.sanitizeArgs(args), // Remove any potential secrets
      workingDir: options.workingDir || process.cwd(),
      timestamp: new Date().toISOString()
    };

    // Check tool availability if required
    if (options.requireTool) {
      const tools = await this.detectAvailableTools();
      if (!tools[options.requireTool]) {
        execution.exitCode = -1;
        execution.error = `Tool '${options.requireTool}' not available`;
        this.logExecution(execution);
        return execution;
      }
    }

    // Dry run mode: log but don't execute
    if (this.config.dryRun) {
      logger.info(`[DRY RUN] Would execute: ${command} ${args.join(' ')}`);
      logger.info(`  Working dir: ${execution.workingDir}`);
      execution.exitCode = 0;
      execution.output = '[DRY RUN - not executed]';
      this.logExecution(execution);
      return execution;
    }

    // Safety gate: require explicit external permission
    if (!this.config.enableExternal) {
      execution.exitCode = -1;
      execution.error = 'External tool execution disabled. Use --enable-external flag.';
      this.logExecution(execution);
      return execution;
    }

    // Execute command
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: execution.workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        execution.exitCode = code || 0;
        execution.output = stdout;
        if (stderr) execution.error = stderr;
        execution.duration = Date.now() - startTime;

        this.logExecution(execution);
        resolve(execution);
      });

      proc.on('error', (err) => {
        execution.exitCode = -1;
        execution.error = err.message;
        execution.duration = Date.now() - startTime;
        this.logExecution(execution);
        resolve(execution);
      });
    });
  }

  /**
   * Sanitize command arguments to remove secrets
   */
  private sanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
      // Hide tokens and keys
      if (arg.includes('token=') || arg.includes('key=') || arg.includes('secret=')) {
        const parts = arg.split('=');
        return `${parts[0]}=[REDACTED]`;
      }
      return arg;
    });
  }

  /**
   * Log command execution
   */
  private logExecution(execution: CommandExecution): void {
    this.executionLog.push(execution);

    // Write to log file if specified
    if (this.config.logFile) {
      const logDir = path.dirname(this.config.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logEntry = JSON.stringify(execution, null, 2) + '\n';
      fs.appendFileSync(this.config.logFile, logEntry);
    }
  }

  /**
   * Get execution log
   */
  getExecutionLog(): CommandExecution[] {
    return [...this.executionLog];
  }
}

export default ExternalToolManager;

import * as fs from 'fs';
import * as path from 'path';
import { SteeringCommand, OrchestratorState, STEERING_COMMANDS } from './steering-types';
import ConflictResolver from './conflict-resolver';

/**
 * Steering Router - processes human steering commands and updates orchestrator state
 */
export class SteeringRouter {
  private state: OrchestratorState;
  private conflictResolver: ConflictResolver;
  private runDir: string;
  private steeringLog: SteeringCommand[] = [];

  constructor(conflictResolver: ConflictResolver, runDir: string, readOnly: boolean = false) {
    this.conflictResolver = conflictResolver;
    this.runDir = runDir;
    this.state = {
      status: 'idle',
      currentWave: 0,
      pausedSteps: [],
      pendingConflicts: [],
      steeringHistory: [],
      readOnly
    };
    this.loadSteeringLog();
  }

  /**
   * Get current orchestrator state
   */
  getState(): OrchestratorState {
    // refresh pending conflicts from resolver
    this.state.pendingConflicts = this.conflictResolver.getPendingConflicts();
    return { ...this.state };
  }

  /**
   * Update orchestrator status
   */
  updateStatus(status: OrchestratorState['status']): void {
    this.state.status = status;
  }

  /**
   * Update current wave
   */
  updateWave(wave: number): void {
    this.state.currentWave = wave;
  }

  /**
   * Process a steering command
   */
  async processCommand(command: SteeringCommand): Promise<{
    success: boolean;
    message: string;
    action?: 'pause' | 'resume' | 'approve' | 'reject' | 'help';
  }> {
    if (this.state.readOnly) {
      return {
        success: false,
        message: 'Read-only mode: commands not allowed'
      };
    }

    // Log command
    this.logSteering(command);

    switch (command.type) {
      case 'pause':
        return this.handlePause(command);
      
      case 'resume':
        return this.handleResume(command);
      
      case 'approve':
        return this.handleApprove(command);
      
      case 'reject':
        return this.handleReject(command);
      
      case 'prioritize':
        return this.handlePrioritize(command);
      
      case 'help':
        return this.handleHelp();
      
      default:
        return {
          success: false,
          message: `Unknown command: ${command.type}`
        };
    }
  }

  /**
   * Handle pause command
   */
  private handlePause(_command: SteeringCommand): { success: boolean; message: string; action: 'pause' } {
    if (this.state.status === 'paused') {
      return {
        success: false,
        message: 'Execution is already paused',
        action: 'pause'
      };
    }

    if (this.state.status !== 'running') {
      return {
        success: false,
        message: `Cannot pause when status is: ${this.state.status}`,
        action: 'pause'
      };
    }

    this.state.status = 'paused';
    
    return {
      success: true,
      message: 'Execution paused. Wave will complete current operations then halt.',
      action: 'pause'
    };
  }

  /**
   * Handle resume command
   */
  private handleResume(_command: SteeringCommand): { success: boolean; message: string; action: 'resume' } {
    if (this.state.status !== 'paused') {
      return {
        success: false,
        message: 'Execution is not paused',
        action: 'resume'
      };
    }

    this.state.status = 'running';
    
    return {
      success: true,
      message: 'Execution resumed',
      action: 'resume'
    };
  }

  /**
   * Handle approve command
   */
  private handleApprove(command: SteeringCommand): { success: boolean; message: string; action: 'approve' } {
    const nextConflict = this.conflictResolver.getNextConflict();
    
    if (!nextConflict) {
      return {
        success: false,
        message: 'No pending conflicts to approve',
        action: 'approve'
      };
    }

    const approved = this.conflictResolver.approveConflict(nextConflict.id, command.userId);
    
    if (approved) {
      return {
        success: true,
        message: `Approved conflict: ${nextConflict.description}`,
        action: 'approve'
      };
    } else {
      return {
        success: false,
        message: 'Failed to approve conflict',
        action: 'approve'
      };
    }
  }

  /**
   * Handle reject command
   */
  private handleReject(command: SteeringCommand): { success: boolean; message: string; action: 'reject' } {
    const nextConflict = this.conflictResolver.getNextConflict();
    
    if (!nextConflict) {
      return {
        success: false,
        message: 'No pending conflicts to reject',
        action: 'reject'
      };
    }

    const rejected = this.conflictResolver.rejectConflict(nextConflict.id, command.userId);
    
    if (rejected) {
      return {
        success: true,
        message: `Rejected conflict: ${nextConflict.description}`,
        action: 'reject'
      };
    } else {
      return {
        success: false,
        message: 'Failed to reject conflict',
        action: 'reject'
      };
    }
  }

  /**
   * Handle prioritize command
   */
  private handlePrioritize(command: SteeringCommand): { success: boolean; message: string } {
    if (!command.target) {
      return {
        success: false,
        message: 'Prioritize requires a step number'
      };
    }

    // Note: actual prioritization would require orchestrator integration
    // For now, just log it
    return {
      success: true,
      message: `Prioritization noted for step ${command.target}. (Not yet implemented in orchestrator)`
    };
  }

  /**
   * Handle help command
   */
  private handleHelp(): { success: boolean; message: string; action: 'help' } {
    const commands = Object.entries(STEERING_COMMANDS)
      .map(([cmd, desc]) => `  ${cmd}: ${desc}`)
      .join('\n');

    return {
      success: true,
      message: `Available commands:\n${commands}`,
      action: 'help'
    };
  }

  /**
   * Log steering command to audit trail
   */
  private logSteering(command: SteeringCommand): void {
    this.steeringLog.push(command);
    this.state.steeringHistory.push(command);
    this.saveSteeringLog();
  }

  /**
   * Save steering log to disk
   */
  private saveSteeringLog(): void {
    const logPath = path.join(this.runDir, 'steering-log.json');
    fs.writeFileSync(
      logPath,
      JSON.stringify(this.steeringLog, null, 2),
      'utf8'
    );
  }

  /**
   * Load steering log from disk
   */
  private loadSteeringLog(): void {
    const logPath = path.join(this.runDir, 'steering-log.json');
    
    if (fs.existsSync(logPath)) {
      try {
        const data = fs.readFileSync(logPath, 'utf8');
        this.steeringLog = JSON.parse(data);
        this.state.steeringHistory = [...this.steeringLog];
      } catch {
        this.steeringLog = [];
        this.state.steeringHistory = [];
      }
    }
  }

  /**
   * Get steering history
   */
  getSteeringHistory(): SteeringCommand[] {
    return [...this.steeringLog];
  }
}

export default SteeringRouter;

import * as fs from 'fs';
import * as path from 'path';
import { Conflict } from './steering-types';

/**
 * Conflict Resolver - manages conflict approval queue
 */
export class ConflictResolver {
  private conflicts: Map<string, Conflict> = new Map();
  private runDir: string;

  constructor(runDir: string) {
    this.runDir = runDir;
    this.loadConflictsFromDisk();
  }

  /**
   * Add a conflict that requires human approval
   */
  addConflict(conflict: Omit<Conflict, 'id' | 'resolved'>): Conflict {
    const id = `conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullConflict: Conflict = {
      ...conflict,
      id,
      resolved: false
    };

    this.conflicts.set(id, fullConflict);
    this.saveConflictsToDisk();

    return fullConflict;
  }

  /**
   * Get all pending (unresolved) conflicts
   */
  getPendingConflicts(): Conflict[] {
    return Array.from(this.conflicts.values())
      .filter(c => !c.resolved)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Get next conflict that needs approval
   */
  getNextConflict(): Conflict | null {
    const pending = this.getPendingConflicts();
    return pending.length > 0 ? pending[0] : null;
  }

  /**
   * Approve a conflict
   */
  approveConflict(conflictId: string, userId: string): boolean {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) {
      return false;
    }

    conflict.resolved = true;
    conflict.resolution = 'approved';
    conflict.resolvedBy = userId;
    conflict.resolvedAt = new Date().toISOString();

    this.conflicts.set(conflictId, conflict);
    this.saveConflictsToDisk();

    return true;
  }

  /**
   * Reject a conflict
   */
  rejectConflict(conflictId: string, userId: string): boolean {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) {
      return false;
    }

    conflict.resolved = true;
    conflict.resolution = 'rejected';
    conflict.resolvedBy = userId;
    conflict.resolvedAt = new Date().toISOString();

    this.conflicts.set(conflictId, conflict);
    this.saveConflictsToDisk();

    return true;
  }

  /**
   * Get conflict by ID
   */
  getConflict(conflictId: string): Conflict | null {
    return this.conflicts.get(conflictId) || null;
  }

  /**
   * Get all conflicts (for audit)
   */
  getAllConflicts(): Conflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Save conflicts to disk for persistence
   */
  private saveConflictsToDisk(): void {
    const conflictsPath = path.join(this.runDir, 'conflicts.json');
    const conflictsArray = Array.from(this.conflicts.values());

    fs.writeFileSync(
      conflictsPath,
      JSON.stringify(conflictsArray, null, 2),
      'utf8'
    );
  }

  /**
   * Load conflicts from disk
   */
  private loadConflictsFromDisk(): void {
    const conflictsPath = path.join(this.runDir, 'conflicts.json');

    if (fs.existsSync(conflictsPath)) {
      try {
        const data = fs.readFileSync(conflictsPath, 'utf8');
        const conflictsArray: Conflict[] = JSON.parse(data);
        
        conflictsArray.forEach(conflict => {
          this.conflicts.set(conflict.id, conflict);
        });
      } catch {
        // If file is corrupted, start fresh
        this.conflicts.clear();
      }
    }
  }
}

export default ConflictResolver;

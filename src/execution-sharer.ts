import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ShareableExecution {
  shareId: string;
  executionId: string;
  runDir: string;
  goal: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Execution Sharer - generates shareable execution IDs for read-only observation
 */
export class ExecutionSharer {
  private sharesDir: string;

  constructor(sharesDir?: string) {
    this.sharesDir = sharesDir || path.join(process.cwd(), 'runs', '.shares');
    if (!fs.existsSync(this.sharesDir)) {
      fs.mkdirSync(this.sharesDir, { recursive: true });
    }
  }

  /**
   * Create a shareable link for an execution
   */
  createShare(executionId: string, runDir: string, goal: string, expiresInHours?: number): ShareableExecution {
    const shareId = this.generateShareId();
    const createdAt = new Date().toISOString();
    
    const share: ShareableExecution = {
      shareId,
      executionId,
      runDir,
      goal,
      createdAt,
      ...(expiresInHours && {
        expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
      })
    };

    this.saveShare(share);

    return share;
  }

  /**
   * Get execution details from share ID
   */
  getShare(shareId: string): ShareableExecution | null {
    const sharePath = path.join(this.sharesDir, `${shareId}.json`);
    
    if (!fs.existsSync(sharePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(sharePath, 'utf8');
      const share: ShareableExecution = JSON.parse(data);

      // Check if expired
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        this.deleteShare(shareId);
        return null;
      }

      return share;
    } catch {
      return null;
    }
  }

  /**
   * Delete a share
   */
  deleteShare(shareId: string): boolean {
    const sharePath = path.join(this.sharesDir, `${shareId}.json`);
    
    if (fs.existsSync(sharePath)) {
      fs.unlinkSync(sharePath);
      return true;
    }

    return false;
  }

  /**
   * List all active shares
   */
  listShares(): ShareableExecution[] {
    if (!fs.existsSync(this.sharesDir)) {
      return [];
    }

    const files = fs.readdirSync(this.sharesDir);
    const shares: ShareableExecution[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const shareId = file.replace('.json', '');
        const share = this.getShare(shareId);
        
        if (share) {
          shares.push(share);
        }
      }
    }

    return shares;
  }

  /**
   * Clean up expired shares
   */
  cleanupExpired(): number {
    const shares = this.listShares();
    let cleaned = 0;

    for (const share of shares) {
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        this.deleteShare(share.shareId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Generate a secure share ID
   */
  private generateShareId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Save share to disk
   */
  private saveShare(share: ShareableExecution): void {
    const sharePath = path.join(this.sharesDir, `${share.shareId}.json`);
    fs.writeFileSync(
      sharePath,
      JSON.stringify(share, null, 2),
      'utf8'
    );
  }
}

export default ExecutionSharer;

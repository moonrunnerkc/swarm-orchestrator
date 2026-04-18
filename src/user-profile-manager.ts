import * as fs from 'fs';
import * as path from 'path';
import { UserProfile } from './metrics-types';
import { AgentProfile } from './config-loader';
import { getLogger } from './logger';
const logger = getLogger('user-profile-manager');

const PROFILE_SCHEMA_VERSION = 1;

/**
 * Manages user profile and preferences
 * Loads from config/user-profile.json
 */
export default class UserProfileManager {
  private profilePath: string;
  private profile: UserProfile | null = null;

  constructor(configDir: string = 'config') {
    this.profilePath = path.join(configDir, 'user-profile.json');
  }

  /**
   * Load user profile from disk
   */
  loadProfile(): UserProfile {
    if (this.profile !== null) {
      return this.profile;
    }

    if (!fs.existsSync(this.profilePath)) {
      // Create default profile
      const defaultProfile = this.createDefaultProfile();
      this.profile = defaultProfile;
      this.saveProfile();
      return defaultProfile;
    }

    try {
      const content = fs.readFileSync(this.profilePath, 'utf8');
      const parsed = JSON.parse(content);
      
      // Validate schema version
      if (parsed.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        logger.warn(`Profile schema mismatch: expected ${PROFILE_SCHEMA_VERSION}, got ${parsed.schemaVersion}`);
        const defaultProfile = this.createDefaultProfile();
        this.profile = defaultProfile;
        this.saveProfile();
        return defaultProfile;
      }

      this.profile = parsed as UserProfile;
      return this.profile;
    } catch (error) {
      logger.warn('Failed to load user profile, using defaults:', error instanceof Error ? error.message : error);
      const defaultProfile = this.createDefaultProfile();
      this.profile = defaultProfile;
      this.saveProfile();
      return defaultProfile;
    }
  }

  /**
   * Save profile to disk
   */
  saveProfile(): void {
    if (!this.profile) {
      return;
    }

    const dir = path.dirname(this.profilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = this.profilePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.profile, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.profilePath);
  }

  /**
   * Update preferences
   */
  updatePreferences(updates: Partial<UserProfile['preferences']>): void {
    const profile = this.loadProfile();
    profile.preferences = {
      ...profile.preferences,
      ...updates
    };
    this.saveProfile();
  }

  /**
   * Update learned behaviors
   */
  updateLearnedBehaviors(updates: Partial<UserProfile['learnedBehaviors']>): void {
    const profile = this.loadProfile();
    profile.learnedBehaviors = {
      ...profile.learnedBehaviors,
      ...updates
    };
    this.saveProfile();
  }

  /**
   * Apply profile preferences to agent instructions
   * Returns modified instructions with audit log
   */
  applyToAgentInstructions(
    agent: AgentProfile,
    originalInstructions: string
  ): { instructions: string; modifications: string[] } {
    const profile = this.loadProfile();
    const modifications: string[] = [];
    let instructions = originalInstructions;

    // Apply commit style preference
    if (profile.preferences.commitStyle) {
      const styleGuidance = this.getCommitStyleGuidance(profile.preferences.commitStyle);
      instructions += `\n\n${styleGuidance}`;
      modifications.push(`Added ${profile.preferences.commitStyle} commit style guidance`);
    }

    // Apply verbosity preference
    if (profile.preferences.verbosity) {
      const verbosityGuidance = this.getVerbosityGuidance(profile.preferences.verbosity);
      instructions += `\n\n${verbosityGuidance}`;
      modifications.push(`Applied ${profile.preferences.verbosity} verbosity level`);
    }

    return { instructions, modifications };
  }

  /**
   * Get agent priority (1-10, default 5)
   */
  getAgentPriority(agentName: string): number {
    const profile = this.loadProfile();
    return profile.preferences.agentPriorities?.[agentName] || 5;
  }

  /**
   * Create default profile
   */
  private createDefaultProfile(): UserProfile {
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: {
        commitStyle: 'mixed',
        verbosity: 'normal'
      }
    };
  }

  /**
   * Get commit style guidance text
   */
  private getCommitStyleGuidance(style: string): string {
    switch (style) {
      case 'conventional':
        return 'User preference: Use conventional commits format strictly (feat:, fix:, docs:, etc.)';
      case 'imperative':
        return 'User preference: Use imperative mood (Add feature, Fix bug, Update docs)';
      case 'descriptive':
        return 'User preference: Use descriptive, detailed commit messages explaining what and why';
      case 'mixed':
        return 'User preference: Vary commit style naturally between conventional, imperative, and descriptive';
      default:
        return '';
    }
  }

  /**
   * Get verbosity guidance text
   */
  private getVerbosityGuidance(verbosity: string): string {
    switch (verbosity) {
      case 'minimal':
        return 'User preference: Keep output minimal and concise. Avoid verbose explanations.';
      case 'normal':
        return 'User preference: Provide balanced output with key information and context.';
      case 'detailed':
        return 'User preference: Provide detailed explanations, reasoning, and context for all actions.';
      default:
        return '';
    }
  }
}

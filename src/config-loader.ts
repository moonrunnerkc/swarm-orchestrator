import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { getLogger } from './logger';

const logger = getLogger('config-loader');

export interface AgentProfile {
  name: string;
  purpose: string;
  scope: string[];
  boundaries: string[];
  done_definition: string[];
  refusal_rules: string[];
  output_contract: {
    transcript: string;
    artifacts: string[];
  };
  // Custom agent metadata from .agent.md files
  customAgentPath?: string;
  description?: string;
  tools?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentConfig {
  agents: AgentProfile[];
}

/**
 * Custom agent frontmatter from .agent.md files
 */
export interface CustomAgentFrontmatter {
  name: string;
  description: string;
  target?: string;
  tools?: string[];
  infer?: boolean;
  metadata?: Record<string, unknown>;
}

export class ConfigLoader {
  private configDir: string;
  private customAgentsDir: string;

  constructor(configDir?: string) {
    const cwd = process.cwd();
    const packageRoot = this.findPackageRoot(__dirname);

    this.configDir = configDir || this.resolveConfigDir(cwd, packageRoot);
    this.customAgentsDir = this.resolveCustomAgentsDir(cwd, packageRoot);
    logger.debug(`agent config dir: ${this.configDir}`);
    logger.debug(`custom agents dir: ${this.customAgentsDir}`);
  }

  private findPackageRoot(startDir: string): string {
    // walk upwards until we find a package.json
    let current = startDir;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(current, 'package.json');
      if (fs.existsSync(candidate)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    // fallback: best effort
    return startDir;
  }

  private resolveConfigDir(cwd: string, packageRoot: string): string {
    const cwdConfig = path.join(cwd, 'config');
    if (fs.existsSync(path.join(cwdConfig, 'default-agents.yaml'))) {
      return cwdConfig;
    }

    const pkgConfig = path.join(packageRoot, 'config');
    if (fs.existsSync(path.join(pkgConfig, 'default-agents.yaml'))) {
      return pkgConfig;
    }

    return cwdConfig;
  }

  private resolveCustomAgentsDir(cwd: string, packageRoot: string): string {
    const cwdAgents = path.join(cwd, '.github', 'agents');
    if (fs.existsSync(cwdAgents)) {
      return cwdAgents;
    }

    const pkgAgents = path.join(packageRoot, '.github', 'agents');
    if (fs.existsSync(pkgAgents)) {
      return pkgAgents;
    }

    return cwdAgents;
  }

  loadDefaultAgents(): AgentConfig {
    const filePath = path.join(this.configDir, 'default-agents.yaml');
    return this.loadAgentFile(filePath);
  }

  loadUserAgents(): AgentConfig {
    const filePath = path.join(this.configDir, 'user-agents.yaml');
    return this.loadAgentFile(filePath);
  }

  /**
   * Load all agents: custom .agent.md files + YAML configs
   * Custom agents take precedence over YAML
   */
  loadAllAgents(): AgentProfile[] {
    const agentMap = new Map<string, AgentProfile>();

    // Load YAML configs first (legacy/fallback)
    try {
      const defaultAgents = this.loadDefaultAgents();
      logger.debug(`loaded default agents from ${path.join(this.configDir, 'default-agents.yaml')}`);
      defaultAgents.agents.forEach(agent => {
        agentMap.set(agent.name, agent);
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.warn(`Failed to load default agents: ${err.message}`);
    }

    try {
      const userAgents = this.loadUserAgents();
      logger.debug(`loaded user agents from ${path.join(this.configDir, 'user-agents.yaml')}`);
      userAgents.agents.forEach(agent => {
        agentMap.set(agent.name, agent);
      });
    } catch {
      // User agents YAML (config/user-agents.yaml) is optional; missing file is normal
    }

    // Load custom .agent.md files (override YAML if name matches)
    const customAgents = this.loadCustomAgents();
    customAgents.forEach(agent => {
      agentMap.set(agent.name, agent);
    });

    return Array.from(agentMap.values());
  }

  /**
   * Load custom agents from .github/agents/*.agent.md
   */
  loadCustomAgents(): AgentProfile[] {
    if (!fs.existsSync(this.customAgentsDir)) {
      logger.debug(`no custom agents directory at ${this.customAgentsDir}`);
      return [];
    }

    const agentFiles = fs.readdirSync(this.customAgentsDir)
      .filter(file => file.endsWith('.agent.md'));

    const agents: AgentProfile[] = [];

    for (const file of agentFiles) {
      try {
        const agentPath = path.join(this.customAgentsDir, file);
        const agent = this.parseCustomAgentFile(agentPath);
        if (agent) {
          agents.push(agent);
        }
      } catch (error: unknown) {
        const err = error as Error;
        logger.warn(`Failed to load custom agent ${file}: ${err.message}`);
      }
    }

    return agents;
  }

  /**
   * Parse a .agent.md custom agent file
   */
  private parseCustomAgentFile(filePath: string): AgentProfile | null {
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract frontmatter (YAML between --- markers)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch || !frontmatterMatch[1]) {
      logger.warn(`No frontmatter found in ${filePath}`);
      return null;
    }

    const frontmatter = yaml.load(frontmatterMatch[1]) as CustomAgentFrontmatter;

    // Extract markdown content after frontmatter
    const markdownContent = content.substring(frontmatterMatch[0].length).trim();

    // Parse sections from markdown
    const scope = this.extractMarkdownSection(markdownContent, 'Scope');
    const boundaries = this.extractMarkdownSection(markdownContent, 'Boundaries');
    const doneDefinition = this.extractMarkdownSection(markdownContent, 'Done Definition');
    const refusalRules = this.extractMarkdownSection(markdownContent, 'Refusal Rules');

    // Convert custom agent to AgentProfile format
    const agent: AgentProfile = {
      name: frontmatter.name,
      purpose: frontmatter.description,
      scope: scope.length > 0 ? scope : ['See .agent.md file for details'],
      boundaries: boundaries.length > 0 ? boundaries : ['See .agent.md file for details'],
      done_definition: doneDefinition.length > 0 ? doneDefinition : ['See .agent.md file for details'],
      refusal_rules: refusalRules.length > 0 ? refusalRules : ['Follow agent guidelines'],
      output_contract: {
        transcript: `proof/step-{N}-${frontmatter.name.replace(/_/g, '-')}.md`,
        artifacts: []
      },
      customAgentPath: filePath,
      description: frontmatter.description,
      ...(frontmatter.tools && { tools: frontmatter.tools }),
      ...(frontmatter.metadata && { metadata: frontmatter.metadata })
    };

    return agent;
  }

  /**
   * Extract bullet point list from markdown section
   */
  private extractMarkdownSection(markdown: string, sectionHeader: string): string[] {
    const items: string[] = [];

    // Find section header (## Scope or ## Boundaries, etc.)
    const headerRegex = new RegExp(`##\\s+${sectionHeader}[^\\n]*\\n`, 'i');
    const match = markdown.match(headerRegex);

    if (!match || match.index === undefined) {
      return items;
    }

    // Extract content until next ## header or end
    const startIndex = match.index + match[0].length;
    const remainingContent = markdown.substring(startIndex);
    const nextHeaderMatch = remainingContent.match(/\n##\s+/);
    const sectionContent = nextHeaderMatch
      ? remainingContent.substring(0, nextHeaderMatch.index)
      : remainingContent;

    // Extract bullet points (lines starting with - or *)
    const lines = sectionContent.split('\n');
    for (const line of lines) {
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch && bulletMatch[1]) {
        items.push(bulletMatch[1].trim());
      }
    }

    return items;
  }

  /**
   * Get agent name for --agent flag (converts names to match .agent.md naming)
   */
  getAgentCLIName(agentName: string): string {
    // If agent has customAgentPath, use the name from frontmatter
    const agent = this.getAgentByName(agentName);
    if (agent?.customAgentPath) {
      return agent.name; // already in correct format from frontmatter
    }

    // Otherwise convert "FrontendExpert" -> "frontend_expert"
    return agentName
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  private loadAgentFile(filePath: string): AgentConfig {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(content) as AgentConfig;

    this.validateConfig(config, filePath);
    return config;
  }

  private validateConfig(config: AgentConfig, filePath: string): void {
    if (!config || typeof config !== 'object') {
      throw new Error(`Invalid config format in ${filePath}`);
    }

    if (!Array.isArray(config.agents)) {
      throw new Error(`Missing 'agents' array in ${filePath}`);
    }

    config.agents.forEach((agent, index) => {
      this.validateAgent(agent, `${filePath}[${index}]`);
    });
  }

  private validateAgent(agent: AgentProfile, context: string): void {
    const requiredFields = [
      'name',
      'purpose',
      'scope',
      'boundaries',
      'done_definition',
      'output_contract',
      'refusal_rules'
    ];

    for (const field of requiredFields) {
      if (!(field in agent)) {
        throw new Error(`Missing required field '${field}' in agent at ${context}`);
      }
    }

    // Validate name is non-empty string
    if (typeof agent.name !== 'string' || agent.name.trim() === '') {
      throw new Error(`Agent name must be non-empty string at ${context}`);
    }

    // Validate purpose is non-empty string
    if (typeof agent.purpose !== 'string' || agent.purpose.trim() === '') {
      throw new Error(`Agent purpose must be non-empty string at ${context}`);
    }

    // Validate arrays
    const arrayFields: (keyof AgentProfile)[] = ['scope', 'boundaries', 'done_definition', 'refusal_rules'];
    for (const field of arrayFields) {
      if (!Array.isArray(agent[field])) {
        throw new Error(`Agent field '${field}' must be an array at ${context}`);
      }
    }

    // Validate output_contract
    if (!agent.output_contract || typeof agent.output_contract !== 'object') {
      throw new Error(`Agent output_contract must be an object at ${context}`);
    }

    if (typeof agent.output_contract.transcript !== 'string') {
      throw new Error(`Agent output_contract.transcript must be a string at ${context}`);
    }

    if (!Array.isArray(agent.output_contract.artifacts)) {
      throw new Error(`Agent output_contract.artifacts must be an array at ${context}`);
    }
  }

  getAgentByName(name: string): AgentProfile | undefined {
    const allAgents = this.loadAllAgents();
    // Exact match first, then normalized match (handles PascalCase vs snake_case)
    return allAgents.find(agent => agent.name === name)
      || allAgents.find(agent => ConfigLoader.normalizeAgentName(agent.name) === ConfigLoader.normalizeAgentName(name));
  }

  /**
   * Build an agent map keyed by name, with snake_case aliases for PascalCase names.
   * Plans and demos use snake_case (frontend_expert), YAML uses PascalCase (FrontendExpert).
   * Both must resolve to the same agent profile.
   */
  buildAgentMap(): Map<string, AgentProfile> {
    const agents = this.loadAllAgents();
    const map = new Map<string, AgentProfile>();
    for (const agent of agents) {
      map.set(agent.name, agent);
      const snakeName = ConfigLoader.normalizeAgentName(agent.name);
      if (snakeName !== agent.name && !map.has(snakeName)) {
        map.set(snakeName, agent);
      }
    }
    return map;
  }

  /**
   * Normalize agent name to snake_case for consistent lookups.
   * FrontendExpert -> frontend_expert, frontend_expert -> frontend_expert
   */
  static normalizeAgentName(name: string): string {
    return name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/__+/g, '_');
  }
}

export default ConfigLoader;

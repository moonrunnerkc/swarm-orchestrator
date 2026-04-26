import * as fs from 'fs';
import * as path from 'path';
import { AgentProfile } from './config-loader';
import { PlanStep } from './plan-generator';

/**
 * Scope rule defining allow/deny patterns for file operations.
 */
export interface ScopeRule {
  allow: string[];
  deny: string[];
}

/**
 * Configuration for generating hooks for a single step execution.
 */
export interface HookGenerationInput {
  step: PlanStep;
  agent: AgentProfile;
  executionId: string;
  runDir: string;
  stepBranch: string;
  workingDir: string;
  /** Pre-existing test files to protect from modification by non-testing agents */
  existingTestFiles?: string[];
}

/**
 * Result of generating hooks for a step.
 * hooksDir points to the .github/hooks directory inside the working dir.
 * Copilot CLI auto-loads hooks from <gitRoot>/.github/hooks/*.json.
 */
export interface GeneratedHooks {
  hooksDir: string;
  hooksFilePath: string;
  evidenceLogPath: string;
  scopeRules: ScopeRule;
}

/**
 * Version 1 hook config as consumed by the Copilot CLI SDK.
 * Each event maps to an array of command entries. Context for each
 * event is piped to the command's stdin as a JSON string.
 */
interface CopilotHookConfig {
  version: 1;
  hooks: {
    sessionStart?: CopilotHookCommand[];
    preToolUse?: CopilotHookCommand[];
    postToolUse?: CopilotHookCommand[];
    errorOccurred?: CopilotHookCommand[];
  };
}

interface CopilotHookCommand {
  type: 'command';
  bash: string;
  timeoutSec?: number;
}

/**
 * Evidence entry captured by postToolUse hooks.
 * Written as JSONL (one JSON object per line) to the evidence log.
 */
export interface EvidenceEntry {
  timestamp: string;
  event: string;
  tool: string;
  filePath?: string;
  sha?: string;
  testsPassed?: number;
  testsFailed?: number;
  exitCode?: number;
  contentHash?: string;
  /** Present on scope_violation entries: which agent triggered the violation */
  agentName?: string;
  /** Present on scope_violation entries: the boundary rule that was violated */
  boundaryRule?: string;
}

/**
 * Generates per-step Copilot CLI hook files that enforce scope boundaries
 * during execution and capture structured evidence in real-time.
 *
 * Hooks are written to <workingDir>/.github/hooks/ which the Copilot CLI
 * SDK auto-loads on session start. Context (toolName, toolArgs, toolResult)
 * is piped to hook commands via stdin as JSON.
 */
export class HookGenerator {

  /**
   * Generate hooks for a single step execution.
   * Writes a hook config to <workingDir>/.github/hooks/ and returns
   * paths needed for evidence parsing after execution.
   */
  generateStepHooks(input: HookGenerationInput): GeneratedHooks {
    const hooksDir = path.join(input.workingDir, '.github', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const evidenceDir = path.join(input.runDir, 'evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const evidenceLogPath = path.join(evidenceDir, `step-${input.step.stepNumber}.jsonl`);

    const scopeRules = this.deriveScopeRules(input.agent, input.existingTestFiles);

    const hookConfig = this.buildHookConfig(scopeRules, evidenceLogPath, input);
    const hooksFilePath = path.join(hooksDir, `swarm-step-${input.step.stepNumber}.json`);
    fs.writeFileSync(hooksFilePath, JSON.stringify(hookConfig, null, 2));

    return { hooksDir, hooksFilePath, evidenceLogPath, scopeRules };
  }

  /**
   * Remove the generated hooks file after step execution.
   * The evidence log is NOT removed (it lives in the run directory).
   */
  cleanupHooks(hooksFileOrDir: string): void {
    try {
      const stat = fs.statSync(hooksFileOrDir);
      if (stat.isDirectory()) {
        // Legacy path: remove temp directory from old approach
        fs.rmSync(hooksFileOrDir, { recursive: true, force: true });
      } else {
        // Remove the single hooks JSON file we created
        fs.unlinkSync(hooksFileOrDir);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Parse an evidence JSONL file into structured entries.
   */
  parseEvidenceLog(evidenceLogPath: string): EvidenceEntry[] {
    if (!fs.existsSync(evidenceLogPath)) return [];

    const content = fs.readFileSync(evidenceLogPath, 'utf8').trim();
    if (!content) return [];

    const entries: EvidenceEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as EvidenceEntry);
      } catch {
        // Skip malformed lines; hooks may produce partial output on kill
      }
    }
    return entries;
  }

  /**
   * Derive scope rules from agent boundaries.
   * Agent boundaries contain natural-language rules like
   * "Do not modify frontend components or UI code". These are mapped
   * to file path patterns for hook enforcement.
   */
  deriveScopeRules(agent: AgentProfile, existingTestFiles?: string[]): ScopeRule {
    const allow: string[] = [];
    const deny: string[] = [];

    for (const scope of agent.scope) {
      const lower = scope.toLowerCase();
      if (lower.includes('frontend') || lower.includes('ui') || lower.includes('component')) {
        allow.push('src/components', 'src/pages', 'src/views', 'public', 'styles', '.css', '.scss', '.html');
      }
      if (lower.includes('backend') || lower.includes('server') || lower.includes('api')) {
        allow.push('src/api', 'src/server', 'src/routes', 'src/middleware', 'server', 'api');
      }
      if (lower.includes('test') || lower.includes('quality')) {
        allow.push('test', 'tests', '__tests__', 'spec', '.test.', '.spec.');
      }
      if (lower.includes('ci/cd') || lower.includes('docker') || lower.includes('deployment')) {
        allow.push('.github', 'Dockerfile', 'docker-compose', '.env', 'deploy');
      }
      if (lower.includes('security')) {
        allow.push('src', 'config', 'package.json');
      }
    }

    for (const boundary of agent.boundaries) {
      const lower = boundary.toLowerCase();
      if (lower.includes('frontend') || lower.includes('ui')) {
        deny.push('src/components', 'src/pages', 'src/views', '.css', '.scss');
      }
      if (lower.includes('backend') || lower.includes('server')) {
        deny.push('src/api', 'src/server', 'src/routes', 'server');
      }
      if (lower.includes('database') || lower.includes('schema') || lower.includes('migration')) {
        deny.push('migrations', 'prisma/schema', 'db/schema');
      }
      if (lower.includes('ci/cd') || lower.includes('pipeline') || lower.includes('infrastructure')) {
        deny.push('.github/workflows', 'Dockerfile');
      }
      if (lower.includes('test framework')) {
        deny.push('jest.config', 'mocha', '.mocharc');
      }
    }

    // Protect pre-existing test files from modification by default.
    // Reviewer steps are read-only and do not write to any files.
    // Worker steps must not modify existing tests unless the goal explicitly requires it.
    const canModifyTests = agent.name === 'reviewer';
    if (!canModifyTests && existingTestFiles && existingTestFiles.length > 0) {
      for (const testFile of existingTestFiles) {
        deny.push(testFile);
      }
    }

    return {
      allow: [...new Set(allow)],
      deny: [...new Set(deny)]
    };
  }

  // Scope enforcement via preToolUse hooks. The SDK reads the
  // permissionDecision field from the hook's JSON stdout. When a file path
  // matches a deny rule and no allow rule overrides it, the hook outputs
  // "deny" with a reason. The SDK blocks the tool call and injects the
  // reason into the agent's context. Violations are also logged to the
  // evidence file so the verification layer can flag them independently.

  /**
   * Build a bash script that reads context JSON from stdin, checks the
   * file path against deny/allow rules, and either denies the tool call
   * (via permissionDecision) or approves it. Violations are logged to
   * the evidence file regardless for verification-layer enforcement.
   */
  buildPreToolUseScript(scopeRules: ScopeRule, evidenceLogPath: string, agentName: string): string {
    const rulesJson = JSON.stringify({ allow: scopeRules.allow, deny: scopeRules.deny });
    const escapedPath = evidenceLogPath.replace(/'/g, "'\\'");
    const safeAgent = agentName.replace(/'/g, '');
    // Node reads context from stdin, checks scope rules, denies out-of-scope tool calls, logs violations
    return `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const ctx=JSON.parse(d);const rules=${rulesJson.replace(/"/g, '\\"')};const p=(ctx.toolArgs||{}).path||(ctx.toolArgs||{}).filePath||'';if(p&&rules.deny.length>0){const denied=rules.deny.some(r=>p.includes(r));if(denied){const allowed=rules.allow.some(r=>p.includes(r));if(!allowed){const rule=rules.deny.find(r=>p.includes(r));const entry={timestamp:new Date().toISOString(),event:'scope_violation',tool:ctx.toolName||'unknown',filePath:p,agentName:'${safeAgent}',boundaryRule:rule};require('fs').appendFileSync('${escapedPath}',JSON.stringify(entry)+'\\n');process.stdout.write(JSON.stringify({permissionDecision:'deny',permissionDecisionReason:'Scope violation: '+p+' is outside agent boundary ('+rule+')'}));return}}}process.stdout.write(JSON.stringify({permissionDecision:'approve'}))}catch(e){process.stdout.write(JSON.stringify({permissionDecision:'approve'}))}})"`;
  }

  /**
   * Build a bash script that reads context JSON from stdin and appends
   * a structured evidence entry to the JSONL log file.
   */
  buildPostToolUseScript(evidenceLogPath: string): string {
    const escapedPath = evidenceLogPath.replace(/'/g, "'\\''");
    return `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const ctx=JSON.parse(d);const entry={timestamp:new Date().toISOString(),event:'postToolUse',tool:ctx.toolName||'unknown',filePath:(ctx.toolArgs||{}).path||(ctx.toolArgs||{}).filePath,exitCode:ctx.toolResult?ctx.toolResult.exitCode:undefined};require('fs').appendFileSync('${escapedPath}',JSON.stringify(entry)+'\\n')}catch(e){}})"`;
  }

  // ---------------------------------------------------------------------------
  // Private: build complete hook config
  // ---------------------------------------------------------------------------

  private buildHookConfig(
    scopeRules: ScopeRule,
    evidenceLogPath: string,
    input: HookGenerationInput
  ): CopilotHookConfig {
    const escapedEvidence = evidenceLogPath.replace(/'/g, "'\\''");

    return {
      version: 1,
      hooks: {
        sessionStart: [{
          type: 'command',
          bash: `node -e "const entry={timestamp:new Date().toISOString(),event:'sessionStart',tool:'session',filePath:'${input.stepBranch}'};try{require('fs').appendFileSync('${escapedEvidence}',JSON.stringify(entry)+'\\n')}catch(e){}"`,
          timeoutSec: 10
        }],
        preToolUse: [{
          type: 'command',
          bash: this.buildPreToolUseScript(scopeRules, evidenceLogPath, input.agent.name),
          timeoutSec: 10
        }],
        postToolUse: [{
          type: 'command',
          bash: this.buildPostToolUseScript(evidenceLogPath),
          timeoutSec: 10
        }],
        errorOccurred: [{
          type: 'command',
          bash: `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const ctx=JSON.parse(d);const entry={timestamp:new Date().toISOString(),event:'errorOccurred',tool:'error',exitCode:1};require('fs').appendFileSync('${escapedEvidence}',JSON.stringify(entry)+'\\n')}catch(e){}})"`,
          timeoutSec: 10
        }]
      }
    };
  }
}

export default HookGenerator;

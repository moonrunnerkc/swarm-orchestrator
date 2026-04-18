// Extracted prompt-building and shared-instruction helpers (formerly class methods on SwarmOrchestrator).

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { AgentProfile } from './config-loader';
import { ExecutionPlan, PlanStep } from './plan-generator';
import { BaselineSnapshot, formatPreservationRules } from './baseline-scanner';
import { getLogger } from './logger';

const logger = getLogger('prompt-builder');

/**
 * Context subset needed by `buildSwarmPrompt`.
 * Mirrors the fields it actually reads from SwarmExecutionContext.
 */
export interface PromptBuildContext {
  plan: ExecutionPlan;
  baselineSnapshot?: BaselineSnapshot;
}

/**
 * Build the per-step prompt that gets sent to the Copilot CLI agent.
 */
export function buildSwarmPrompt(
  step: PlanStep,
  agent: AgentProfile,
  context: PromptBuildContext,
  dependencyContext: string,
): string {
  const sections: string[] = [];

  sections.push(`Step ${step.stepNumber}/${context.plan.steps.length} | Agent: ${agent.name}`);
  sections.push(`Role: ${agent.purpose}\n`);

  sections.push('TASK:');
  sections.push(step.task + '\n');

  if (dependencyContext && dependencyContext.trim().length > 0) {
    sections.push('DEPENDENCY CONTEXT:');
    sections.push(dependencyContext + '\n');
  }

  sections.push('BRANCH: you are already on your correct branch in a dedicated git worktree.');
  sections.push('Do NOT run git checkout or switch branches.\n');

  sections.push('Scope (what you ARE responsible for):');
  agent.scope.forEach(item => sections.push('- ' + item));
  sections.push('');

  sections.push('Boundaries (what you must NOT do):');
  agent.boundaries.forEach(item => sections.push('- ' + item));
  sections.push('');

  // Surface existing test files so agents know what they must not break.
  // Full preservation rules live in .copilot-instructions.md; this is a
  // per-step reminder with the actual filenames.
  const baseline = context.baselineSnapshot;
  if (baseline && baseline.testFiles.length > 0) {
    sections.push('EXISTING TESTS (must still pass after your changes):');
    for (const f of baseline.testFiles) {
      sections.push('- ' + f);
    }
    sections.push('Do NOT modify, delete, or rewrite any test files. Only edit source code.');
    sections.push('Test files are verified by an external harness and your edits will cause patch conflicts.');
    sections.push('');
  }

  sections.push('Done when:');
  agent.done_definition.forEach(item => sections.push('- ' + item));
  sections.push('');

  if (agent.refusal_rules.length > 0) {
    sections.push('Refusal rules (stop and explain instead of proceeding):');
    agent.refusal_rules.forEach(rule => sections.push('- ' + rule));
    sections.push('');
  }

  // Hard rules, quality standards, git/comment conventions live in
  // .copilot-instructions.md (written once per run). Not duplicated here
  // to keep prompt tokens low and avoid double-loading by Claude Code.

  sections.push('Expected outputs:');
  step.expectedOutputs.forEach(output => sections.push('- ' + output));
  sections.push('');

  sections.push('When finished, verify your work actually works before committing. Run tests if applicable. Check that files you created are syntactically valid.');

  return sections.join('\n');
}

/**
 * Write `.copilot-instructions.md` into the working directory so every
 * worktree / agent inherits shared rules via a single committed file.
 */
export function writeSharedInstructions(
  workingDir: string,
  baseline?: BaselineSnapshot,
  tierInjection?: string,
): void {
  const instructionsPath = path.join(workingDir, '.copilot-instructions.md');
  // Only write if the file does not already exist (avoid overwriting user content)
  if (fs.existsSync(instructionsPath)) return;

  const contentParts = [
    '# Swarm Agent Instructions',
    '',
    '## Parallel Execution Context',
    'You are running inside a git worktree on a dedicated branch. Do NOT run `git checkout`.',
    'Make incremental commits with natural, varied messages.',
    '',
    '## Hard Rules',
    '- Do not invent features, flags, APIs, or tool behavior not in your task.',
    '- Do not claim tests passed unless you ran them and can show the output.',
    '- Do not say "done" unless all required artifacts exist and you verified them.',
    '- If uncertain about anything, say so explicitly.',
    '- Never reference files, images, fonts, or assets that do not exist in the repo.',
    '- Encapsulate JS: wrap in IIFE, module, or DOMContentLoaded. No bare globals in script scope.',
    '',
  ];

  // Tier-filtered requirements replace the old flat "Quality Bar" section.
  // Only requirements relevant to the detected task type get injected.
  if (tierInjection && tierInjection.trim().length > 0) {
    contentParts.push(tierInjection);
    contentParts.push('');
  }

  contentParts.push(
    '## Quality Bar',
    '- Code reads as human-written. No AI-typical patterns: no over-commented obvious logic, no generic variable names, no boilerplate filler.',
    '- Extract before repeat: if you copy the same logic more than twice, refactor into a shared util/hook/middleware.',
    '- Config first: do not hardcode API base URLs, timeouts, retry counts, or environment-specific values.',
    '- README truth: do not claim features that are not implemented. Do not add sections that do not apply (no troubleshooting tables for trivial projects).',
    '- Error messages must be specific and actionable with relevant values.',
    '',
    '## Code Comments',
    '- Add a 1-2 line purpose comment at the top of each new file.',
    '- Add brief inline comments for non-obvious logic (not every line).',
    '- Use natural, casual language. Good: "// bail early if empty". Bad: "// Check if the array has zero length".',
    '',
    '## Commit Messages',
    'Use varied, natural messages like:',
    '  "add user authentication module"',
    '  "fix: handle null case in parser"',
    '  "update config and deps"',
    '  "implement todo API with tests"',
    '',
  );

  // Append baseline preservation rules when the repo has existing files
  if (baseline && baseline.allFiles.length > 0) {
    const rules = formatPreservationRules(baseline);
    if (rules) contentParts.push(rules);
  }

  const content = contentParts.join('\n');

  fs.writeFileSync(instructionsPath, content, 'utf8');

  // Commit so worktrees (branched from main) inherit the instructions file
  try {
    execSync('git add .copilot-instructions.md', { cwd: workingDir, stdio: 'pipe' });
    execSync('git commit -m "add shared copilot instructions for swarm agents"', {
      cwd: workingDir, stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    // Commit may fail if repo has no initial commit yet; non-fatal
    logger.warn('Could not commit .copilot-instructions.md (non-fatal)');
  }
}

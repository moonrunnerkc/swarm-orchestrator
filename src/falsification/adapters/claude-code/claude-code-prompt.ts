/**
 * Prompt construction for the ClaudeCode falsifier.
 *
 * Strategy: same adversarial-input strategy as Copilot, applied to the
 * same two obligation types (`import-graph-must-satisfy` and
 * `function-must-have-signature`). The body of each per-type prompt is
 * delegated to `buildCopilotPrompt` so the two adapters describe the
 * task identically — Phase 4's measurement question is "does same-family
 * (Anthropic-vs-Anthropic-producer) diversity catch anything cross-family
 * (Copilot, OpenAI) didn't?", and that question is only well-posed if
 * both adapters get the same prompt text. Source-of-truth lives in
 * `copilot-prompt.ts`; this file is a thin re-export so the dependency
 * is visible in import-graph diffs.
 *
 * Phase 4's pre-registration locks the prompt as "whatever Copilot's
 * prompt was at this commit." If Copilot's prompt changes in a future
 * phase, ClaudeCode's prompt changes in lockstep — there is no
 * adapter-specific iteration of the prompt body. (The candidate count
 * constant is also re-exported for the parser, which uses it to
 * validate count.)
 */

import { buildCopilotPrompt, COPILOT_CANDIDATE_COUNT } from '../copilot/copilot-prompt';

export const CLAUDE_CODE_CANDIDATE_COUNT = COPILOT_CANDIDATE_COUNT;

export const buildClaudeCodePrompt = buildCopilotPrompt;

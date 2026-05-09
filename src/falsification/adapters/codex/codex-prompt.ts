/**
 * Prompt construction for the Codex falsifier.
 *
 * The strategy is *adversarial test input generation*: given a
 * `property-must-hold` obligation, ask Codex to produce three candidate
 * adversarial inputs that would make the predicate fail. Codex describes
 * the inputs as a JSON document; the adapter applies and re-runs each
 * candidate locally so the dispatcher does not have to trust Codex's
 * self-report.
 *
 * The prompt is kept deterministic and self-describing so changes here are
 * auditable in diff. Phase 1 dev gate verifies the prompt against 20
 * obligations; if yield is zero the strategy iterates *once* (per the
 * plan's stop condition).
 */

import type { PropertyMustHoldObligation } from '../../../contract/types';

/**
 * Number of candidate adversarial inputs requested per call. Locked at
 * three per the Phase 1 spec; changes here count as a strategy iteration.
 */
export const CODEX_CANDIDATE_COUNT = 3;

/**
 * Build the Codex prompt for a single `property-must-hold` obligation.
 *
 * The prompt:
 * - Names the predicate command and its target.
 * - Describes the workspace as the directory Codex is launched in (the
 *   dispatcher passes `--cd <workspaceRoot>`).
 * - Asks Codex to *describe* (not apply) three candidate adversarial
 *   inputs as a single JSON document, fenced in a ```json``` block.
 * - Caps each candidate to a small set of new files inside the workspace.
 * - Forbids touching existing files: the adapter rejects any candidate
 *   that names a path which already exists, keeping the workspace
 *   reproducible across candidates.
 */
export function buildCodexPrompt(obligation: PropertyMustHoldObligation): string {
  return [
    'You are an adversarial test-input generator running inside a',
    'workspace-write sandbox. Your task is to falsify the property-must-hold',
    'obligation below by describing concrete inputs that would cause the',
    'predicate command to exit with a non-zero status (the predicate exits',
    'zero when the property holds; non-zero means the property does not).',
    '',
    `Predicate target: ${obligation.target}`,
    `Predicate command: ${obligation.predicate}`,
    '',
    'Constraints, all hard:',
    '1. Do NOT modify the workspace yourself. The orchestrator applies the',
    '   inputs you describe.',
    `2. Produce exactly ${CODEX_CANDIDATE_COUNT} candidates, each with a short`,
    '   rationale and a list of NEW files to add (relPath relative to the',
    '   workspace root, plus byte content as a UTF-8 string).',
    '3. Do not propose paths that already exist in the workspace; the',
    '   orchestrator rejects those without running them.',
    '4. Do not propose paths under .git, node_modules, dist, runs, .swarm,',
    '   or any other generated/ignored directory. Use a fresh subdirectory',
    '   if the predicate scopes its search to a specific path; otherwise',
    '   place files under the workspace root with descriptive names.',
    '5. Each candidate should be independent — the adapter applies one at a',
    '   time and removes it before applying the next.',
    '6. Reply with one fenced ```json``` block matching the schema below.',
    '   No prose before, after, or inside the block.',
    '',
    'Schema:',
    '```json',
    '{',
    '  "candidates": [',
    '    {',
    '      "name": "string identifier, kebab-case",',
    '      "rationale": "one-sentence explanation of why this should',
    '        falsify the predicate",',
    '      "files": [',
    '        { "relPath": "path/relative/to/workspace.ext",',
    '          "bytes": "file content as a single UTF-8 string" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Now produce the JSON for this obligation.',
  ].join('\n');
}

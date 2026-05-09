/**
 * Prompt construction for the Copilot falsifier.
 *
 * Strategy: import-graph perturbation and function-signature drift. Given an
 * obligation of type `import-graph-must-satisfy` or
 * `function-must-have-signature`, ask Copilot to describe three candidate
 * perturbations of the workspace that would cause the obligation to fail.
 * The adapter applies and re-verifies each candidate locally so the
 * dispatcher does not have to trust Copilot's self-report.
 *
 * Differences from the Codex prompt:
 *   - Candidates may both ADD new files and OVERWRITE existing ones.
 *     Function-signature drift requires editing the existing source file;
 *     ADD-only generation cannot falsify a "function X must have signature
 *     S in file F" obligation.
 *   - The prompt is obligation-type-aware. Two distinct text bodies — one
 *     per supported obligation type — keep the strategy concrete.
 *
 * The prompt is kept deterministic and self-describing so changes here are
 * auditable in diff. Phase 3 measurement uses the prompt verbatim; any
 * iteration is a strategy change and must be recorded in DECISIONS.md.
 */

import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../../contract/types';

/**
 * Number of candidate adversarial perturbations requested per call. Locked
 * at three to mirror Codex's count; changes here count as a strategy
 * iteration and must be recorded in DECISIONS.md.
 */
export const COPILOT_CANDIDATE_COUNT = 3;

/**
 * Build the Copilot prompt for a single supported obligation. The prompt
 * branches on obligation type so each variant gets a concrete description
 * of how to perturb the workspace; the JSON schema and constraints are
 * shared.
 */
export function buildCopilotPrompt(
  obligation: ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation,
): string {
  const body =
    obligation.type === 'import-graph-must-satisfy'
      ? buildImportGraphPromptBody(obligation)
      : buildSignaturePromptBody(obligation);
  return [body, '', sharedSchemaBlock(), '', 'Now produce the JSON for this obligation.'].join(
    '\n',
  );
}

function buildImportGraphPromptBody(obligation: ImportGraphMustSatisfyObligation): string {
  const constraintExplanation =
    obligation.constraint === 'no-cycles'
      ? [
          'The constraint is `no-cycles`: the local import graph rooted at the',
          'scope must contain no directed cycle. To falsify, propose new files',
          'inside the scope whose imports form a cycle (e.g., A imports B,',
          'B imports A; or a longer chain that closes back on itself).',
          'Imports that resolve outside the scope are ignored, so the cycle',
          'must be entirely between files inside the scope.',
        ].join('\n')
      : [
          'The constraint is `no-upward-imports`: no relative import in any',
          'file under the scope may begin with `..` (escape its directory).',
          'To falsify, propose at least one new file under the scope whose',
          'import statement begins with `..` (e.g. `import x from "../../foo"`).',
        ].join('\n');
  return [
    'You are an adversarial perturbation generator running inside an isolated',
    'workspace. Your task is to falsify the import-graph-must-satisfy',
    'obligation below by describing concrete file perturbations that would',
    'cause the structural constraint to fail.',
    '',
    `Obligation type: import-graph-must-satisfy`,
    `Constraint: ${obligation.constraint}`,
    `Scope (relative directory walked by the verifier): ${obligation.scope}`,
    '',
    constraintExplanation,
    '',
    'Constraints, all hard:',
    '1. Do NOT modify the workspace yourself. The orchestrator applies the',
    '   files you describe.',
    `2. Produce exactly ${COPILOT_CANDIDATE_COUNT} candidates, each with a short`,
    '   rationale and a list of files to add or overwrite (relPath relative',
    '   to the workspace root, plus byte content as a UTF-8 string).',
    '3. Each candidate must be independently sufficient — the orchestrator',
    '   applies one candidate at a time and rolls back before applying the',
    '   next, so candidates must not depend on each other.',
    `4. Files must use a source extension the verifier walks: .ts, .tsx,`,
    '   .cts, .mts, .js, .jsx, .mjs, .cjs, .py. Anything else is silently',
    '   ignored by the verifier.',
    `5. Place files inside the scope ${obligation.scope}; files outside the`,
    '   scope are not walked and cannot trigger the constraint.',
    '6. Do not write under .git, node_modules, dist, runs, .swarm, or any',
    '   ignored directory.',
  ].join('\n');
}

function buildSignaturePromptBody(obligation: FunctionMustHaveSignatureObligation): string {
  return [
    'You are an adversarial perturbation generator running inside an isolated',
    'workspace. Your task is to falsify the function-must-have-signature',
    'obligation below by describing concrete file perturbations that would',
    "cause the AST-backed signature check to report mismatch (or remove the",
    "function entirely).",
    '',
    `Obligation type: function-must-have-signature`,
    `File (relative to workspace root): ${obligation.file}`,
    `Function/method name: ${obligation.name}`,
    `Expected signature substring: ${obligation.signature}`,
    '',
    'A candidate falsifies the obligation when, after applying its files,',
    'the file at the obligation path either:',
    '  (a) no longer declares a function/method named ' + obligation.name + ';',
    '  (b) declares it with a different normalized signature; or',
    '  (c) cannot be parsed at all (so the AST extractor finds no match).',
    'Each candidate should be a full replacement of the target file with a',
    'concrete drift — different parameter list, different return type,',
    'renamed function, removed function, etc. Keep the rest of the file',
    'syntactically valid TypeScript so the AST extractor still runs and the',
    'mismatch is reported as a real signature drift rather than a parser',
    'error.',
    '',
    'Constraints, all hard:',
    '1. Do NOT modify the workspace yourself. The orchestrator applies the',
    '   files you describe.',
    `2. Produce exactly ${COPILOT_CANDIDATE_COUNT} candidates, each with a short`,
    '   rationale and a list of files to add or overwrite.',
    '3. Each candidate must be independently sufficient — the orchestrator',
    '   applies one candidate at a time and rolls back before applying the',
    `   next. Each candidate should overwrite ${obligation.file} with a`,
    '   different drift; do not propose three identical candidates.',
    '4. Distinct candidates must produce distinct drifts (e.g. different',
    '   parameter signatures, different return types, function deleted vs',
    '   renamed). The diversity is what tests Copilot\'s coverage of the',
    '   falsification surface.',
  ].join('\n');
}

function sharedSchemaBlock(): string {
  return [
    'Reply with one fenced ```json``` block matching the schema below. No',
    'prose before, after, or inside the block.',
    '',
    'Schema:',
    '```json',
    '{',
    '  "candidates": [',
    '    {',
    '      "name": "string identifier, kebab-case",',
    '      "rationale": "one-sentence explanation of why this should',
    '        falsify the obligation",',
    '      "files": [',
    '        { "relPath": "path/relative/to/workspace.ext",',
    '          "bytes": "file content as a single UTF-8 string" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');
}

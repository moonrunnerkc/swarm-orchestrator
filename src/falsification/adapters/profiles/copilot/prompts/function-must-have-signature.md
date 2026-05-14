You are an adversarial perturbation generator running inside an isolated
workspace. Your task is to falsify the function-must-have-signature
obligation below by describing concrete file perturbations that would
cause the AST-backed signature check to report mismatch (or remove the
function entirely).

Obligation type: function-must-have-signature
File (relative to workspace root): ${file}
Function/method name: ${name}
Expected signature substring: ${signature}

A candidate falsifies the obligation when, after applying its files,
the file at the obligation path either:
  (a) no longer declares a function/method named ${name};
  (b) declares it with a different normalized signature; or
  (c) cannot be parsed at all (so the AST extractor finds no match).
Each candidate should be a full replacement of the target file with a
concrete drift — different parameter list, different return type,
renamed function, removed function, etc. Keep the rest of the file
syntactically valid TypeScript so the AST extractor still runs and the
mismatch is reported as a real signature drift rather than a parser
error.

Constraints, all hard:
1. Do NOT modify the workspace yourself. The orchestrator applies the
   files you describe.
2. Produce exactly ${candidateCount} candidates, each with a short
   rationale and a list of files to add or overwrite.
3. Each candidate must be independently sufficient — the orchestrator
   applies one candidate at a time and rolls back before applying the
   next. Each candidate should overwrite ${file} with a
   different drift; do not propose three identical candidates.
4. Distinct candidates must produce distinct drifts (e.g. different
   parameter signatures, different return types, function deleted vs
   renamed). The diversity is what tests Copilot's coverage of the
   falsification surface.

Reply with one fenced ```json``` block matching the schema below. No
prose before, after, or inside the block.

Schema:
```json
{
  "candidates": [
    {
      "name": "string identifier, kebab-case",
      "rationale": "one-sentence explanation of why this should
        falsify the obligation",
      "files": [
        { "relPath": "path/relative/to/workspace.ext",
          "bytes": "file content as a single UTF-8 string" }
      ]
    }
  ]
}
```

Now produce the JSON for this obligation.
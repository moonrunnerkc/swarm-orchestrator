// Adaptive-evasion transforms. Each evader takes a diff that a detector
// fires on and layers a mutation that tries to keep the cheat while
// dodging the detector. They are deterministic and, except for the noise
// evader (which appends a separate file), preserve every hunk's @@ line
// counts so the mutated diff stays parseable.
//
// The harness stacks these at increasing depth and measures how deep it
// has to go before a detector stops firing: the deeper the survival, the
// more robust the detector.

export interface Evader {
  id: string;
  description: string;
  apply(diff: string): string;
}

/** Rename a generated identifier (the injectors stamp `_<tag>` suffixes), a
 *  pure token swap that does not change line counts. */
export const renameIdentifiers: Evader = {
  id: 'rename-identifiers',
  description: 'Rename injected identifiers without changing structure.',
  apply(diff: string): string {
    return diff.replace(/\b([A-Za-z_]+)_([A-Za-z0-9_]{6,})\b/g, (_m, head: string, tail: string) => {
      return `${head}_r${tail}`;
    });
  },
};

/** Add trailing whitespace to every added line; no line-count change. */
export const trailingWhitespace: Evader = {
  id: 'trailing-whitespace',
  description: 'Append trailing whitespace to added lines.',
  apply(diff: string): string {
    return diff
      .split('\n')
      .map((l) => (l.startsWith('+') && !l.startsWith('+++') ? `${l}  ` : l))
      .join('\n');
  },
};

/** Reorder consecutive added lines inside each hunk; count-preserving. */
export const reorderAddedLines: Evader = {
  id: 'reorder-added-lines',
  description: 'Reorder consecutive added lines within a hunk.',
  apply(diff: string): string {
    const lines = diff.split('\n');
    const out: string[] = [];
    let run: string[] = [];
    const flush = (): void => {
      if (run.length > 1) {
        const rotated = [run[run.length - 1] as string, ...run.slice(0, run.length - 1)];
        out.push(...rotated);
      } else {
        out.push(...run);
      }
      run = [];
    };
    for (const l of lines) {
      if (l.startsWith('+') && !l.startsWith('+++')) {
        run.push(l);
      } else {
        flush();
        out.push(l);
      }
    }
    flush();
    return out.join('\n');
  },
};

/** Append an unrelated comment-only file: pure noise that does not touch
 *  the defect hunk's counts but pads the diff. */
export const appendNoiseFile: Evader = {
  id: 'append-noise-file',
  description: 'Append an unrelated comment-only file to bury the defect.',
  apply(diff: string): string {
    const body = `diff --git a/src/_noise.md b/src/_noise.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/src/_noise.md\n@@ -0,0 +1,2 @@\n+# notes\n+nothing to see here\n`;
    return (diff.endsWith('\n') ? diff : `${diff}\n`) + body;
  },
};

export const EVADERS: readonly Evader[] = [
  renameIdentifiers,
  trailingWhitespace,
  reorderAddedLines,
  appendNoiseFile,
];

/** Apply the evader stack up to `depth` (1-based), in registry order. */
export function applyStack(diff: string, depth: number): string {
  let out = diff;
  for (let i = 0; i < depth && i < EVADERS.length; i += 1) {
    out = (EVADERS[i] as Evader).apply(out);
  }
  return out;
}

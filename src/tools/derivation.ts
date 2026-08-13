import type { ProvenanceTag } from "../core/model-client.ts";

export interface UntrustedSource {
  /** How the content reached the model: file contents read, or another tool's output. */
  readonly tag: Extract<ProvenanceTag, "file" | "tool-output">;
  readonly label: string;
  /** Digest of the recorded content, so a flagged call points at the evidence it came from. */
  readonly digest: string;
}

export interface DerivationSettings {
  /** How many recent untrusted reads stay in the window. */
  readonly windowSize: number;
  readonly ngramSize: number;
  /** Overlap fraction at or above which a call is treated as plausibly derived. */
  readonly threshold: number;
  /** Shortest argument that a verbatim containment match is allowed to fire on. */
  readonly minSubstringLength: number;
}

export const defaultDerivationSettings: DerivationSettings = {
  windowSize: 8,
  ngramSize: 3,
  threshold: 0.6,
  minSubstringLength: 12,
};

export interface DerivationAssessment {
  readonly matched: boolean;
  readonly score: number;
  readonly method: "substring" | "ngram" | "none";
  readonly source: UntrustedSource | null;
  readonly settings: DerivationSettings;
}

export interface DerivationHeuristic {
  readonly settings: DerivationSettings;
  observe(content: string, source: UntrustedSource): void;
  assess(argument: string): DerivationAssessment;
}

interface WindowEntry {
  readonly source: UntrustedSource;
  readonly normalized: string;
  readonly grams: ReadonlySet<string>;
}

/**
 * Flags tool-call arguments that look copied out of content the model recently read.
 *
 * Provenance tags alone cannot detect derivation: everything the model emits carries the
 * model tag, including a command lifted verbatim from a file it just read. So this matches
 * text instead, by verbatim containment or normalized n-gram overlap over a recent window.
 *
 * Read the label literally. This is a tunable heuristic with a false-positive rate, not an
 * information-flow guarantee: it has no taint lattice, no dataflow, and no knowledge of
 * whether the overlap it found actually influenced the call. Benign overlap (the model
 * running a command the README documents) fires it, and rephrased injected instructions
 * slip past it. Window size, n-gram size, and threshold are all meant to be tuned against
 * observed rates rather than trusted at their defaults.
 */
export function createDerivationHeuristic(
  overrides: Partial<DerivationSettings> = {},
): DerivationHeuristic {
  const settings: DerivationSettings = { ...defaultDerivationSettings, ...overrides };
  const window: WindowEntry[] = [];

  return {
    settings,

    observe(content: string, source: UntrustedSource): void {
      const normalized = normalize(content);
      if (normalized.length === 0) {
        return;
      }
      window.unshift({ source, normalized, grams: gramsOf(normalized, settings.ngramSize) });
      window.length = Math.min(window.length, settings.windowSize);
    },

    assess(argument: string): DerivationAssessment {
      const normalized = normalize(argument);
      let best: DerivationAssessment = {
        matched: false,
        score: 0,
        method: "none",
        source: null,
        settings,
      };
      if (normalized.length === 0) {
        return best;
      }

      const argumentGrams = gramsOf(normalized, settings.ngramSize);

      for (const entry of window) {
        if (
          normalized.length >= settings.minSubstringLength &&
          entry.normalized.includes(normalized)
        ) {
          return { matched: true, score: 1, method: "substring", source: entry.source, settings };
        }

        if (argumentGrams.size === 0) {
          continue;
        }
        let shared = 0;
        for (const gram of argumentGrams) {
          if (entry.grams.has(gram)) {
            shared += 1;
          }
        }
        const score = shared / argumentGrams.size;
        if (score > best.score) {
          best = {
            matched: score >= settings.threshold,
            score,
            method: "ngram",
            source: entry.source,
            settings,
          };
        }
      }

      return best;
    },
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function gramsOf(normalized: string, size: number): ReadonlySet<string> {
  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const grams = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    grams.add(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

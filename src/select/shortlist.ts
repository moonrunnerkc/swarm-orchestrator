import { z } from "zod";
import { localRuntimeNames } from "../providers/local-discovery.ts";

/** Bumped when the shape changes in a way an older build cannot read. */
export const shortlistSchemaVersion = 1;

const shortlistModelSchema = z.object({
  /** Exactly what the backend is asked for: an Ollama tag or an MLX repo path. */
  id: z.string().min(1),
  backend: z.enum(localRuntimeNames),
  parameters: z.string().min(1),
  quantization: z.string().min(1),
  diskGb: z.number().positive(),
  /**
   * Approximate resident working set at this quantization with a short context. Curated, not
   * measured on the user's machine: phase 5's calibration is what measures.
   */
  residentGb: z.number().positive(),
  contextWindow: z.number().int().positive(),
});

/**
 * How to get a backend running, as data. The runtimes' CLIs move faster than this tool's
 * release cadence, so a changed flag is a shortlist revision rather than a patch release.
 */
const shortlistBackendSchema = z.object({
  name: z.enum(localRuntimeNames),
  label: z.string().min(1),
  /** Where swarm will talk to it once it is serving; a bare host:port is not enough. */
  baseUrl: z.url({ protocol: /^https?$/ }),
  /** `{model}` is replaced with the chosen model's id. */
  install: z.string().min(1),
  serve: z.string().min(1),
});

const shortlistTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Higher means more capable hardware. The highest-ranked matching tier wins. */
  rank: z.number().int().nonnegative(),
  /**
   * Thresholds sit below the nominal size on purpose: firmware and the kernel reserve some of
   * a "16 GB" machine, so a probe that reports 15.5 GB is still a 16 GB machine.
   */
  minRamGb: z.number().nonnegative(),
  /** Null asks for no dedicated VRAM, so the tier still matches a machine with no GPU. */
  minVramGb: z.number().positive().nullable(),
  /** True or false pins the tier to one kind of machine; null matches either. */
  appleSilicon: z.boolean().nullable(),
  models: z.array(shortlistModelSchema).min(1),
});

const shortlistSchema = z.object({
  schemaVersion: z.literal(shortlistSchemaVersion),
  /** Dated rather than numbered: this file is curated, and the date is the useful fact. */
  revision: z.string().min(1),
  backends: z.array(shortlistBackendSchema).min(1),
  tiers: z.array(shortlistTierSchema).min(1),
});

export type ShortlistBackend = z.infer<typeof shortlistBackendSchema>;
export type ShortlistModel = z.infer<typeof shortlistModelSchema>;
export type ShortlistTier = z.infer<typeof shortlistTierSchema>;
export type Shortlist = z.infer<typeof shortlistSchema>;

const remedy =
  "Point at a known-good copy with --shortlist <file or url>, " +
  "or fall back to the snapshot that ships with this release with --shortlist bundled.";

export class MalformedShortlistError extends Error {
  readonly source: string;

  constructor(source: string, problem: string) {
    super(`the model shortlist from ${source} is not usable: ${problem}\n${remedy}`);
    this.name = "MalformedShortlistError";
    this.source = source;
  }
}

/**
 * The only way a shortlist enters the process (invariant 10). A shortlist decides which model
 * the user is told to download, so bad data is refused rather than partially honoured: silently
 * skipping a malformed tier would quietly change the recommendation.
 */
export function parseShortlist(text: string, source: string): Shortlist {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MalformedShortlistError(
      source,
      `it is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  refuseUnreadableVersion(value, source);

  const parsed = shortlistSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedShortlistError(source, `\n${z.prettifyError(parsed.error)}`);
  }
  refuseAmbiguousRanks(parsed.data, source);
  refuseUnservableModels(parsed.data, source);
  return parsed.data;
}

/**
 * Checked before the full parse so a newer file reports the one fact that explains every other
 * error it would otherwise produce.
 */
function refuseUnreadableVersion(value: unknown, source: string): void {
  const declared = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof declared === "number" && declared !== shortlistSchemaVersion) {
    throw new MalformedShortlistError(
      source,
      `it declares schema version ${declared} and this build reads version ` +
        `${shortlistSchemaVersion}. Upgrade swarm, or pin an older shortlist.`,
    );
  }
}

/** Equal ranks make the pick depend on array order, which is not a decision anyone made. */
function refuseAmbiguousRanks(shortlist: Shortlist, source: string): void {
  const seen = new Map<number, string>();
  for (const tier of shortlist.tiers) {
    const earlier = seen.get(tier.rank);
    if (earlier !== undefined) {
      throw new MalformedShortlistError(
        source,
        `tiers "${earlier}" and "${tier.id}" both claim rank ${tier.rank}, ` +
          "so which one wins would depend on the order they were written in.",
      );
    }
    seen.set(tier.rank, tier.id);
  }
}

/**
 * A model whose backend is not declared would be recommended with no command to start it,
 * which is a recommendation the user cannot act on.
 */
function refuseUnservableModels(shortlist: Shortlist, source: string): void {
  const declared = new Set<string>();
  for (const backend of shortlist.backends) {
    if (declared.has(backend.name)) {
      throw new MalformedShortlistError(
        source,
        `backend "${backend.name}" is declared twice, so the commands used to start it ` +
          "would depend on which entry was read first.",
      );
    }
    declared.add(backend.name);
  }

  for (const tier of shortlist.tiers) {
    for (const model of tier.models) {
      if (!declared.has(model.backend)) {
        throw new MalformedShortlistError(
          source,
          `model "${model.id}" in tier "${tier.id}" needs backend "${model.backend}", ` +
            "which the shortlist does not declare, so there would be no command to start it.",
        );
      }
    }
  }
}

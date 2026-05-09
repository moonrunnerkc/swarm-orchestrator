import { type ObligationV1, type RepoContext, type ExtractorProvenance } from '../types';

/**
 * Input given to a goal extractor: the natural-language goal plus repository
 * context the extractor can use to ground concrete commands.
 */
export interface ExtractorInput {
  goal: string;
  repoContext: RepoContext;
}

/**
 * Output of a goal extractor: a list of candidate obligations (raw, prior to
 * validation and canonicalization) plus provenance for the extraction step.
 *
 * Per impl guide §4 the seed of the LLM extraction must be recordable, so
 * `provenance` carries model id, temperature, and a sha256 of the prompt
 * that produced the output.
 */
export interface ExtractorOutput {
  obligations: ObligationV1[];
  provenance: ExtractorProvenance;
}

/**
 * Goal-to-obligations extractor. The compiler depends on this interface; the
 * Anthropic implementation is the production extractor (impl guide §4: "a
 * single LLM call (Sonnet tier)"); the stub implementation is used by tests
 * that need deterministic output and by `--extractor stub` for offline
 * inspection of the rest of the pipeline.
 */
export interface Extractor {
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
}

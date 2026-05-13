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
 * Goal-to-obligations extractor. The compiler depends on this interface;
 * three providers implement it: the deterministic extractor (default, no
 * model, accepts a hand-authored contract), the local extractor (any
 * OpenAI-compatible / Ollama / llama.cpp / vLLM endpoint), and the
 * Anthropic extractor (impl guide §4: a single Sonnet-tier call). The
 * verifier and the compiler are agnostic to which provider produced the
 * output.
 */
export interface Extractor {
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
}

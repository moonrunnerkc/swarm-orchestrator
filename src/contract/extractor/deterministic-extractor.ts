import {
  DeterministicExtractorError,
  envelopeSha,
  loadEnvelopeFile,
  loadEnvelopeModule,
  validateContractEnvelope,
  type ContractValidationIssue,
} from './scan-pipeline';
import { type ContractEnvelope } from './contract-schema';
import { type Extractor, type ExtractorInput, type ExtractorOutput } from './types';

export { DeterministicExtractorError };
export type DeterministicValidationIssue = ContractValidationIssue;

/**
 * Source of a contract envelope for the deterministic extractor.
 * Exactly one form is provided per construction.
 */
export type ContractSource =
  | { kind: 'file'; path: string }
  | { kind: 'module'; path: string }
  | { kind: 'inline'; envelope: ContractEnvelope };

export interface DeterministicExtractorOptions {
  source: ContractSource;
}

/**
 * Deterministic extractor: accepts a hand-authored contract envelope from
 * a file (YAML or JSON), a TypeScript/JavaScript module's default export,
 * or an inline literal, validates it against the shared schema, and emits
 * the obligations unchanged. Performs zero inference. Provenance carries
 * `promptSha256 = sha256(canonical envelope bytes)` so the contract
 * identity is reproducible across runs.
 *
 * @throws {DeterministicExtractorError} when the source's contents fail
 *         validation against the shared contract schema.
 */
export class DeterministicExtractor implements Extractor {
  private readonly source: ContractSource;

  constructor(options: DeterministicExtractorOptions) {
    this.source = options.source;
  }

  static fromFile(filePath: string): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'file', path: filePath } });
  }

  static fromModule(modulePath: string): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'module', path: modulePath } });
  }

  static fromInline(envelope: ContractEnvelope): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'inline', envelope } });
  }

  async extract(_input: ExtractorInput): Promise<ExtractorOutput> {
    const raw = await this.loadRaw();
    const envelope = validateContractEnvelope(raw, this.sourceLabel());
    return {
      obligations: envelope.obligations,
      provenance: {
        name: 'deterministic',
        model: null,
        temperature: null,
        promptSha256: envelopeSha(envelope),
      },
    };
  }

  private async loadRaw(): Promise<unknown> {
    if (this.source.kind === 'inline') return this.source.envelope;
    if (this.source.kind === 'file') return loadEnvelopeFile(this.source.path);
    return loadEnvelopeModule(this.source.path);
  }

  private sourceLabel(): string {
    if (this.source.kind === 'inline') return '<inline>';
    return this.source.path;
  }
}

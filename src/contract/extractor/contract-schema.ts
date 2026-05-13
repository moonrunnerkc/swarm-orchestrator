import { type ObligationV1 } from '../types';

/**
 * Shared JSON Schema describing the envelope every provider emits or accepts:
 * `{ obligations: ObligationV1[] }`. The Anthropic extractor embeds this as
 * the `submit_contract` tool's `input_schema`; the deterministic extractor
 * uses it to validate hand-authored contract files and modules; the local
 * extractor passes it to backends that support grammar-constrained decoding
 * against a JSON Schema.
 *
 * The per-obligation `oneOf` body intentionally matches the Anthropic tool
 * schema that shipped through Phases 1–7 byte-for-byte, so contract hashes
 * produced by the existing model remain stable. The on-disk single-obligation
 * schema (`src/contract/schema/v1.json`) additionally allows the optional
 * `deterministicStrategy` field that the post-extraction tagger writes — kept
 * out of this envelope schema because the LLM (and any hand-authored input
 * that goes through this validator) should not set the tag directly.
 */

/** Tool name used when the Anthropic extractor binds this schema as a tool. */
export const SUBMIT_CONTRACT_TOOL_NAME = 'submit_contract';

/** Tool description used when the Anthropic extractor binds this schema as a tool. */
export const SUBMIT_CONTRACT_TOOL_DESCRIPTION =
  'Submit the compiled list of contract obligations for the user goal.';

/** Typed envelope shape: a non-empty list of obligations. */
export interface ContractEnvelope {
  obligations: ObligationV1[];
}

/**
 * Structural type for a JSON Schema object. Wide enough to assign to the
 * Anthropic SDK's `Tool.input_schema` type without a double-cast, while
 * still typed for the providers that import the envelope.
 */
export interface JsonSchemaObject {
  type: 'object';
  required?: string[];
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * JSON Schema for the contract envelope. Providers import-by-reference; the
 * Anthropic extractor binds it as the `submit_contract` tool's input schema,
 * the deterministic extractor validates against it, and the local extractor
 * passes it to grammar-capable backends.
 */
export const SUBMIT_CONTRACT_INPUT_SCHEMA: JsonSchemaObject = {
  type: 'object',
  required: ['obligations'],
  properties: {
    obligations: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['type', 'path'],
            additionalProperties: false,
            properties: {
              type: { const: 'file-must-exist' },
              path: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'command'],
            additionalProperties: false,
            properties: {
              type: { const: 'build-must-pass' },
              command: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'command'],
            additionalProperties: false,
            properties: {
              type: { const: 'test-must-pass' },
              command: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'file', 'name', 'signature'],
            additionalProperties: false,
            properties: {
              type: { const: 'function-must-have-signature' },
              file: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              signature: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'predicate', 'target'],
            additionalProperties: false,
            properties: {
              type: { const: 'property-must-hold' },
              predicate: { type: 'string', minLength: 1 },
              target: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'constraint', 'scope'],
            additionalProperties: false,
            properties: {
              type: { const: 'import-graph-must-satisfy' },
              constraint: { type: 'string', enum: ['no-cycles', 'no-upward-imports'] },
              scope: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            required: ['type', 'scope', 'metric', 'threshold'],
            additionalProperties: false,
            properties: {
              type: { const: 'coverage-must-exceed' },
              scope: { type: 'string', minLength: 1 },
              metric: {
                type: 'string',
                enum: ['lines', 'statements', 'branches', 'functions'],
              },
              threshold: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
          {
            type: 'object',
            required: ['type', 'benchmark', 'baseline', 'threshold'],
            additionalProperties: false,
            properties: {
              type: { const: 'performance-must-not-regress' },
              benchmark: { type: 'string', minLength: 1 },
              baseline: { type: 'string', minLength: 1 },
              threshold: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        ],
      },
    },
  },
} as const;

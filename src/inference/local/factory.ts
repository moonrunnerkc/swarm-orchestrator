import { type LocalBackend, type BackendOptions } from './backend';
import { LlamaCppBackend } from './backends/llama-cpp';
import { OllamaBackend } from './backends/ollama';
import { OpenAiCompatibleBackend } from './backends/openai-compatible';
import { VllmBackend } from './backends/vllm';

/** Identifier accepted by the LOCAL_LLM_BACKEND env var / config field. */
export type LocalBackendName = 'openai-compatible' | 'ollama' | 'llama-cpp' | 'vllm';

/** Identifiers the factory accepts. */
export const LOCAL_BACKEND_NAMES: readonly LocalBackendName[] = [
  'openai-compatible',
  'ollama',
  'llama-cpp',
  'vllm',
] as const;

/**
 * Configuration the local-provider factories consume to construct a
 * backend. Mirrors `BackendOptions` plus the backend selector.
 */
export interface LocalBackendConfig extends BackendOptions {
  backend: LocalBackendName;
}

/**
 * Construct a backend instance from a resolved configuration. The caller
 * (the extractor / session factory) is responsible for resolving the
 * configuration from flags, env vars, and the project config file.
 *
 * @throws when the backend name is unknown or when required options are
 *         missing for the selected backend.
 */
export function buildLocalBackend(config: LocalBackendConfig): LocalBackend {
  if (!config.baseUrl) {
    throw new Error(
      'local backend selected but baseUrl is empty; ' +
        'set LOCAL_LLM_BASE_URL or pass --local-base-url',
    );
  }
  switch (config.backend) {
    case 'openai-compatible':
      return new OpenAiCompatibleBackend(config);
    case 'ollama':
      return new OllamaBackend(config);
    case 'llama-cpp':
      return new LlamaCppBackend(config);
    case 'vllm':
      return new VllmBackend(config);
    default:
      throw new Error(
        `unknown local backend "${config.backend as string}"; ` +
          `expected one of: ${LOCAL_BACKEND_NAMES.join(', ')}`,
      );
  }
}

/**
 * Resolve a backend name from the flag value, the LOCAL_LLM_BACKEND env
 * var, and a (no-)default. Returns the validated name.
 *
 * @throws when no source provides a valid backend name.
 */
export function resolveLocalBackendName(flagValue: string | null): LocalBackendName {
  const raw = flagValue ?? process.env.LOCAL_LLM_BACKEND ?? null;
  if (raw === null) {
    throw new Error(
      'local provider selected but no backend specified; ' +
        `set LOCAL_LLM_BACKEND (${LOCAL_BACKEND_NAMES.join(' | ')}) or pass --local-backend`,
    );
  }
  if (!LOCAL_BACKEND_NAMES.includes(raw as LocalBackendName)) {
    throw new Error(
      `invalid local backend "${raw}"; expected one of: ${LOCAL_BACKEND_NAMES.join(', ')}`,
    );
  }
  return raw as LocalBackendName;
}

/**
 * Resolve the local backend base URL from the flag, the env var, and a
 * (no-)default. Fail-loud when neither source provides a value.
 *
 * @throws when no base URL is available.
 */
export function resolveLocalBaseUrl(flagValue: string | null): string {
  const url = flagValue ?? process.env.LOCAL_LLM_BASE_URL ?? null;
  if (!url) {
    throw new Error(
      'local provider selected but LOCAL_LLM_BASE_URL is not set; ' +
        'set the env var or pass --local-base-url <url>',
    );
  }
  return url;
}

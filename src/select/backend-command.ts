import type { ShortlistBackend } from "./shortlist.ts";

interface BackendCommands {
  /** Gets the weights onto the machine. */
  readonly install: string;
  /** Starts the server swarm will talk to. */
  readonly serve: string;
}

const modelPlaceholder = "{model}";

/**
 * Fills a backend's command templates in. Single-pass on purpose: a model id that happens to
 * contain the placeholder must not be expanded again into whatever came after it.
 */
export function formatBackendCommands(backend: ShortlistBackend, modelId: string): BackendCommands {
  return {
    install: substitute(backend.install, modelId),
    serve: substitute(backend.serve, modelId),
  };
}

function substitute(template: string, modelId: string): string {
  return template.split(modelPlaceholder).join(modelId);
}

import { z } from "zod";

/**
 * What a local backend says it is actually serving. Read off the OpenAI-compatible model
 * list rather than a runtime-specific status route: rapid-mlx and Ollama both publish it,
 * it is what the provider layer already talks to, and it is the only one of the routes on
 * offer that answers for more than one loaded model. A status route that names a single
 * resident model is a narrower answer to the same question, so it would only ever remove
 * something the list already reported.
 */

/**
 * One entry of that list. `root` and `parent` are the only mapping the protocol offers
 * between a served alias and the model behind it; a backend that sets neither has published
 * no mapping at all, and nothing here invents one from the shape of the two names.
 */
export interface ServedModel {
  readonly id: string;
  readonly root: string | null;
  readonly parent: string | null;
}

const servedModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      root: z.string().min(1).nullish(),
      parent: z.string().min(1).nullish(),
    }),
  ),
});

export type ServedModelList =
  | {
      readonly endpoint: string;
      readonly enumerated: true;
      readonly models: readonly ServedModel[];
    }
  | {
      readonly endpoint: string;
      readonly enumerated: false;
      /** Why the list could not be read, in the words a caller can act on. */
      readonly failure: string;
    };

interface ModelListResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type ModelListFetch = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<ModelListResponse>;

interface ServedModelsRequest {
  /** The OpenAI-compatible base url the provider layer will dispatch against. */
  readonly baseUrl: string;
  readonly fetch: ModelListFetch;
  readonly signal?: AbortSignal | undefined;
}

export function servedModelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/**
 * Asks the backend what it serves. A backend that cannot be asked reports a failure rather
 * than an empty list: an unanswered probe is not a backend serving nothing, and the two have
 * to stay apart or a timeout would exclude every model on the strength of no evidence.
 */
export async function fetchServedModels(request: ServedModelsRequest): Promise<ServedModelList> {
  const endpoint = servedModelsEndpoint(request.baseUrl);

  let response: ModelListResponse;
  try {
    response = await request.fetch(
      endpoint,
      request.signal === undefined ? undefined : { signal: request.signal },
    );
  } catch (cause) {
    return { endpoint, enumerated: false, failure: describeFailure(cause) };
  }

  if (!response.ok) {
    return { endpoint, enumerated: false, failure: `it answered ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return { endpoint, enumerated: false, failure: describeFailure(cause) };
  }

  const parsed = servedModelsSchema.safeParse(body);
  if (!parsed.success) {
    return {
      endpoint,
      enumerated: false,
      failure: "it answered something that is not an OpenAI-compatible model list",
    };
  }

  return {
    endpoint,
    enumerated: true,
    models: parsed.data.data.map((entry) => ({
      id: entry.id,
      root: entry.root ?? null,
      parent: entry.parent ?? null,
    })),
  };
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error
    ? `it could not be reached: ${cause.message}`
    : "it could not be reached";
}

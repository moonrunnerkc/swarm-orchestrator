import { Agent, fetch as undiciFetch } from "undici";

/**
 * The fetch a local endpoint is called through.
 *
 * Node's own fetch gives up on a response body after five minutes of silence, and silence is
 * exactly what a local endpoint produces while it writes a file. A server parsing tool calls
 * has to see a whole call before it can emit one, so nothing crosses the wire until the model
 * has finished generating it: measured against rapid-mlx serving qwen3.8:27b, a 1500-token
 * tool call arrived as eight chunks with an 18 second gap between them. At around 17 tokens a
 * second, any call over roughly five thousand tokens outlives the timeout, and the run died
 * with "terminated" at the step where it was writing the file it had been asked for.
 *
 * So the timeouts come off for local endpoints, and only for them: a frontier provider that
 * goes quiet for five minutes has failed, while a local one is working. What still ends a call
 * is the run's own abort signal, which is what a person pressing ctrl+c reaches.
 *
 * undici rather than the global fetch because the global one takes no dispatcher of its own,
 * and undici is the library Node's fetch already is.
 */
export function createLocalFetch(): typeof globalThis.fetch {
  const agent = new Agent({ bodyTimeout: 0, headersTimeout: 0 });
  const waiting = (input: unknown, init: unknown): unknown =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher: agent,
    });
  return waiting as unknown as typeof globalThis.fetch;
}

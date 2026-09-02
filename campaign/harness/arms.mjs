/**
 * The three arms: one model backend each, the same fifty tasks each. An arm is named by the
 * backend rather than by the model, because the model a backend serves is pinned here and
 * recorded per run, and what the arms compare is the same pipeline behind three sources of
 * tokens. Only the backend is reachable from a run's container, through one forwarder per
 * arm; everything else is off the network.
 */

export const arms = Object.freeze({
  "local-mlx": Object.freeze({
    backend: "rapid-mlx",
    model: "local:qwen3.8:27b",
    /** The host port the forwarder relays to, and the port it listens on inside the network. */
    port: 8000,
    frontier: false,
  }),
  "local-ollama": Object.freeze({
    backend: "ollama",
    model: "local:qwen3.6:35b-a3b",
    port: 11434,
    frontier: false,
  }),
  frontier: Object.freeze({
    backend: "anthropic",
    model: "anthropic:claude-sonnet-5",
    /** TLS passes through the forwarder untouched; the container resolves the host to it. */
    host: "api.anthropic.com",
    port: 443,
    keyVariable: "ANTHROPIC_API_KEY",
    frontier: true,
  }),
});

export const armNames = Object.freeze(Object.keys(arms));

export function armNamed(name) {
  const arm = arms[name];
  if (arm === undefined) {
    throw new Error(`no such arm: ${name}. The arms are ${armNames.join(", ")}`);
  }
  return arm;
}

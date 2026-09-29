/**
 * The study's calls to a local model server (Ollama's OpenAI-compatible endpoint), and the
 * identity of the model that answered: its name and the digest the server reports for it.
 */
import http from "node:http";

/** A model transport failure: infrastructure, never a finding about the pull request. */
export class ModelTransportError extends Error {
  constructor(message) {
    super(`model transport: ${message}`);
    this.name = "ModelTransportError";
  }
}

/**
 * A request with no header timeout: a local model working through a long review context can
 * take longer than a default client's five minutes to send its first byte.
 */
function request(url, method, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: { "content-type": "application/json" },
        timeout: 0,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    outgoing.on("error", (cause) => reject(new ModelTransportError(cause.message)));
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** The name and digest the server reports for a model, or a reason it could not. */
export async function modelIdentity(endpoint, model) {
  try {
    const response = await request(`${endpoint}/api/tags`, "GET");
    const listed = JSON.parse(response.text).models ?? [];
    const found = listed.find((entry) => entry.name === model || entry.model === model);
    if (found === undefined) return { model, digest: null, detail: "not listed by the server" };
    return {
      model,
      digest: `sha256:${found.digest}`,
      family: found.details?.family ?? null,
      parameterSize: found.details?.parameter_size ?? null,
      quantization: found.details?.quantization_level ?? null,
    };
  } catch (cause) {
    return { model, digest: null, detail: cause.message };
  }
}

/**
 * One chat completion. A dropped connection is retried; a server error on a malformed tool call
 * is answered by telling the model and asking again (at temperature 0 the same request gives the
 * same malformed call). The exhausted retries surface as a ModelTransportError.
 */
export async function chatCompletion(endpoint, body, { attempts = 3, backoffMs = 20_000 } = {}) {
  let failure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(`${endpoint}/v1/chat/completions`, "POST", body);
      if (response.status >= 500 && Array.isArray(body.messages)) {
        body.messages.push({
          role: "user",
          content: `Your previous tool call could not be parsed by the server (${response.text.slice(0, 120)}). Call the tool again with well-formed arguments.`,
        });
        failure = new ModelTransportError(`${response.status} ${response.text.slice(0, 200)}`);
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new ModelTransportError(`${response.status} ${response.text.slice(0, 200)}`);
      return JSON.parse(response.text);
    } catch (cause) {
      failure =
        cause instanceof ModelTransportError ? cause : new ModelTransportError(cause.message);
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  throw failure;
}

/** The arguments of the first call to `tool` in a completion, parsed, or null. */
export function toolArguments(completion, tool) {
  const calls = completion?.choices?.[0]?.message?.tool_calls ?? [];
  const call = calls.find((entry) => entry.function?.name === tool);
  if (call === undefined) return null;
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    return null;
  }
}

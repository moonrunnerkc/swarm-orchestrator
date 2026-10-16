// Probe Ollama's OpenAI-compatible route with a small thinking model: which field turns thinking off?
const endpoint = "http://127.0.0.1:11434/v1/chat/completions";
const model = process.argv[2] ?? "qwen3:0.6b";
const variants = {
  none: {},
  reasoning_effort_none: { reasoning_effort: "none" },
  think_false: { think: false },
  enable_thinking_false: { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
  reasoning_effort_low: { reasoning_effort: "low" },
};
for (const [name, extra] of Object.entries(variants)) {
  const body = {
    model, stream: true, stream_options: { include_usage: true }, max_tokens: 200,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
    ...extra,
  };
  const started = Date.now();
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let reasoningChunks = 0, contentChunks = 0, reasoningChars = 0, contentText = "", usage = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const json = JSON.parse(line.slice(6));
    if (json.usage) usage = json.usage;
    const delta = json.choices?.[0]?.delta ?? {};
    if (delta.reasoning) { reasoningChunks += 1; reasoningChars += delta.reasoning.length; }
    if (delta.content) { contentChunks += 1; contentText += delta.content; }
  }
  console.log(JSON.stringify({ variant: name, status: response.status, reasoningChunks, reasoningChars, contentChunks, content: contentText.slice(0, 60), usage, ms: Date.now() - started }));
}

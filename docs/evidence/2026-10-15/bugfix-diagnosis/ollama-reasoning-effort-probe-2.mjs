const endpoint = "http://127.0.0.1:11434/v1/chat/completions";
const model = process.argv[2] ?? "qwen3:0.6b";
const variants = {
  all_three: { reasoning_effort: "none", enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
  effort_none_plus_tools: { reasoning_effort: "none", tools: [{ type: "function", function: { name: "write", description: "write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }] },
  effort_none_tools_and_kwargs: { reasoning_effort: "none", enable_thinking: false, chat_template_kwargs: { enable_thinking: false }, tools: [{ type: "function", function: { name: "write", description: "write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }] },
};
for (const [name, extra] of Object.entries(variants)) {
  const body = { model, stream: true, stream_options: { include_usage: true }, max_tokens: 200,
    messages: [{ role: "user", content: name.includes("tools") ? "Write the file a.txt containing hello, using the write tool." : "Reply with the single word: ready" }], ...extra };
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let reasoningChunks = 0, contentChunks = 0, toolChunks = 0, contentText = "", usage = null, finish = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const json = JSON.parse(line.slice(6));
    if (json.usage) usage = json.usage;
    const choice = json.choices?.[0]; const delta = choice?.delta ?? {};
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (delta.reasoning) reasoningChunks += 1;
    if (delta.content) { contentChunks += 1; contentText += delta.content; }
    if (delta.tool_calls) toolChunks += 1;
  }
  console.log(JSON.stringify({ variant: name, status: response.status, reasoningChunks, contentChunks, toolChunks, finish, content: contentText.slice(0, 40), usage }));
}

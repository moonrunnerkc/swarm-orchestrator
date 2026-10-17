/**
 * The proxy's record of a seeded run, kept compact: each distinct message and tool list once,
 * every request as references to them, and each streamed response assembled into what it said
 * (its text, its tool calls, its usage and finish reason). Requests are exact: `expandExchanges`
 * rebuilds every body field for field as it was sent. Responses keep their content and drop only the per-token
 * server-sent-event framing, which was most of their bytes and none of their meaning.
 */

/** What a streamed chat completion said, from its server-sent events. */
export function assembleResponse(raw) {
  let text = "";
  let usage = null;
  let finish = null;
  const calls = new Map();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const chunk = JSON.parse(line.slice(6));
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    text += choice?.delta?.content ?? "";
    for (const call of choice?.delta?.tool_calls ?? []) {
      const key = call.index ?? 0;
      const entry = calls.get(key) ?? { id: "", name: "", arguments: "" };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      entry.arguments += call.function?.arguments ?? "";
      calls.set(key, entry);
    }
  }
  return { text, toolCalls: [...calls.values()], usage, finish };
}

export function compactExchanges(exchanges) {
  const messages = [];
  const tools = [];
  const seen = new Map();
  const seenTools = new Map();
  const reference = (table, index, value) => {
    const key = JSON.stringify(value);
    if (!index.has(key)) {
      index.set(key, table.length);
      table.push(value);
    }
    return index.get(key);
  };
  const records = exchanges.map((exchange) => {
    const record = { ...exchange };
    if (Array.isArray(exchange.request?.messages)) {
      const { messages: sent, tools: offered, ...rest } = exchange.request;
      record.request = {
        ...rest,
        messages: sent.map((message) => reference(messages, seen, message)),
        ...(offered === undefined ? {} : { tools: reference(tools, seenTools, offered) }),
      };
    }
    if (exchange.path?.endsWith("/chat/completions") && typeof exchange.response === "string")
      record.response = assembleResponse(exchange.response);
    return record;
  });
  return { schema: "swarm-proxy-exchanges.v2", messages, tools, records };
}

/** Every request body exactly as it was sent, with its assembled response. */
export function expandExchanges(compact) {
  if (compact.schema !== "swarm-proxy-exchanges.v2") return compact;
  return compact.records.map((record) => {
    if (!Array.isArray(record.request?.messages)) return record;
    const { messages, tools, ...rest } = record.request;
    return {
      ...record,
      request: {
        ...rest,
        messages: messages.map((index) => compact.messages[index]),
        ...(tools === undefined ? {} : { tools: compact.tools[tools] }),
      },
    };
  });
}

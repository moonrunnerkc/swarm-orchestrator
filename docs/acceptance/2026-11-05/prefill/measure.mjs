// Sends each captured prompt, in order, to Ollama's /api/chat for one token, and records what
// the runtime evaluated: prompt_eval_count (tokens it did not take from its cache) and
// prompt_eval_duration. Usage: node measure.mjs <label> <model> <context>
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
const [label, model, context] = process.argv.slice(2);
const prompts = readFileSync(`${label}/bodies.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const post = (body) => new Promise((settle, fail) => {
  const out = request("http://localhost:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => settle(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
  });
  out.on("error", fail); out.end(JSON.stringify(body));
});
const rows = [];
for (const [at, messages] of prompts.entries()) {
  const r = await post({ model, messages, stream: false, think: false, keep_alive: "30m", options: { num_ctx: Number(context), num_predict: 1, temperature: 0 } });
  rows.push({ turn: at + 1, evaluated: r.prompt_eval_count, prefillMs: Math.round(r.prompt_eval_duration / 1e6) });
  process.stdout.write(`${label} turn ${at + 1}: ${r.prompt_eval_count} tokens evaluated, ${Math.round(r.prompt_eval_duration / 1e6)} ms\n`);
}
const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
writeFileSync(`${label}/prefill.json`, `${JSON.stringify({ model, context: Number(context), rows, evaluated: total("evaluated"), prefillMs: total("prefillMs") }, null, 1)}\n`);
console.log(`${label}: ${total("evaluated")} tokens evaluated, ${total("prefillMs")} ms of prefill over ${rows.length} turns`);

#!/bin/sh
# Starts packages/swarm-verify/mcp.mjs over stdio from a scratch repository with a change in its
# working tree, then sends what an MCP client sends: initialize, the initialized notification,
# tools/list and a tools/call of verify. Each reply is printed as it arrives. Run from a checkout
# of this repository:
#
#   sh docs/demos/mcp-demo.sh
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
SWARM_SIGNING_KEY=$(node -e 'console.log(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))')
SWARM_HOME="$scratch/home"
export SWARM_SIGNING_KEY SWARM_HOME

node "$here/scripts/build-swarm-verify.mjs" >/dev/null
cd "$scratch" && git init -q -b main demo && cd demo
git config user.email demo@example.com && git config user.name demo
mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '[checks]\ntest = "node --test"\n' > swarm.toml
git add -A && git commit -qm base
printf 'export const half = (n) => n / 2;\n' > half.mjs

cat > "$scratch/client.mjs" <<'CLIENT'
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const server = spawn(process.execPath, [process.argv[2]], { stdio: ["pipe", "pipe", "inherit"] });
const replies = createInterface({ input: server.stdout });
const waiting = new Map();
replies.on("line", (line) => {
  const message = JSON.parse(line);
  console.log(`< ${line}`);
  waiting.get(message.id)?.(message);
});
const send = (message) => {
  console.log(`> ${JSON.stringify(message)}`);
  server.stdin.write(`${JSON.stringify(message)}\n`);
  return message.id === undefined ? null : new Promise((done) => waiting.set(message.id, done));
};
await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "demo", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const called = await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "verify", arguments: {} } });
server.stdin.end();
console.log(`tools: ${listed.result.tools.map((tool) => tool.name).join(", ")}`);
console.log(`verdict: ${called.result.structuredContent.verdict}`);
process.exitCode = listed.result.tools.length === 1 && called.result.structuredContent.verdict === "pass" ? 0 : 1;
CLIENT
printf '\n$ node client.mjs packages/swarm-verify/mcp.mjs\n'
node "$scratch/client.mjs" "$here/packages/swarm-verify/mcp.mjs"
printf '[exit %s]\n' "$?"

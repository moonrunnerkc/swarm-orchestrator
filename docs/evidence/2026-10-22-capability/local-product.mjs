import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { opencodeArgv, taskPrompt } from "../../../scripts/comparison/arms.mjs";
import { hiddenVerdict, visibleVerdict } from "../../../scripts/comparison/checks.mjs";
import { cloneAtBase, commitVisibleCheck, finalPatch, prepare, prepareLaunchHome, taskEnvironment, workRoot, writeArmConfiguration } from "../../../scripts/comparison/workspace.mjs";
const {values} = parseArgs({options: {product: {type: "string"}, smoke: {type: "boolean"}, out: {type: "string"}}});
if (!["opencode", "claude"].includes(values.product) || !values.out) throw new Error("--product opencode|claude --out <dir> [--smoke]");
const out = resolve(values.out);
mkdirSync(out, {recursive: true});
mkdirSync(workRoot, {recursive: true});
const scratch = mkdtempSync(join(workRoot, `capability-${values.product}-`));
const workspace = join(scratch, "workspace"), home = join(scratch, "home");
const log = commandLog(join(out, "blobs"));
const task = JSON.parse(readFileSync(new URL("../2026-10-22/control-amended/manifest.json", import.meta.url))).tasks.find(t => t.id === "entities-bugfix-restore-get-code-point");
let prompt, base;
if (values.smoke) {
  mkdirSync(workspace);
  execFileSync("git", ["init", "--quiet"], {cwd: workspace});
  writeFileSync(join(workspace, "math.mjs"), "export const twice = n => n;\n");
  writeFileSync(join(workspace, "math.test.mjs"), "import {twice} from './math.mjs'; import assert from 'node:assert/strict'; assert.equal(twice(3), 6); assert.equal(twice(-2), -4);\n");
  execFileSync("git", ["add", "."], {cwd: workspace});
  execFileSync("git", ["-c", "user.name=Study", "-c", "user.email=study@example.com", "commit", "--quiet", "-m", "neutral smoke"], {cwd: workspace});
  base = "HEAD";
  prompt = "Fix twice in math.mjs so it doubles a number. Read the files, edit the implementation, then run node math.test.mjs. Keep the tests unchanged.";
} else {
  if (values.product !== "claude") throw new Error("use the registered comparison runner for OpenCode task launches");
  await cloneAtBase(log, task, task.baseCommit, workspace);
  base = await commitVisibleCheck(log, task, workspace);
  const prepared = await prepare(log, task, workspace);
  if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
  prompt = taskPrompt(task);
}
prepareLaunchHome(home);
const model = "qwen3.6:35b-a3b", endpoint = "http://127.0.0.1:11434/v1";
if (values.product === "opencode") writeArmConfiguration(workspace, "opencode", endpoint, model, task);
const argv = values.product === "opencode"
  ? opencodeArgv({model}, prompt, workspace)
  : ["claude", "-p", "--verbose", "--output-format", "stream-json", "--model", model,
      "--dangerously-skip-permissions", "--tools", "Read,Write,Edit,Bash,Glob,Grep", prompt];
const env = {
  PATH: `${join(homedir(), ".cache/swarm-capability-tools/opencode/node_modules/.bin")}:${taskEnvironment(task).PATH}`,
  HOME: home, PWD: workspace, TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8192", MAX_THINKING_TOKENS: "0",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", PUPPETEER_SKIP_DOWNLOAD: "true",
};
const abort = new AbortController();
let buffer = "", reportedTokens = 0;
const observedMessages = new Set();
const ran = await log.run(argv, {cwd: workspace, env, timeoutMs: values.smoke ? 180000 : 540500, killConfirmMs: 59500,
  signal: abort.signal, onStdout: chunk => {
    buffer += chunk.toString();
    const lines = buffer.split("\n"); buffer = lines.pop();
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      const message = event.type === "assistant" ? event.message : null;
      if (!message?.id || observedMessages.has(message.id)) continue;
      observedMessages.add(message.id);
      const u = message.usage;
      if (u) reportedTokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      if (reportedTokens >= 8000000) abort.abort(new Error("registered token ceiling"));
    }
  }});
writeFileSync(join(out, "stdout.txt"), ran.stdout);
writeFileSync(join(out, "stderr.txt"), ran.stderr);
const patch = await finalPatch(log, workspace, base);
writeFileSync(join(out, "final.patch"), patch);
const record = {product: values.product, smoke: values.smoke === true, model, workspace, home, base,
  argv, environment: env, reportedTokens, invocation: {...ran, stdout: undefined, stderr: undefined},
  patchDigest: `sha256:${createHash("sha256").update(patch).digest("hex")}`};
if (values.smoke) {
  const check = await log.run(["node", "math.test.mjs"], {cwd: workspace, env, timeoutMs: 30000});
  const unchanged = execFileSync("git", ["diff", "HEAD", "--", "math.test.mjs"], {cwd: workspace, encoding: "utf8"}).length === 0;
  record.passed = check.exitCode === 0 && unchanged && patch.length > 0;
} else {
  record.visible = await visibleVerdict(log, task, task.baseCommit, patch);
  record.hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
}
record.commands = log.commands;
writeFileSync(join(out, "record.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify({product: record.product, passed: record.passed, wallMs: ran.wallMs, exitCode: ran.exitCode, visible: record.visible?.passed, hidden: record.hidden?.verdict}));

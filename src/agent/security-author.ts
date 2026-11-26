import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type SecurityClass, type SecurityFile, securityFileSchema } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { estimateTokens } from "./context.ts";
import { type Message, type ModelClient, ModelError } from "./model.ts";

/** What the drafting call is told. It sees the repository as it is, never a change to it. */
export const securityPrompt = [
  "You prepare security checks for a web API before any change is made to it. You write no code.",
  "A test driver will start the application and send it real HTTP requests as different users. You",
  "tell it how: read the task and the repository below, and reply with one fenced json block.",
  "",
  "```json",
  '{"target": {"start": "<the command that starts the server>", "port": <the port it listens on>, "env": {}},',
  ' "checks": [<one object for each class asked for>]}',
  "```",
  "",
  'The port is also given to the server as PORT. "env" holds only variables the server needs to start.',
  "",
  "The object for each class:",
  '- ownership: {"class": "ownership", "resource": {"method": "GET", "path": "<the path the task\'s',
  '  feature serves ONE existing record at>"}, "owner": {<request headers that authenticate the user',
  '  who owns that record>}, "other": {<headers that authenticate a different existing user>},',
  '  "ownerSees": ["<a value from that record the response must hold>"]}',
  '- single-use-token: {"class": "single-use-token", "issue": {"method": "POST", "path": "...",',
  '  "headers": {...}, "body": {...}}, "tokenAt": "<where the token is in the JSON response, such as',
  '  token>", "redeem": {"method": "POST", "path": "<with {{token}} where the token goes>"}}',
  '- duplicate-operation: {"class": "duplicate-operation", "operation": {"method": "POST", "path":',
  '  "...", "headers": {<with {{run}} in an idempotency key or id, so each case differs>}, "body":',
  '  {...}}, "observe": {"method": "GET", "path": "<a request that reads a number the operation',
  '  changes>", "headers": {...}}, "valueAt": "<where that number is in the JSON response>", "by":',
  "  <how much one application changes it>}",
  "",
  "Use only users, records and credentials the repository itself holds as seed or fixture data.",
  "Never invent a credential. Where the repository does not show how a user authenticates or which",
  "record is whose, reply with the one word UNKNOWN and a line saying what is missing.",
].join("\n");

const relevant =
  /route|auth|user|session|middleware|server|app|index|seed|fixture|data|store|db|token|payment|invoice/i;
const shownBytes = 16_000;

/** The task, the manifest and the files that show routes, identity and seed data, within a budget. */
async function request(
  workspace: string,
  task: string,
  classes: readonly SecurityClass[],
  files: readonly string[],
): Promise<string> {
  const ordered = [...files].sort((a, b) => Number(relevant.test(b)) - Number(relevant.test(a)));
  const shown: string[] = [];
  let used = 0;
  for (const path of ["package.json", ...ordered]) {
    const text = await readFile(join(workspace, path), "utf8").catch(() => null);
    if (text === null || used + text.length > shownBytes) continue;
    used += text.length;
    shown.push(`--- ${path} ---\n${text.trimEnd()}`);
  }
  return [
    `Task:\n${task}`,
    `Classes asked for: ${classes.join(", ")}`,
    `Repository files: ${files.join(" ")}`,
    ...shown,
  ].join("\n\n");
}

/**
 * The binding for the security checks a task needs, drafted by a call that reads the base and
 * never the change. A draft is a proposal: it is validated against the binding's schema and the
 * classes asked for, tried once more with what was wrong, and labeled as not reviewed wherever
 * it is used. Null with the reason where no usable draft came back.
 */
export async function draftSecurity(input: {
  readonly model: ModelClient;
  readonly evidence: EvidenceRecorder;
  readonly workspace: string;
  readonly task: string;
  readonly classes: readonly SecurityClass[];
  /** Tracked source files worth showing: the ones holding routes first. */
  readonly files: readonly string[];
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly file: SecurityFile | null;
  readonly failure: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
}> {
  const messages: Message[] = [
    { role: "system", content: securityPrompt },
    {
      role: "user",
      content: await request(input.workspace, input.task, input.classes, input.files),
    },
  ];
  let [inputTokens, outputTokens] = [0, 0];
  let failure = "no draft was made";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let content: string;
    try {
      const reply = await input.model.complete(messages, {
        signal: input.signal,
        maxTokens: input.turnTokens,
      });
      content = reply.content.trim().length > 0 ? reply.content : (reply.reasoning ?? "");
      inputTokens +=
        reply.inputTokens ?? estimateTokens(messages.map((one) => one.content).join(""));
      outputTokens += reply.outputTokens ?? estimateTokens(content);
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      return {
        file: null,
        failure: `the drafting model failed: ${error.message}`,
        inputTokens,
        outputTokens,
      };
    }
    await input.evidence.record({
      type: "model-call",
      actor: input.model.model,
      provenance: ["model"],
      payload: { author: "security", attempt, reply: content, inputTokens, outputTokens },
    });
    const block = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(content)?.[1];
    if (block === undefined) {
      failure = /\bUNKNOWN\b/.test(content)
        ? `the repository does not show what the checks need: ${content.replace(/\s+/g, " ").trim().slice(0, 300)}`
        : "the reply holds no fenced json block";
    } else {
      let parsed: ReturnType<typeof securityFileSchema.safeParse> | null = null;
      try {
        parsed = securityFileSchema.safeParse(JSON.parse(block));
      } catch (error) {
        failure = `the json block does not parse: ${(error as Error).message}`;
      }
      if (parsed?.success === true) {
        const missing = input.classes.filter(
          (name) => !parsed.data.checks.some((one) => one.class === name),
        );
        if (missing.length === 0)
          return { file: parsed.data, failure: null, inputTokens, outputTokens };
        failure = `the block has no check of class ${missing.join(", ")}`;
      } else if (parsed !== null) {
        const issue = parsed.error.issues[0];
        failure = `${issue?.path.join(".") || "the block"}: ${issue?.message ?? "is not valid"}`;
      }
    }
    if (failure.startsWith("the repository does not show")) break;
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `That reply cannot be used: ${failure}. Send the one json block again, corrected.`,
      },
    );
  }
  return { file: null, failure, inputTokens, outputTokens };
}

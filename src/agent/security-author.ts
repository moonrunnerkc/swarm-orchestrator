import { type SecurityClass, type SecurityFile, unreadValue } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { shownFiles } from "./author-prompt.ts";
import type { ShownFile } from "./base-facts.ts";
import { drafted, type Message, type ModelClient, ModelError } from "./model.ts";
import { bindingOf } from "./security.ts";

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
  'The port is also given to the server as PORT. "env" holds only variables the server itself reads.',
  "",
  "The object for each class:",
  '- ownership: {"class": "ownership", "resource": {"method": "<the method of the request the task',
  '  adds or changes>", "path": "<that request\'s path, for ONE existing record>"}, "owner":',
  '  {<request headers that authenticate the user who owns that record>}, "other": {<headers that',
  '  authenticate a different existing user>}, "otherRole": {<headers of a user of another role,',
  '  such as support staff, where there is one>}, "signedIn": {"method": "GET", "path": "<a',
  "  DIFFERENT request, one the API ALREADY answers for any signed-in user and refuses without",
  '  credentials; never a health or readiness route>"}, "success": [<the status the task says the',
  '  owner gets; 200 where it says none>], "ownerSees": [<a value of that record the owner\'s',
  "  response body holds; empty where the response has no body, as with 204>]}",
  '- single-use-token: {"class": "single-use-token", "issue": {"method": "POST", "path": "...",',
  '  "headers": {...}, "body": {...}}, "tokenAt": "<where the token is in the JSON response, such as',
  '  token>", "redeem": {"method": "POST", "path": "<with {{token}} where the token goes>"},',
  '  "expiresAfterMs": <where an environment variable sets the token lifetime, set it in "env" to',
  "  about a second and give a little more here, in milliseconds; otherwise leave this out>}",
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

/**
 * Where a draft binds a check to something other than what the task asks for: its request,
 * where the task names requests, and the status the legitimate use gets, where it names one. A
 * draft for `DELETE /notes/:slug` bound ownership to the list every account can already read,
 * which no change could satisfy (notes example, 2026-11-26).
 */
function misbound(file: SecurityFile, task: string): string[] {
  const named = [...task.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-./:{}]*)/g)];
  const answers = (task.match(/\b2\d\d\b/g) ?? []).map(Number);
  const problems: string[] = [];
  for (const check of file.checks) {
    const main =
      "resource" in check ? check.resource : "redeem" in check ? check.redeem : check.operation;
    const path = main.path.split("?")[0] ?? "";
    const asked = named.some(([, method, route = ""]) => {
      const trimmed = route.replace(/[.:,;]+$/, "");
      const pattern = trimmed.replace(/[.]/g, "\\.").replace(/:\w+|\{\w+\}/g, "[^/]+");
      return method === main.method && new RegExp(`^${pattern}/?$`).test(path);
    });
    if (named.length > 0 && !asked)
      problems.push(
        `the ${check.class} check sends ${main.method} ${main.path}, which is not a request the task names (${named.map((one) => one[0]).join(", ")}); bind it to the request the task adds or changes, for one existing record`,
      );
    const success = check.success ?? [200];
    if (answers.length > 0 && !success.some((status) => answers.includes(status)))
      problems.push(
        `"success" is ${success.join(", ")} where the task says the request is answered ${answers.join(" or ")}`,
      );
    if (check.class === "ownership" && (check.ownerSees ?? []).length > 0 && success.includes(204))
      problems.push('"ownerSees" names text in a 204 response, which has no body; leave it empty');
  }
  return problems;
}

/** The binding a reply holds, or what is wrong with it for the classes asked for. */
function read(
  reply: string,
  classes: readonly SecurityClass[],
  shown: string,
  task: string,
): SecurityFile | string {
  const block = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(reply)?.[1];
  if (block === undefined)
    return /\bUNKNOWN\b/.test(reply)
      ? `${missing}${reply.replace(/\s+/g, " ").trim().slice(0, 300)}`
      : "the reply holds no fenced json block";
  let file: SecurityFile;
  let raw: unknown;
  try {
    raw = JSON.parse(block);
    file = bindingOf(raw, "the json block");
  } catch (error) {
    // What else is wrong with it, where its shape allows reading that much.
    let also: string[] = [];
    try {
      also = misbound(raw as SecurityFile, task);
    } catch {
      // Not shaped enough to say more than the schema did.
    }
    return [(error as Error).message, ...also].join("; ");
  }
  // Every fault that needs no request, at once: mended one at a time, they spent every attempt.
  const absent = classes.filter((name) => !file.checks.some((one) => one.class === name));
  const made = unreadValue(file, shown);
  const problems = [
    absent.length > 0 ? `the block has no check of class ${absent.join(", ")}` : null,
    file.checks.some((one) => one.class === "ownership" && one.signedIn === undefined)
      ? 'the ownership check has no "signedIn" request, so nothing shows the users it names are ones the server knows; name a request the API already answers for any signed-in user'
      : null,
    ...misbound(file, task),
    made === null
      ? null
      : `${JSON.stringify(made)} is not in the repository files you were shown; use only credentials and values that are there`,
  ].filter((one) => one !== null);
  return problems.length === 0 ? file : problems.join("; ");
}

const missing = "the repository does not show what the checks need: ";

/**
 * The binding for the security checks a task needs, drafted by a call that reads the base and
 * never the change. A draft is a proposal: it is held to the binding's schema, to the classes
 * asked for and to values the repository holds, then tried at the base with real requests by
 * `tryAtBase`, and sent back with what was observed where any of that fails. Null with the
 * reason where no usable draft came back; what is truly missing is said, never guessed.
 */
export async function draftSecurity(input: {
  readonly model: ModelClient;
  readonly evidence: EvidenceRecorder;
  readonly task: string;
  readonly classes: readonly SecurityClass[];
  /** How the application starts and the base's files with its routes, identity and seed data. */
  readonly runtime: readonly string[];
  readonly shown: readonly ShownFile[];
  /** What real requests at the base show is wrong with a draft, or null. */
  readonly tryAtBase: (file: SecurityFile) => Promise<string | null>;
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly file: SecurityFile | null;
  readonly failure: string | null;
  /** Why each attempt before the last was sent back. */
  readonly attempts: readonly string[];
  readonly tokens: number;
}> {
  const asked = [
    `Task:\n${input.task}`,
    `Classes asked for: ${input.classes.join(", ")}`,
    input.runtime.join("\n"),
    shownFiles(input.shown).join("\n"),
  ].join("\n\n");
  const messages: Message[] = [
    { role: "system", content: securityPrompt },
    { role: "user", content: asked },
  ];
  const attempts: string[] = [];
  let tokens = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let content: string;
    try {
      const reply = await drafted(input.model, messages, {
        signal: input.signal,
        maxTokens: input.turnTokens,
      });
      content = reply.content;
      tokens += reply.inputTokens + reply.outputTokens;
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      const failure = `the drafting model failed: ${error.message}`;
      return { file: null, failure, attempts, tokens };
    }
    const found = read(content, input.classes, asked, input.task);
    const problem = typeof found === "string" ? found : await input.tryAtBase(found);
    await input.evidence.record({
      type: "model-call",
      actor: input.model.model,
      provenance: ["model"],
      payload: {
        author: "security",
        attempt,
        asked: messages.at(-1)?.content ?? "",
        reply: content,
        problem,
        tokens,
      },
    });
    if (typeof found !== "string" && problem === null)
      return { file: found, failure: null, attempts, tokens };
    attempts.push(problem ?? "");
    if (problem?.startsWith(missing)) break;
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `That reply cannot be used: ${problem}. Send the one json block again, corrected.`,
      },
    );
  }
  return { file: null, failure: attempts.at(-1) ?? "no draft was made", attempts, tokens };
}

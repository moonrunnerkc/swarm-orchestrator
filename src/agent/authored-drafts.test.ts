import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requirementSchema } from "swarm-verify";
import { describe, expect, it } from "vitest";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createChokepoint } from "../tools/chokepoint.ts";
import { hostExecutor } from "../tools/executor.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { authorRequest } from "./author-prompt.ts";
import { authorChecks } from "./check-author.ts";
import { testConventions } from "./test-conventions.ts";
import { authorTest, scripted } from "./test-doubles.ts";

const invoiceExample = join(fileURLToPath(import.meta.url), "../../../examples/invoice-api");

/** A committed repository of the given files, with the chokepoint a run's base checks go through. */
async function base(files: string) {
  const root = await mkdtemp(join(tmpdir(), "drafts-"));
  const repo = join(root, "repo");
  await cp(files, repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "base");
  const home = join(root, "home");
  await mkdir(join(home, "sessions"), { recursive: true });
  const evidence = await openEvidenceSession({
    root: join(home, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
  const guard = createPolicyGuard({
    workspaceRoot: repo,
    homeDir: root,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [home],
    childHomeDir: join(root, "child"),
  });
  const chokepoint = createChokepoint({
    guard,
    executor: hostExecutor(guard.workspaceRoot, guard.childEnvironment.variables),
    evidence,
    approval: "auto",
    confirm: null,
    timeoutMs: 60_000,
  });
  return { repo, evidence, chokepoint };
}

const requirementFor = (task: string) =>
  requirementSchema.parse({ id: "R1", text: task, source: "user", kind: "other" });

async function drafted(files: string, task: string, replies: readonly string[]) {
  const { repo, evidence, chokepoint } = await base(files);
  const conventions = await testConventions(repo, task);
  const model = scripted([], { author: replies });
  const authored = await authorChecks({
    model,
    chokepoint,
    evidence,
    workspace: repo,
    requirement: requirementFor(task),
    conventions,
    turnTokens: 1000,
  });
  return { authored, model, request: authorRequest(requirementFor(task), conventions) };
}

const invoiceTask =
  "Add GET /invoices/:id/download, which returns the invoice as JSON (its number, totalCents and lines) to the authenticated user who owns it.";

// gemma4:31b's first draft for the invoice example, as session 20261126T224019-598270 recorded
// it, cut to the cases that matter: a field the data lacks, and a placeholder of its own.
const recordedDraft = `import assert from "node:assert/strict";
import { test } from "node:test";
import { users, invoices } from "../src/data.ts";

test("GET /invoices/:id/download returns invoice JSON for the owner", async () => {
  const user = users[0];
  const invoice = invoices.find(i => i.ownerId === user.id);
  const result = await handleDownloadInvoice({ params: { id: invoice.id }, user });
  assert.strictEqual(result.number, invoice.number);
});

async function handleDownloadInvoice(req) {
  // This is a placeholder for the actual implementation to be written by the engineer.
  throw new Error("Not implemented");
}

test("control: authenticated user can access their own data", async () => {
  const user = users[0];
  assert.ok(invoices.filter(i => i.ownerId === user.id).length > 0);
});
`;

// A scripted stand-in for a model's mended draft: the real entry, real requests, real fields.
const overHttp = `import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { handle } from "../src/app.ts";

async function get(path, token) {
  const server = createServer(handle);
  await new Promise((settle) => server.listen(0, settle));
  const response = await fetch(\`http://127.0.0.1:\${server.address().port}\${path}\`, {
    headers: token === null ? {} : { authorization: \`Bearer \${token}\` },
  });
  const body = await response.json();
  server.close();
  return { status: response.status, body };
}

test("the owner downloads their invoice", async () => {
  const { status, body } = await get("/invoices/inv-1/download", "token-ada");
  assert.equal(status, 200);
  assert.equal(body.number, "INV-2026-0001");
});

test("control: the owner lists their invoices", async () => {
  const { status } = await get("/invoices", "token-ada");
  assert.equal(status, 200);
});
`;

describe("a drafted check for the invoice example", () => {
  it("is written from the data's real fields, the application's entry and its module system", async () => {
    const { request } = await drafted(invoiceExample, invoiceTask, [
      authorTest("feature", overHttp),
    ]);
    expect(request).toContain("readonly ownerId: string;");
    expect(request).toContain('{ id: "u1", name: "Ada", role: "customer", token: "token-ada" }');
    expect(request).toContain(
      "export function handle(request: IncomingMessage, response: ServerResponse): void {",
    );
    expect(request).toContain("createServer(handle).listen(port);");
    expect(request).toMatch(/ES modules.*Use import; require/);
    expect(request).toContain("starts with `node src/server.ts`");
  });

  it("refuses a test of its own placeholder with what its run printed, and takes the mended draft", async () => {
    const { authored, model } = await drafted(invoiceExample, invoiceTask, [
      authorTest("feature", recordedDraft),
      authorTest("feature", overHttp),
    ]);
    expect(authored.attempts[0]?.[0]).toMatch(
      /^it calls handleDownloadInvoice, which the test file defines itself, and that is what fails at the base/,
    );
    expect(authored.attempts[1]).toEqual([]);
    expect(authored.failure).toBeNull();
    const told = model.authorSeen[1]?.at(-1)?.content ?? "";
    expect(told).toContain("What its run at the base printed");
    expect(told).toContain("Error: Not implemented");
    // The accepted draft fails at the base on the route the task asks for, and on nothing else.
    expect(authored.test?.atBase).toMatch(/the owner downloads their invoice/);
    expect(authored.test?.atBase).toMatch(/404 !== 200/);
  });

  // The repair task's draft (session 20261126T224147-81d38b) loaded its modules with require.
  it("says a require in an ES module is the draft's own fault, and how the package loads code", async () => {
    const common = `const assert = require("node:assert/strict");\nconst { test } = require("node:test");\ntest("x", () => { assert.equal(1, 2); });\n`;
    const { authored } = await drafted(invoiceExample, invoiceTask, [
      authorTest("feature", common),
    ]);
    expect(authored.attempts[0]?.[0]).toMatch(
      /^it calls require, which an ES module does not have.*use import/,
    );
    expect(authored.test).toBeNull();
  });
});

// A second API, unlike the first where it matters: other directories, a route table, an API key
// header, an `authorId`, a start function, and tests that drive the service over HTTP.
const notes = join(fileURLToPath(import.meta.url), "../../../examples/notes-api");
const notesTask =
  "Add DELETE /notes/:slug, which removes the note for the account that wrote it and answers 204.";
const notesDraft = (helper: string) => `import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../service/http.ts";

async function call(method, path, key) {
  const service = startService(0);
  const response = await fetch(\`http://127.0.0.1:\${service.address().port}\${path}\`, { method, headers: { "x-api-key": key } });
  service.close();
  return response.status;
}
${helper}
test("the author deletes their note", async () => {
  assert.equal(await call("DELETE", "/notes/n-1", "key-lin"), 204);
});

test("control: an account lists its notes", async () => {
  assert.equal(await call("GET", "/notes", "key-lin"), 200);
});
`;

describe("a drafted check for an API shaped another way", () => {
  it("is shown that API's own fields, key header, route table and start function", async () => {
    const { request } = await drafted(notes, notesTask, [authorTest("feature", notesDraft(""))]);
    expect(request).toContain("Your test file is laid at: spec/notes.swarm-r1.test.ts");
    expect(request).toContain("readonly authorId: string;");
    expect(request).toContain('{ key: "key-lin", handle: "lin" },');
    expect(request).toContain("export function startService(port: number): Server {");
    expect(request).toContain('request.headers["x-api-key"]');
    expect(request).toContain("starts with `node service/main.ts`");
    expect(request).not.toContain("ownerId");
  });

  it("takes a draft that drives the real service, failing at the base on the missing route alone", async () => {
    const { authored } = await drafted(notes, notesTask, [authorTest("feature", notesDraft(""))]);
    expect(authored.attempts).toEqual([[]]);
    expect(authored.test?.atBase).toMatch(/404 !== 204/);
  });

  it("sends a case that fails on every tree back to be mended, and never leaves it out", async () => {
    const broken = notesDraft(
      'test("the note is gone afterwards", async () => {\n  assert.equal(await call("GET", "/notes/n-1", missingKey), 404);\n});\n',
    );
    const { authored, model } = await drafted(notes, notesTask, [
      authorTest("feature", broken),
      authorTest("feature", notesDraft("")),
    ]);
    expect(authored.attempts[0]?.[0]).toMatch(/missingKey/);
    expect(authored.attempts[1]).toEqual([]);
    expect(model.authorSeen[1]?.at(-1)?.content).toContain(
      "every behavior the task states still checked",
    );
  });
});

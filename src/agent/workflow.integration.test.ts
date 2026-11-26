import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAgent } from "./run.ts";
import type { RunOptions } from "./run-options.ts";
import { authorTest, scripted, write } from "./test-doubles.ts";

/**
 * The invoice API example through whole runs with scripted model replies: a seeded insecure
 * candidate the protected check rejects and the loop repairs, and the ways a run must not reach
 * complete. The replies are fixtures written for these tests; no live model is involved here.
 */
const example = join(import.meta.dirname, "..", "..", "examples", "invoice-api");
const isolatedParent = join(homedir(), ".swarm", "test-work-agent", `workflow-${process.pid}`);
afterAll(async () => {
  await rm(isolatedParent, { recursive: true, force: true });
});

const task = (await readFile(join(example, "task.txt"), "utf8")).trim();
const app = await readFile(join(example, "src", "app.ts"), "utf8");

/** The app with a download route: `guard` is the line that decides who may have the invoice. */
const withDownload = (guard: string) =>
  app
    .replace(
      'import { listInvoices } from "./invoices.ts";',
      'import { invoices } from "./data.ts";\nimport { listInvoices } from "./invoices.ts";',
    )
    .replace(
      '  send(response, 404, { error: "not found" });\n}',
      `  const match = /^\\/invoices\\/([\\w-]+)\\/download$/.exec(path);
  const invoice = invoices.find((one) => one.id === match?.[1]);
  if (request.method === "GET" && invoice !== undefined${guard}) {
    send(response, 200, { number: invoice.number, totalCents: invoice.totalCents, lines: invoice.lines });
    return;
  }
  send(response, 404, { error: "not found" });
}`,
    );
/** Seeded fault: any signed-in user is served any invoice. */
const insecure = withDownload("");
const secure = withDownload(" && invoice.ownerId === user.id");

/** The check an author writes for the task without seeing a change: the owner gets their invoice. */
const ownerDownloads = authorTest(
  "feature",
  `import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { handle } from "../src/app.ts";

test("an owner downloads their invoice", async () => {
  const server = createServer(handle);
  await new Promise((settle) => server.listen(0, settle));
  const { port } = server.address();
  const response = await fetch("http://127.0.0.1:" + port + "/invoices/inv-1/download", {
    headers: { authorization: "Bearer token-ada" },
  });
  const body = await response.json();
  server.close();
  assert.equal(response.status, 200);
  assert.equal(body.number, "INV-2026-0001");
});`,
);

let port = 23_000 + (process.pid % 20_000);

async function invoiceRepo(isolation: "isolated" | "host" = "host") {
  const parent = isolation === "isolated" ? isolatedParent : tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "invoice-"));
  const repo = join(root, "repo");
  await cp(example, repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "base");
  // The binding the user stands behind, on a port of this test's own.
  port += 1;
  const binding = JSON.parse(await readFile(join(example, "security.json"), "utf8"));
  const file = join(root, "security.json");
  await writeFile(file, JSON.stringify({ ...binding, target: { ...binding.target, port } }));
  return {
    root,
    repo,
    file,
    run: (model: ReturnType<typeof scripted>, extra: Partial<RunOptions> = {}) => {
      process.env.SWARM_HOME = join(root, "home");
      return runAgent({
        workspace: repo,
        task,
        model,
        modelReason: "scripted for the test",
        cost: "none (scripted)",
        maxSteps: 8,
        maxTokens: 200_000,
        turnTokens: 1000,
        maxWallMs: null,
        contextTokens: 32_768,
        apply: false,
        isolation,
        approval: "auto",
        confirm: null,
        version: "test",
        security: { apply: [], exclude: [], file },
        log: () => {},
        ...extra,
      });
    },
  };
}

const shown = (model: ReturnType<typeof scripted>) =>
  model.seen.map((messages) => messages.at(-1)?.content ?? "").join("\n=====\n");
const done = "SWARM_TASK_COMPLETE";

describe("the invoice download task", () => {
  it("rejects the seeded insecure candidate at the protected check, and the loop repairs it at the server", async () => {
    const probe = await invoiceRepo();
    const model = scripted([write("src/app.ts", insecure), write("src/app.ts", secure), done], {
      author: [ownerDownloads],
    });
    const ran = await probe.run(model);
    const said = shown(model);
    // The first verification is of the insecure tree, and what it observed reaches the model.
    expect(said).toMatch(
      /behavior security-ownership-1::another user is refused failed: step 1 \(GET \/invoices\/inv-1\/download\): expected status 403 or 404, got 200/,
    );
    expect(said).toContain("Repair each at its cause: reproduce the failure it names");
    expect(ran.report.resources.verifications).toBe(2);
    expect(ran.report.state).toBe("complete");
    expect(ran.report.requirements.map((one) => [one.id, one.source, one.status])).toEqual([
      ["R1", "user", "satisfied"],
      ["R2", "security", "satisfied"],
    ]);
    expect(
      ran.result?.behavior[0]?.cases.map((one) => [one.name, one.base, one.candidate]),
    ).toEqual([
      ["the owner is served", "fail", "pass"],
      ["another user is refused", "pass", "pass"],
      ["an unauthenticated request is refused", "pass", "pass"],
      ["a user of another role is refused", "pass", "pass"],
    ]);
    expect(ran.report.notes.join("\n")).toMatch(/Security: ownership applies: the task names/);
    expect(ran.report.notes.join("\n")).toMatch(/Security: single-use-token does not apply/);
  });

  it("never completes while the insecure candidate stands, whatever the model says", async () => {
    const probe = await invoiceRepo();
    const model = scripted([write("src/app.ts", insecure), done], { author: [ownerDownloads] });
    const ran = await probe.run(model, { maxSteps: 5 });
    expect(ran.report.state).toBe("incomplete");
    expect(ran.report.requirements.find((one) => one.source === "security")?.status).toBe("failed");
  });

  it("is not moved by a candidate that rewrites the binding file in its own tree", async () => {
    const probe = await invoiceRepo();
    const forged = JSON.stringify({
      target: { start: "node src/server.ts", port: 3000 },
      checks: [],
    });
    const model = scripted([write("security.json", forged), write("src/app.ts", insecure), done], {
      author: [ownerDownloads],
    });
    const ran = await probe.run(model, { maxSteps: 5 });
    expect(ran.report.requirements.find((one) => one.source === "security")?.status).toBe("failed");
    expect(ran.report.state).toBe("incomplete");
  });

  it("uses a drafted binding where the user supplied none, and says nobody reviewed it", async () => {
    const probe = await invoiceRepo();
    const drafted = await readFile(probe.file, "utf8");
    const model = scripted([write("src/app.ts", secure), done], {
      author: [ownerDownloads],
      security: [`\`\`\`json\n${drafted}\n\`\`\``],
    });
    const ran = await probe.run(model, { security: { apply: [], exclude: [], file: null } });
    expect(ran.report.state).toBe("complete");
    expect(ran.result?.behavior[0]?.check.authority).toBe("independently-generated");
    expect(ran.report.notes.join("\n")).toMatch(
      /drafted by a model call that read the base and never the change, and nobody reviewed it: .*security\.json/,
    );
  });

  it("leaves the obligation unverified, and the run incomplete, where no binding could be drafted", async () => {
    const probe = await invoiceRepo();
    const model = scripted([write("src/app.ts", secure), done], {
      author: [ownerDownloads],
      security: ["UNKNOWN\nThe repository does not show how a user signs in."],
    });
    const ran = await probe.run(model, {
      maxSteps: 4,
      security: { apply: [], exclude: [], file: null },
    });
    expect(ran.report.requirements.find((one) => one.source === "security")?.status).toBe(
      "unverified",
    );
    expect(ran.report.state).toBe("incomplete");
    expect(ran.report.notes.join("\n")).toMatch(
      /no check could be drafted .*Supply the binding with --security-check/,
    );
  });

  it("stops before anything is built where an obligation's bearing cannot be told, and names the two answers", async () => {
    const probe = await invoiceRepo();
    const model = scripted([done], { author: [ownerDownloads] });
    const ran = await probe.run(model, {
      task: "Add a GET /reports/:id endpoint that returns the report.",
    });
    expect(ran.stop).toBe("blocked");
    expect(ran.report.reason).toMatch(
      /whether the ownership obligation applies could not be settled.*--security ownership or --no-security ownership/,
    );
    expect(model.seen).toEqual([]);
  });

  it("repairs the seeded fault in containers too, with the target and its driver apart", async () => {
    const probe = await invoiceRepo("isolated");
    const model = scripted([write("src/app.ts", insecure), write("src/app.ts", secure), done], {
      author: [ownerDownloads],
    });
    const ran = await probe.run(model);
    expect(shown(model)).toContain("another user is refused failed");
    expect(ran.report.state).toBe("complete");
    expect(ran.result?.behavior[0]?.assurance).toBe("external driver, isolated target");
    expect(ran.report.commands).toMatch(/^isolated: each command in a container/);
  });
});

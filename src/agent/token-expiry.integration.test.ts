import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgent } from "./run.ts";
import { authorTest, scripted, write } from "./test-doubles.ts";

/**
 * The invites example through whole runs with scripted model replies. Its base accepts an invite
 * once and never expires one, a fault seeded for the example. A token binding that gives no
 * expiry to wait for must not let the run complete, whoever wrote it; one that does must fail
 * the change that leaves expiry out and pass the one that enforces it. No live model here.
 */
const example = join(import.meta.dirname, "..", "..", "examples", "invites-api");
const task = (await readFile(join(example, "task.txt"), "utf8")).trim();
const app = await readFile(join(example, "src", "app.ts"), "utf8");
const binding = JSON.parse(await readFile(join(example, "security.json"), "utf8"));
const used = "    if (invite.acceptedBy !== null) {";
const enforced = app.replace(
  used,
  `    if (Date.now() - invite.issuedAt > settings.inviteTtlMs) {
      send(response, 410, { error: "invite expired" });
      return;
    }
${used}`,
);
/** A change that only rewords a refusal: the lifetime is still never read when accepting. */
const blind = app.replace("invite already used", "this invite was already used");

const expiryTest = `import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { handle } from "../src/app.ts";
import { settings } from "../src/config.ts";

test("an expired invite is refused with 410", async () => {
  settings.inviteTtlMs = 30;
  const server = createServer(handle);
  await new Promise((settle) => server.listen(0, settle));
  const base = "http://127.0.0.1:" + server.address().port;
  const issued = await fetch(base + "/teams/team-1/invites", {
    method: "POST",
    headers: { authorization: "Bearer token-ada" },
  });
  const { token } = await issued.json();
  await new Promise((settle) => setTimeout(settle, 80));
  const accepted = await fetch(base + "/invites/" + token + "/accept", {
    method: "POST",
    body: JSON.stringify({ name: "Lin" }),
  });
  server.close();
  assert.equal(accepted.status, 410);
});`;
// The author's check and the test the change adds are written apart; here they read alike.
const expires = authorTest("fix", expiryTest);
const ownTest = write("test/expiry.test.ts", expiryTest);

let port = 26_000 + (process.pid % 20_000);

const fenced = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

async function ran(
  replies: readonly string[],
  timed: boolean,
  drafted: boolean,
  firstDraft: (bound: typeof binding) => unknown[] = () => [],
) {
  const root = await mkdtemp(join(tmpdir(), "invites-"));
  const repo = join(root, "repo");
  await cp(example, repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "base");
  port += 1;
  const [check] = binding.checks;
  const { expiresAfterMs: _, ...untimed } = check;
  const bound = {
    target: { ...binding.target, port, env: timed ? binding.target.env : {} },
    checks: [timed ? check : untimed],
  };
  const file = join(root, "security.json");
  await writeFile(file, JSON.stringify(bound));
  process.env.SWARM_HOME = join(root, "home");
  const model = scripted([...replies, "SWARM_TASK_COMPLETE"], {
    author: [expires],
    security: [...firstDraft(bound).map(fenced), fenced(bound)],
  });
  const result = await runAgent({
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
    isolation: "host",
    approval: "auto",
    confirm: null,
    version: "test",
    checksMode: { kind: "accept-authored" },
    security: { apply: [], exclude: ["ownership"], file: drafted ? null : file },
    log: () => {},
  });
  const requirement = result.report.requirements.find((one) => one.source === "security");
  const cases = result.result?.behavior[0]?.cases ?? [];
  const expired = cases.find((one) => one.name.includes("expired"));
  return { ...result, requirement, expired, sentBack: model.securitySeen[1]?.at(-1)?.content };
}

describe("the invite expiry task", () => {
  it("does not complete on a binding with no expiry to wait for, supplied or drafted, though the change is right", async () => {
    for (const drafted of [false, true]) {
      const { report, requirement, expired } = await ran(
        [write("src/app.ts", enforced), ownTest],
        false,
        drafted,
      );
      expect(requirement?.status).toBe("unverified");
      expect(requirement?.limitation).toMatch(/not observed: .*an expired token is refused/);
      expect(requirement?.nextAction).toMatch(/gives no "expiresAfterMs"/);
      expect(expired).toMatchObject({ base: null, candidate: null });
      expect(report.state).toBe("incomplete");
      expect(report.notes.join("\n")).toMatch(/an expired token is refused: not exercised/);
    }
  });

  // In a run, the drafted acceptance test is a gate of its own in front of the security check:
  // it stops the change that leaves expiry out before any verification is spent on it.
  it("stops a change that leaves expiry out, and completes once the loop enforces it", async () => {
    // The first draft redeems with no body, which the base answers 400: sent back, not built on.
    const { report, requirement, expired, sentBack } = await ran(
      [write("src/app.ts", blind), ownTest, "SWARM_TASK_COMPLETE", write("src/app.ts", enforced)],
      true,
      true,
      (bound) => [
        {
          ...bound,
          checks: [{ ...bound.checks[0], redeem: { ...bound.checks[0].redeem, body: {} } }],
        },
      ],
    );
    expect(sentBack).toMatch(
      /the request of "a valid token is redeemed" is one the server calls malformed: step 2 .*got 400/,
    );
    expect(report.resources.verifications).toBe(1);
    expect(expired).toMatchObject({ base: "fail", candidate: "pass" });
    expect(requirement?.status).toBe("satisfied");
    expect(report.state).toBe("complete");
    expect(report.notes.join("\n")).toMatch(/an expired token is refused: fail;/);
  });
});

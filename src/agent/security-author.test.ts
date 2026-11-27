import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecurityFile } from "swarm-verify";
import { describe, expect, it } from "vitest";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { draftSecurity } from "./security-author.ts";
import { scripted } from "./test-doubles.ts";

const task =
  "Add DELETE /notes/:slug: the account that owns the note deletes it and gets 204; any other account gets 404.";
const shown = [
  {
    path: "service/store.ts",
    whole: true,
    lines: ['{ key: "key-lin", handle: "lin" },', '{ key: "key-omar", handle: "omar" },'],
  },
];
const good = {
  target: { start: "node service/main.ts", port: 8080 },
  checks: [
    {
      class: "ownership",
      resource: { method: "DELETE", path: "/notes/n-1" },
      owner: { "x-api-key": "key-lin" },
      other: { "x-api-key": "key-omar" },
      signedIn: { method: "GET", path: "/notes" },
      success: [204],
    },
  ],
};
const [check] = good.checks;
const fenced = (binding: object) => `\`\`\`json\n${JSON.stringify(binding)}\n\`\`\``;

/** Drafts with scripted replies; `atBase` stands in for the trial with real requests. */
async function drafting(replies: readonly string[], atBase: (file: SecurityFile) => string | null) {
  const root = await mkdtemp(join(tmpdir(), "binding-"));
  await mkdir(join(root, "sessions"), { recursive: true });
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
  const model = scripted([], { security: replies });
  const drafted = await draftSecurity({
    model,
    evidence,
    task,
    classes: ["ownership"],
    runtime: ["The application starts with `node service/main.ts` (the start script)."],
    shown,
    tryAtBase: async (file) => atBase(file),
    turnTokens: 1000,
  });
  return { drafted, told: model.securitySeen.map((messages) => messages.at(-1)?.content ?? "") };
}

describe("a drafted security binding", () => {
  // The notes example, live on 2026-11-26: the draft bound ownership to GET /notes, the list
  // every account may read, and the requirement failed on the base and on every change after.
  it("is sent back where its request is not the one the task names", async () => {
    const list = {
      ...good,
      checks: [{ ...check, resource: { method: "GET", path: "/notes/n-1" } }],
    };
    const { drafted, told } = await drafting([fenced(list), fenced(good)], () => null);
    expect(told[1]).toMatch(
      /the ownership check sends GET \/notes\/n-1, which is not a request the task names \(DELETE \/notes\/:slug:?\)/,
    );
    expect(drafted.file?.checks[0]).toMatchObject({
      resource: { method: "DELETE", path: "/notes/n-1" },
    });
    expect(drafted.attempts).toHaveLength(1);
  });

  // The same live draft answered the owner 200 with the note's text, for a delete the task says
  // is answered 204: no correct change could have passed it. Every such fault is named at once.
  it("is sent back with every fault that needs no request, in one reply", async () => {
    const wrong = {
      ...good,
      checks: [
        {
          ...check,
          resource: { method: "GET", path: "/notes" },
          success: [200],
          ownerSees: ["first"],
        },
      ],
    };
    const { told } = await drafting([fenced(wrong), fenced(good)], () => null);
    expect(told[1]).toMatch(/sends GET \/notes, which is not a request the task names/);
    expect(told[1]).toMatch(/"success" is 200 where the task says the request is answered 204/);
    expect(told[1]).toMatch(/signedIn is the resource itself/);
    const bodied = { ...good, checks: [{ ...check, ownerSees: ["first"] }] };
    expect((await drafting([fenced(bodied), fenced(good)], () => null)).told[1]).toMatch(
      /"ownerSees" names text in a 204 response/,
    );
  });

  it("is sent back without a signed-in request, with a credential it was not shown, and with what the base showed", async () => {
    const unsigned = { ...good, checks: [{ ...check, signedIn: undefined }] };
    const invented = { ...good, checks: [{ ...check, other: { "x-api-key": "key-eve" } }] };
    const { drafted, told } = await drafting(
      [fenced(unsigned), fenced(invented), fenced(good)],
      () => "at the base, its target did not answer on port 8080",
    );
    expect(told[1]).toMatch(/has no "signedIn" request/);
    expect(told[2]).toMatch(/"key-eve" is not in the repository files you were shown/);
    // The third draft is well formed, and the trial at the base is what refuses it.
    expect(drafted.file).toBeNull();
    expect(drafted.failure).toBe("at the base, its target did not answer on port 8080");
    expect(drafted.attempts).toHaveLength(3);
  });

  it("stops at once where the repository does not show what the checks need, and says what", async () => {
    const { drafted, told } = await drafting(["UNKNOWN\nNo seed account is shown."], () => null);
    expect(told).toHaveLength(1);
    expect(drafted.file).toBeNull();
    expect(drafted.failure).toMatch(
      /does not show what the checks need: UNKNOWN No seed account is shown\./,
    );
  });
});

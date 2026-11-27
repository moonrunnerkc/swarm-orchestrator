import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { handle } from "../src/app.ts";

const server = createServer(handle);
let base = "";
before(async () => {
  await new Promise<void>((settle) => server.listen(0, settle));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const ada = { authorization: "Bearer token-ada" };
const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("the team's owner issues an invite, and its holder joins the team", async () => {
  const issued = await post("/teams/team-1/invites", ada);
  assert.equal(issued.status, 201);
  const { token } = (await issued.json()) as { token: string };
  const accepted = await post(`/invites/${token}/accept`, {}, { name: "Lin" });
  assert.equal(accepted.status, 200);
  const { members } = (await accepted.json()) as { members: string[] };
  assert.ok(members.includes("Lin"));
});

test("an invite is accepted once, and an unknown one never", async () => {
  const issued = await post("/teams/team-1/invites", ada);
  const { token } = (await issued.json()) as { token: string };
  assert.equal((await post(`/invites/${token}/accept`, {}, { name: "Omar" })).status, 200);
  assert.equal((await post(`/invites/${token}/accept`, {}, { name: "Omar" })).status, 409);
  assert.equal((await post("/invites/never-issued/accept", {}, { name: "Omar" })).status, 404);
});

test("only the team's owner issues an invite", async () => {
  const issued = await post("/teams/team-1/invites", { authorization: "Bearer token-grace" });
  assert.equal(issued.status, 403);
});

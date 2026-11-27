// Runs inside a container with no network, in the tree under judgment: starts the application
// as its start script does and sends it the requests a careful reviewer would. Prints one JSON
// line. Nothing here was produced by the run under judgment.
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms));
async function served(env, port, work) {
  const child = spawn("node", ["src/server.ts"], { env: { ...process.env, PORT: String(port), ...env }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let tries = 0; ; tries += 1) {
      try { await fetch(`${base}/health`); break; } catch { if (tries > 80) throw new Error("the server did not start"); await sleep(100); }
    }
    return await work(base);
  } finally { child.kill("SIGKILL"); }
}
const ada = { authorization: "Bearer token-ada", "content-type": "application/json" };
const issue = async (base) => (await (await fetch(`${base}/teams/team-1/invites`, { method: "POST", headers: ada })).json()).token;
const accept = async (base, token, name) => (await fetch(`${base}/invites/${token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).status;
const members = async (base) => (await (await fetch(`${base}/teams/team-1/members`, { headers: ada })).json()).members;
const count = (list, name) => list.filter((one) => one === name).length;

const short = await served({ INVITE_TTL_MS: "700" }, 4311, async (base) => {
  const found = {};
  const valid = await issue(base);
  found.valid = { status: await accept(base, valid, "J-valid"), joined: count(await members(base), "J-valid") };
  found.reused = { status: await accept(base, valid, "J-again"), joined: count(await members(base), "J-again"), first: count(await members(base), "J-valid") };
  found.unknown = { status: await accept(base, "never-issued-0000", "J-unknown"), joined: count(await members(base), "J-unknown") };
  const late = await issue(base);
  await sleep(1100);
  found.expired = { status: await accept(base, late, "J-expired"), joined: count(await members(base), "J-expired") };
  found.expiredAgain = { status: await accept(base, late, "J-expired"), joined: count(await members(base), "J-expired") };
  const early = await issue(base);
  await sleep(150);
  found.withinLife = { status: await accept(base, early, "J-early"), joined: count(await members(base), "J-early") };
  const burst = await issue(base);
  const statuses = await Promise.all(Array.from({ length: 8 }, () => accept(base, burst, "J-burst")));
  found.concurrent = { statuses, joined: count(await members(base), "J-burst") };
  return found;
});
// The default lifetime is a day: an invite a second old must still work where nothing shortens it.
const byDefault = await served({}, 4312, async (base) => {
  const token = await issue(base);
  await sleep(1100);
  return { status: await accept(base, token, "J-default"), joined: count(await members(base), "J-default") };
});
const refused = (status) => status >= 400 && status < 500;
const checks = {
  "a valid invite is accepted with 200 and its holder joins": short.valid.status === 200 && short.valid.joined === 1,
  "a used invite is refused with 409 and adds nobody": short.reused.status === 409 && short.reused.joined === 0 && short.reused.first === 1,
  "an unknown invite is refused with 404 and adds nobody": short.unknown.status === 404 && short.unknown.joined === 0,
  "an expired invite is refused with 410 and adds nobody": short.expired.status === 410 && short.expired.joined === 0,
  "an expired invite stays refused": refused(short.expiredAgain.status) && short.expiredAgain.joined === 0,
  "an invite within its life is accepted": short.withinLife.status === 200 && short.withinLife.joined === 1,
  "of eight acceptances at once one succeeds and one member is added": short.concurrent.statuses.filter((one) => one === 200).length === 1 && short.concurrent.statuses.every((one) => one === 200 || refused(one)) && short.concurrent.joined === 1,
  "the default lifetime still admits a second-old invite": byDefault.status === 200 && byDefault.joined === 1,
};
console.log(JSON.stringify({ observed: { short, byDefault }, checks }));

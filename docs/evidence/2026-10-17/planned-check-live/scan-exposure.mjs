#!/usr/bin/env node
/**
 * What each recorded model request carried that the model must not have been given, read from the
 * proxy's record of a seeded run. Only content the harness sent is scanned: system, user and tool
 * messages; the model's own earlier turns are not, since what it wrote is its own.
 *
 * Markers:
 * - `faulty`: lines the retained faulty patch adds that the base does not already hold;
 * - `upstream`: lines the maintainer's commit adds to the source that the base does not hold;
 * - `evaluator`: the audits', hidden checks' and evaluator scripts' identifiers.
 *
 * A planner request must carry none. A repair request carries the seeded candidate by design (the
 * workspace holds it, and the brief records its digest), so `faulty` there is expected and named;
 * `upstream` or `evaluator` anywhere is exposure.
 *
 *   node scan-exposure.mjs --task mime|tar --record <seeded run output dir> --out <file>
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { mirrorOf } from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { expandExchanges } from "./seeded/exchange-record.mjs";

const { values } = parseArgs({
  options: { task: { type: "string" }, record: { type: "string" }, out: { type: "string" } },
});
const ids = { mime: "mime-bugfix-gettype-line-terminators", tar: "tar-bugfix-negative-size" };
const task = tasks.find((one) => one.id === ids[values.task ?? ""]);
if (task === undefined || values.record === undefined || values.out === undefined)
  throw new Error("usage: scan-exposure.mjs --task mime|tar --record <dir> --out <file>");
const record = resolve(values.record);
const git = (...args) =>
  spawnSync("git", ["-C", mirrorOf(task.repository), ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;

const sources = task.hidden.allowedPaths;
const baseLines = new Set(
  sources.flatMap((path) => git("show", `${task.baseCommit}:${path}`).split("\n").map((line) => line.trim())),
);
/** Added lines that say something: not already in the base, not punctuation, not short. */
const distinctive = (patch) => [
  ...new Set(
    patch
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1).trim())
      .filter((line) => line.length >= 16 && !baseLines.has(line) && /[A-Za-z]/.test(line)),
  ),
];
const markers = {
  faulty: distinctive(readFileSync(join(record, "seeded.patch"), "utf8")),
  upstream: distinctive(git("diff", task.baseCommit, task.upstreamCommit, "--", ...sources)),
  evaluator: [
    "mime-audit", "tar-audit", "acceptance/hidden", "negative-size.mjs", "expectedType",
    "verify-checks", "scan-exposure", "correctness-amendment", "audit-mime",
  ],
};

const exchanges = expandExchanges(
  JSON.parse(gunzipSync(readFileSync(join(record, "exchanges.json.gz"))).toString("utf8")),
);
const roleOf = (messages) => {
  const system = String(messages.find((one) => one.role === "system")?.content ?? "");
  const text = JSON.stringify(messages);
  if (system.startsWith("You write the acceptance checks")) return "planner";
  if (text.includes("A quality gate is failing")) return "repair";
  return "other";
};
const requests = exchanges
  .filter((one) => Array.isArray(one.request?.messages))
  .map((one) => {
    const messages = one.request.messages;
    const harnessText = messages
      .filter((message) => message.role !== "assistant")
      .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
      .join("\n");
    const found = Object.fromEntries(
      Object.entries(markers).map(([kind, list]) => [kind, list.filter((marker) => harnessText.includes(marker))]),
    );
    return { sequence: one.sequence, route: one.route, role: one.route === "seeded" ? "seeded" : roleOf(messages), found };
  });
const exposure = requests.filter(
  (one) =>
    one.found.upstream.length > 0 ||
    one.found.evaluator.length > 0 ||
    (one.role === "planner" && one.found.faulty.length > 0),
);
const result = {
  schema: "swarm-request-exposure-scan.v1",
  task: task.id,
  markers: Object.fromEntries(Object.entries(markers).map(([kind, list]) => [kind, list.length])),
  // Per role: how many requests, and how many of them carried each kind of marker.
  byRole: Object.fromEntries(
    [...new Set(requests.map((one) => one.role))].map((role) => {
      const mine = requests.filter((one) => one.role === role);
      return [
        role,
        {
          requests: mine.length,
          ...Object.fromEntries(
            Object.keys(markers).map((kind) => [kind, mine.filter((one) => one.found[kind].length > 0).length]),
          ),
        },
      ];
    }),
  ),
  exposure: exposure.map((one) => ({ sequence: one.sequence, role: one.role, found: one.found })),
  verdict:
    exposure.length === 0
      ? "no planner request carried the faulty patch, and no request carried the upstream change or the evaluator"
      : "exposure found; see exposure",
};
writeFileSync(resolve(values.out), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.verdict, JSON.stringify(result.markers));

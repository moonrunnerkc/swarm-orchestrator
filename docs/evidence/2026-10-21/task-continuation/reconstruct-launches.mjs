// Reconstruct every candidate tree of the two development launches from their published ledgers,
// by replaying the recorded tool calls over the sinon base, and hold each to the diff digest the
// launch's own independent-verification record carries. No model.
//
//   node reconstruct-launches.mjs --launch-1 <session dir> --launch-2 <session dir> --out <dir> [--mirror <bare clone>]
//
// The session directories are what `node scripts/evidence-pack.mjs restore
// docs/evidence/2026-10-21/delivery-trial/packed-derived/payloads` gives back (payloads/launch-N/session-*).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { base, changeAgainst, cloneBase, ensureMirror, readLedger, replayRange, resetTree } from "./replay-edits.mjs";

const { values } = parseArgs({
  options: { "launch-1": { type: "string" }, "launch-2": { type: "string" }, out: { type: "string" }, mirror: { type: "string" } },
});
if (values["launch-1"] === undefined || values["launch-2"] === undefined || values.out === undefined)
  throw new Error("usage: reconstruct-launches.mjs --launch-1 <session> --launch-2 <session> --out <dir> [--mirror <bare clone>]");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const tree = cloneBase(ensureMirror(values.mirror), mkdtempSync(join(tmpdir(), "sinon-reconstruct-")));

// Each phase is the base plus the ranges of the ledger it replays: the first loop's calls, then
// (from the restored first candidate, as the resolve loop restores before every attempt) one
// repair attempt's calls. The expected digests are the launches' own records: launch 1's
// independent-verification records 289, 443 and 662 (sourcePatchDigest) and workspace-diff 676;
// launch 2's 289 and 347, and workspace-diff 359.
const phases = {
  "launch-1": [
    { name: "first", ranges: [[0, 272]], expected: "sha256:c5a77e64b861d6b9b0b4ffaae6ff1769ce68d2027884305ef250106d0589297b", records: ["289 independent-verification", "676 workspace-diff"] },
    { name: "repair-1", ranges: [[0, 272], [290, 427]], expected: "sha256:737535fda55ec58764e1d77f323416d4d6f740e7c4c8db57d1f0a52b6fbcce95", records: ["443 independent-verification"] },
    { name: "repair-2", ranges: [[0, 272], [446, 646]], expected: "sha256:f19efa1c28994d417d9754bc25309d2d8c627d684aa159c219a6dc668fe9a580", records: ["662 independent-verification"] },
  ],
  "launch-2": [
    { name: "first", ranges: [[0, 272]], expected: "sha256:ae0822f84637ce64c64f0dc3026b8af8dc9766dd9a123bf4c92fe7875b2c6918", records: ["289 independent-verification"] },
    { name: "repair-1", ranges: [[0, 272], [290, 331]], expected: "sha256:7de576a18acc5c8d7cb9363e56a60f5f2859077683eb60791b0dfa6e464889bd", records: ["347 independent-verification", "359 workspace-diff"] },
  ],
};
const results = {};
for (const [launch, list] of Object.entries(phases)) {
  const ledger = readLedger(values[launch]);
  results[launch] = [];
  for (const phase of list) {
    resetTree(tree);
    const applied = phase.ranges.flatMap(([from, to]) => replayRange(tree, ledger, from, to));
    const change = changeAgainst(tree, base);
    mkdirSync(join(out, launch), { recursive: true });
    writeFileSync(join(out, launch, `${phase.name}.patch`), change.patch);
    const result = { phase: phase.name, calls: applied.length, digest: change.digest, expected: phase.expected, matches: change.digest === phase.expected, records: phase.records, applied };
    results[launch].push(result);
    console.log(`${launch} ${phase.name}: ${applied.length} call(s); ${change.digest} ${result.matches ? "matches" : "DOES NOT MATCH"} ${phase.expected}`);
  }
}
resetTree(tree);
writeFileSync(join(out, "reconstruction.json"), `${JSON.stringify({ base, results }, null, 2)}\n`);

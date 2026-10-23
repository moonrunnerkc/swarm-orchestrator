/**
 * The first candidate the gates checked in a kept Swarm session, rebuilt from the first repair or
 * continuation brief, which carries the candidate's whole diff when it is under 6,000 characters
 * and the digest the harness recorded for it. The rebuilt bytes count only if their digest is that
 * one; otherwise the candidate is named unreconstructable. No model call.
 *
 *   node initial-candidate.mjs <session-directory> <out.patch>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, out] = process.argv.slice(2);
const records = readFileSync(join(directory, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const payload = (record) => JSON.parse(readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`)));
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const lead = "That change, as a diff against the base (lines marked - are the base's own; the files you read already hold the + lines):\n";
for (const record of records) {
  if (record.type !== "transcript-component") continue;
  const value = payload(record);
  const text = value.kind === "message" && value.value?.role === "user" ? value.value.text : null;
  if (typeof text !== "string" || !text.includes(lead)) continue;
  const recorded = /Your current change against it is recorded as (sha256:[0-9a-f]{64})/.exec(text)?.[1];
  const body = text.slice(text.indexOf(lead) + lead.length);
  const diff = body.slice(0, body.indexOf("\nThe workspace is in the state"));
  if (diff.startsWith("(no change yet")) {
    console.log(JSON.stringify({ recorded, reconstructed: true, empty: true }));
    writeFileSync(out, "");
    process.exit(0);
  }
  if (diff.includes("[diff truncated;")) {
    console.log(JSON.stringify({ recorded, reconstructed: false, reason: "the brief truncated the diff" }));
    process.exit(0);
  }
  const bytes = `${diff}\n`;
  const matches = digest(bytes) === recorded;
  if (matches) writeFileSync(out, bytes);
  console.log(JSON.stringify({ recorded, reconstructed: matches, ...(matches ? {} : { reason: `rebuilt bytes are ${digest(bytes)}` }) }));
  process.exit(0);
}
console.log(JSON.stringify({ reconstructed: false, reason: "no repair or continuation brief: the first candidate is the delivered one" }));

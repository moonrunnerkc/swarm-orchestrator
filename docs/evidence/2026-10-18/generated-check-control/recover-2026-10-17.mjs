#!/usr/bin/env node
/**
 * Looks for the material 2026-10-17's repair-detection record dropped to fit the tracked tree
 * (`../../2026-10-17/repair-detection-live/stdout-trimmed.json`): each launch's full stdout and
 * the planning chains' ledger copies. A candidate counts as the original only if its bytes have
 * the digest that record names; nothing is reconstructed from a digest.
 *
 * Where they are looked for: each launch's own session on this machine (the driver's scratch
 * directory, named in its summary.json), git history of the record's directory, and the build
 * directories checked out from that history. Recovered bytes are copied, unchanged, into
 * `--copy-to`, with the planning chains' blobs beside their ledgers, for packing; the historical
 * record itself is not touched.
 *
 *   node recover-2026-10-17.mjs --copy-to <empty dir> --out <file>
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { unpackArchive } from "../../../../scripts/local-campaign/archive.mjs";

const { values } = parseArgs({ options: { "copy-to": { type: "string" }, out: { type: "string" } } });
if (values["copy-to"] === undefined || values.out === undefined)
  throw new Error("usage: recover-2026-10-17.mjs --copy-to <empty dir> --out <file>");
const record = new URL("../../2026-10-17/repair-detection-live/", import.meta.url).pathname;
const repository = new URL("../../../../", import.meta.url).pathname;
const trimmed = JSON.parse(readFileSync(join(record, "stdout-trimmed.json"), "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const copyTo = values["copy-to"];
mkdirSync(copyTo, { recursive: true });
if (readdirSync(copyTo).length > 0) throw new Error(`${copyTo} is not empty`);

// Each launch's scratch directory, from the summary the driver wrote beside its streams.
const pack = await unpackArchive(join(record, "packed-derived/launch-streams"));
const scratchOf = Object.fromEntries(
  trimmed.launches.map(({ launch }) => [
    launch,
    JSON.parse(readFileSync(join(pack.directory, launch, "summary.json"), "utf8")).scratch,
  ]),
);
await pack.dispose();

/** Every blob git history holds at a path under the record's directory, with the commit that added it. */
function historicalBlobs(pathSuffix) {
  const found = [];
  const log = execFileSync(
    "git",
    ["log", "--all", "--format=%H", "--", `docs/evidence/2026-10-17/repair-detection-live/${pathSuffix}`],
    { cwd: repository, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  for (const commit of log) {
    try {
      const bytes = execFileSync(
        "git",
        ["show", `${commit}:docs/evidence/2026-10-17/repair-detection-live/${pathSuffix}`],
        { cwd: repository, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
      );
      found.push({ where: `git ${commit.slice(0, 9)}:${pathSuffix}`, bytes });
    } catch {
      // Not present at that commit (the commit removed it).
    }
  }
  return found;
}

const stdout = trimmed.launches.map(({ launch, original }) => {
  const candidates = [
    ...historicalBlobs(`${launch}/stdout.txt.gz`).map((one) => ({ ...one, bytes: gunzipSync(one.bytes) })),
    ...historicalBlobs(`${launch}/stdout.txt`),
  ];
  const tools = join(process.env.HOME ?? "", ".cache/swarm-comparison/tools");
  for (const build of existsSync(tools) ? readdirSync(tools) : []) {
    const path = join(tools, build, "docs/evidence/2026-10-17/repair-detection-live", launch, "stdout.txt.gz");
    if (existsSync(path)) candidates.push({ where: path, bytes: gunzipSync(readFileSync(path)) });
  }
  const match = candidates.find((one) => digest(one.bytes) === original.digest);
  if (match !== undefined) {
    mkdirSync(join(copyTo, launch), { recursive: true });
    writeFileSync(join(copyTo, launch, "stdout.txt"), match.bytes);
  }
  return {
    launch,
    item: "stdout",
    expected: original,
    looked: candidates.map((one) => ({ where: one.where, digest: digest(one.bytes), bytes: one.bytes.length })),
    recovered: match === undefined ? null : { from: match.where, bytes: match.bytes.length },
  };
});

const ledgers = trimmed.planLedgers.dropped.map(({ path, bytes, digest: expected }) => {
  const [launch, file] = path.split("/");
  const chain = file.replace(/\.ledger\.jsonl$/, "");
  const session = join(scratchOf[launch], "home/.swarm/sessions", chain);
  const ledger = join(session, "ledger.jsonl");
  const found = existsSync(ledger) ? readFileSync(ledger) : null;
  const matches = found !== null && digest(found) === expected;
  if (matches) {
    mkdirSync(join(copyTo, launch), { recursive: true });
    writeFileSync(join(copyTo, launch, file), found);
    // The chain's blobs, which the ledger copy cites by digest and the record never held.
    cpSync(join(session, "blobs"), join(copyTo, launch, `${chain}.blobs`), { recursive: true });
  }
  return {
    launch,
    item: "planning chain ledger",
    expected: { bytes, digest: expected },
    looked: [{ where: ledger, digest: found === null ? null : digest(found), bytes: found?.length ?? null }],
    recovered: matches
      ? {
          from: ledger,
          bytes: found.length,
          blobs: readdirSync(join(session, "blobs")).length,
        }
      : null,
  };
});

const result = {
  schema: "swarm-stream-recovery.v1",
  rule: "a candidate is the original only if its bytes have the digest stdout-trimmed.json names; nothing is reconstructed from a digest",
  items: [...stdout, ...ledgers],
  recovered: [...stdout, ...ledgers].filter((one) => one.recovered !== null).map((one) => `${one.launch} ${one.item}`),
  missing: [...stdout, ...ledgers].filter((one) => one.recovered === null).map((one) => `${one.launch} ${one.item}`),
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ recovered: result.recovered, missing: result.missing }, null, 2));

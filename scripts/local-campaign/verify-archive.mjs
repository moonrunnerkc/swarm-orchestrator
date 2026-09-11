import { access, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { verifyBundle } from "../../src/evidence/verifier/verify.mjs";
import { unpackArchive } from "./archive.mjs";
import { summarizeCampaign } from "./report.mjs";

const inventorySchema = z.object({
  version: z.literal(1),
  sources: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    }),
  ),
});

export async function verifyArchive(directory) {
  const compressed = await access(join(directory, "archive-manifest.json")).then(
    () => true,
    () => false,
  );
  if (compressed) {
    const unpacked = await unpackArchive(directory);
    try {
      const verified = await verifyExpandedArchive(unpacked.directory);
      const inventory = inventorySchema.parse(
        JSON.parse(await readFile(join(unpacked.directory, "inventory.json"), "utf8")),
      );
      for (const entry of [
        ...inventory.sources,
        {
          path: "inventory.json",
          digest: digestOfBytes(await readFile(join(unpacked.directory, "inventory.json"))),
        },
      ]) {
        const readable = await readFile(join(directory, entry.path)).catch((cause) => {
          if (cause.code === "ENOENT") return null;
          throw cause;
        });
        if (readable !== null && digestOfBytes(readable) !== entry.digest)
          verified.problems.push(`published readable artifact mismatch ${entry.path}`);
      }
      return { ...verified, ok: verified.problems.length === 0 };
    } finally {
      await unpacked.dispose();
    }
  }
  return verifyExpandedArchive(directory);
}

async function verifyExpandedArchive(directory) {
  const inventory = inventorySchema.parse(
    JSON.parse(await readFile(join(directory, "inventory.json"), "utf8")),
  );
  const problems = [];
  const named = new Set();
  for (const entry of inventory.sources) {
    const target = resolve(directory, entry.path);
    const inside = relative(resolve(directory), target);
    if (named.has(entry.path) || isAbsolute(entry.path) || inside.startsWith("..")) {
      problems.push(`invalid inventory path ${entry.path}`);
      continue;
    }
    named.add(entry.path);
    const bytes = await readFile(target).catch(() => null);
    if (bytes === null || bytes.length !== entry.bytes || digestOfBytes(bytes) !== entry.digest)
      problems.push(`artifact mismatch ${entry.path}`);
  }
  const bundleNames = await readdir(join(directory, "bundles")).catch(() => []);
  for (const name of bundleNames)
    if (verifyBundle(join(directory, "bundles", name), () => {}) !== 0)
      problems.push(`bundle failed ${name}`);
  for (const prefix of ["", "recheck/"]) {
    if (!named.has(`${prefix}protocol.json`) || !named.has(`${prefix}summary.json`)) continue;
    const protocol = JSON.parse(await readFile(join(directory, `${prefix}protocol.json`), "utf8"));
    const rows = await Promise.all(
      protocol.schedule.map(async (entry) =>
        JSON.parse(await readFile(join(directory, prefix, "runs", `${entry.runId}.json`), "utf8")),
      ),
    );
    const computed = summarizeCampaign(rows, protocol.schedule);
    const recorded = JSON.parse(await readFile(join(directory, `${prefix}summary.json`), "utf8"));
    if (JSON.stringify(computed) !== JSON.stringify(recorded))
      problems.push(`${prefix}campaign summary does not follow from scheduled outcomes`);
    const snapshot = prefix ? "development-recheck" : "evaluation";
    for (const [path, digest] of Object.entries(protocol.sources ?? {})) {
      const archived = inventory.sources.find(
        (entry) => entry.path === `tested-sources/${snapshot}/${path}`,
      );
      if (archived?.digest !== digest) problems.push(`frozen source mismatch ${prefix}${path}`);
    }
  }
  return {
    ok: problems.length === 0,
    artifacts: named.size,
    bundles: bundleNames.length,
    problems,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const verified = await verifyArchive(
    resolve(process.argv[2] ?? "docs/evidence/2026-09-11/local-campaign"),
  );
  console.log(JSON.stringify(verified, null, 2));
  process.exitCode = verified.ok ? 0 : 1;
}

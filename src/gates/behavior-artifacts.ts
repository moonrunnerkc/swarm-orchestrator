import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { asJsonValue, digestOfBytes } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

const attachment = z.object({
  path: z.string(),
  name: z.string(),
  contentType: z.enum(["image/png", "application/zip"]),
});

/** Retain bounded diagnostics before cleanup; artifacts never decide acceptance. */
export async function retainBehaviorArtifacts(
  stdout: string,
  checkout: string,
  evidence: EvidenceRecorder,
): Promise<readonly string[]> {
  const paths: z.infer<typeof attachment>[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 32 || paths.length >= 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "attachments" && Array.isArray(item))
        for (const entry of item) {
          const parsed = attachment.safeParse(entry);
          if (parsed.success && paths.length < 8) paths.push(parsed.data);
        }
      else walk(item, depth + 1);
    }
  };
  try {
    walk(JSON.parse(stdout), 0);
  } catch {
    return [];
  }
  const root = await realpath(checkout);
  let remaining = 4_000_000;
  const records: string[] = [];
  for (const item of paths) {
    const file = resolve(
      checkout,
      item.path.startsWith("/workspace/") ? item.path.slice("/workspace/".length) : item.path,
    );
    let payload: Record<string, unknown>;
    try {
      const actual = await realpath(file);
      const path = relative(root, actual);
      if (
        path.startsWith(`..${sep}`) ||
        path === ".." ||
        isAbsolute(path) ||
        path.split(sep).some((part) => part.startsWith(".")) ||
        !/\.(png|zip)$/.test(path)
      )
        throw new Error("artifact path refused");
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > Math.min(1_000_000, remaining))
        throw new Error("artifact exceeds retention bound or is not a regular file");
      const bytes = await readFile(file);
      if (bytes.length !== stat.size) throw new Error("artifact changed while reading");
      remaining -= bytes.length;
      payload = {
        path,
        name: item.name,
        contentType: item.contentType,
        digest: digestOfBytes(bytes),
        encoding: "base64",
        data: bytes.toString("base64"),
        bytes: bytes.length,
        diagnosticOnly: true,
      };
    } catch (cause) {
      payload = {
        path: item.path,
        unavailable: cause instanceof Error ? cause.message : "artifact unavailable",
        diagnosticOnly: true,
      };
    }
    const record = await evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({ rule: "behavior-artifact-v1", ...payload }),
    });
    records.push(record.record.payloadDigest);
  }
  return records;
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, digestFileName, digestOfBytes, type JsonValue } from "./canonical-json.ts";

class BlobWriteFailedError extends Error {
  constructor(digest: string, cause: unknown) {
    super(
      `could not store evidence blob ${digest}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        "Check that the session store is writable, then rerun.",
    );
    this.name = "BlobWriteFailedError";
    this.cause = cause;
  }
}

export interface BlobStore {
  readonly directory: string;
  /** Returns the content digest, which is the only name the blob ever has. */
  put(value: JsonValue): Promise<string>;
  get(digest: string): Promise<JsonValue | null>;
  bytes(digest: string): Promise<string | null>;
  pathFor(digest: string): string;
}

/**
 * Content-addressed by SHA-256 over the canonical bytes (invariant 4). Identical content
 * writes once and dedupes across sessions for free, which is also what makes the retention
 * policy cheap later.
 */
export async function openBlobStore(directory: string): Promise<BlobStore> {
  await mkdir(directory, { recursive: true });

  const pathFor = (digest: string): string => join(directory, digestFileName(digest));

  const bytes = async (digest: string): Promise<string | null> => {
    try {
      return await readFile(pathFor(digest), "utf8");
    } catch {
      return null;
    }
  };

  return {
    directory,
    pathFor,

    async put(value: JsonValue): Promise<string> {
      const bytes = canonicalJson(value);
      const digest = digestOfBytes(bytes);
      try {
        // Exclusive create: same content, same key, so an existing blob is already correct.
        await writeFile(pathFor(digest), bytes, { encoding: "utf8", flag: "wx" });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new BlobWriteFailedError(digest, cause);
        }
      }
      return digest;
    },

    async get(digest: string): Promise<JsonValue | null> {
      const raw = await bytes(digest);
      return raw === null ? null : (JSON.parse(raw) as JsonValue);
    },

    bytes,
  };
}

import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { scrubJson } from "../evidence/scrub.ts";

const entrySchema = z.object({
  sequence: z.number().int().nonnegative(),
  previousHash: z.string(),
  operation: z.string(),
  projection: z.record(z.string(), z.unknown()),
});

const projections = new Map<
  string,
  { digest: string; projection: unknown; count: number; head: string }
>();

/** A rebuildable projection, appended under an exclusive writer lease and checked on every read. */
export function openRunJournal<Projection extends object>(
  path: string,
  empty: () => Projection,
  parse: (input: unknown) => Projection,
) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const read = () => {
    if (!existsSync(path)) return { projection: empty(), count: 0, head: "genesis" };
    const bytes = readFileSync(path, "utf8");
    const digest = digestOfBytes(bytes);
    const cached = projections.get(path);
    if (cached?.digest === digest) {
      return {
        projection: parse(structuredClone(cached.projection)),
        count: cached.count,
        head: cached.head,
      };
    }
    if (bytes.startsWith("SQLite format"))
      throw new Error(
        `legacy SQLite state at ${path}; preserve it and import it read-only before using a JSONL journal`,
      );
    if (bytes !== "" && !bytes.endsWith("\n"))
      throw new Error(
        `incomplete recovery journal at ${path}; preserve the file and reconcile the last operation`,
      );
    const projection = empty();
    let head = "genesis";
    let count = 0;
    for (const line of bytes.split("\n").filter(Boolean)) {
      const { hash, ...encoded } = JSON.parse(line);
      if (hash !== digestOfBytes(JSON.stringify(encoded)))
        throw new Error(`recovery journal checksum failed at ${count}: ${path}`);
      const entry = entrySchema.parse(encoded);
      if (entry.sequence !== count || entry.previousHash !== head)
        throw new Error(`recovery journal chain failed at ${count}: ${path}`);
      const held = projection as Record<string, Record<string, unknown>>;
      for (const [collection, changes] of Object.entries(entry.projection)) {
        const fields = held[collection];
        if (fields === undefined || changes === null || typeof changes !== "object")
          throw new Error(`invalid journal collection ${collection}`);
        for (const [id, value] of Object.entries(changes)) {
          if (value === null) delete fields[id];
          else fields[id] = value;
        }
      }
      head = digestOfBytes(line);
      count += 1;
    }
    if (projections.size >= 32) projections.clear();
    projections.set(path, {
      digest,
      projection: structuredClone(projection),
      count,
      head,
    });
    return { projection: parse(projection), count, head };
  };
  return {
    read: () => read().projection,
    update<Value>(operation: string, change: (projection: Projection) => Value): Value {
      const lock = `${path}.lock`;
      let descriptor: number;
      try {
        if (existsSync(lock)) {
          const owner = Number(readFileSync(lock, "utf8"));
          if (Number.isSafeInteger(owner) && owner > 0) {
            try {
              process.kill(owner, 0);
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock);
            }
          }
        }
        descriptor = openSync(lock, "wx", 0o600);
        writeFileSync(descriptor, String(process.pid));
        fsyncSync(descriptor);
      } catch {
        throw new Error(
          `recovery journal ${path} is held by another writer; retry after that operation finishes`,
        );
      }
      try {
        const current = read();
        const before = JSON.parse(JSON.stringify(current.projection)) as Record<
          string,
          Record<string, unknown>
        >;
        const value = change(current.projection);
        const projection = parse(scrubJson(JSON.parse(JSON.stringify(current.projection))).value);
        const delta: Record<string, Record<string, unknown>> = {};
        for (const [collection, fields] of Object.entries(projection)) {
          const prior = before[collection] ?? {};
          const changed: Record<string, unknown> = {};
          for (const id of new Set([...Object.keys(prior), ...Object.keys(fields)])) {
            if (JSON.stringify(prior[id]) !== JSON.stringify(fields[id]))
              changed[id] = fields[id] ?? null;
          }
          if (Object.keys(changed).length > 0) delta[collection] = changed;
        }
        const encoded = entrySchema.parse({
          sequence: current.count,
          previousHash: current.head,
          operation,
          projection: delta,
        });
        const line = JSON.stringify({ ...encoded, hash: digestOfBytes(JSON.stringify(encoded)) });
        const journal = openSync(path, "a", 0o600);
        try {
          chmodSync(path, 0o600);
          appendFileSync(journal, `${line}\n`);
          fsyncSync(journal);
        } finally {
          closeSync(journal);
        }
        if (projections.size >= 32) projections.clear();
        projections.set(path, {
          digest: digestOfBytes(readFileSync(path, "utf8")),
          projection: structuredClone(projection),
          count: current.count + 1,
          head: digestOfBytes(line),
        });
        return value;
      } finally {
        closeSync(descriptor);
        unlinkSync(lock);
      }
    },
  };
}

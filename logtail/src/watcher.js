// Tails a file by tracking the read offset and watching for changes via fs.watch.

import { open, stat, watch } from "node:fs/promises";

export async function tailFile(filePath, onLine, onError) {
  let offset = 0;
  let partial = "";
  let handle;
  let watcher;
  let stopped = false;

  try {
    const info = await stat(filePath);
    offset = info.size;
    handle = await open(filePath, "r");
  } catch (err) {
    onError(err);
    return { stop() {} };
  }

  async function readNew() {
    if (stopped || !handle) return;
    try {
      const info = await handle.stat();
      if (info.size < offset) {
        // File was truncated — reset.
        offset = 0;
        partial = "";
      }
      if (info.size === offset) return;

      const buf = Buffer.alloc(info.size - offset);
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
      offset += bytesRead;

      const text = partial + buf.toString("utf-8", 0, bytesRead);
      const lines = text.split("\n");
      partial = lines.pop(); // keep incomplete trailing line

      for (const line of lines) {
        if (line.length > 0) onLine(line);
      }
    } catch (err) {
      if (!stopped) onError(err);
    }
  }

  try {
    watcher = watch(filePath);
    (async () => {
      try {
        for await (const event of watcher) {
          if (stopped) break;
          if (event.eventType === "change") await readNew();
        }
      } catch (err) {
        if (!stopped) onError(err);
      }
    })();
  } catch (err) {
    onError(err);
  }

  return {
    async stop() {
      stopped = true;
      try { watcher?.close?.() || (watcher?.[Symbol.asyncDispose] && await watcher[Symbol.asyncDispose]()); } catch {}
      try { await handle?.close(); } catch {}
    },
  };
}

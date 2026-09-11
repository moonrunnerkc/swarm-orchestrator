import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

/** Byte ceilings apply before decoding, including a long line before the requested range. */
export async function readFileWindow(
  path: string,
  options: {
    startLine?: number | undefined;
    endLine?: number | undefined;
    maxBytes: number;
    maxScanBytes?: number;
    signal?: AbortSignal | undefined;
  },
) {
  options.signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const scanLimit = options.maxScanBytes ?? 16_000_000;
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(16_384);
    let scanned = 0;
    let captured = 0;
    let line = 1;
    let ended = false;
    let truncated = false;
    while (!ended && scanned < scanLimit) {
      options.signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, scanLimit - scanned),
      );
      if (bytesRead === 0) break;
      scanned += bytesRead;
      let offset = 0;
      while (offset < bytesRead) {
        const newline = buffer.indexOf(10, offset);
        const end = newline < 0 || newline >= bytesRead ? bytesRead : newline + 1;
        if (
          line >= (options.startLine ?? 1) &&
          line <= (options.endLine ?? Number.MAX_SAFE_INTEGER)
        ) {
          const room = options.maxBytes - captured;
          const selected = buffer.subarray(offset, Math.min(end, offset + room));
          if (selected.length > 0) chunks.push(Buffer.from(selected));
          captured += selected.length;
          if (selected.length < end - offset) {
            truncated = true;
            ended = true;
            break;
          }
        }
        if (end <= bytesRead && buffer[end - 1] === 10) line += 1;
        offset = end;
        if (line > (options.endLine ?? Number.MAX_SAFE_INTEGER)) {
          ended = true;
          break;
        }
      }
    }
    truncated ||= !ended && scanned < size;
    const decoder = new StringDecoder("utf8");
    const text = decoder.write(Buffer.concat(chunks));
    return {
      text: truncated ? text : text + decoder.end(),
      bytes: captured,
      totalBytes: size,
      scannedBytes: scanned,
      truncated,
      firstLine: options.startLine ?? 1,
      lastLine: line,
    };
  } finally {
    await file.close();
  }
}

// Output formatting: plain passthrough or JSON pretty-printing.

export function formatLine(line, { json = false } = {}) {
  if (!json) return line;

  try {
    const parsed = JSON.parse(line);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return JSON.stringify({ raw: line }, null, 2);
  }
}

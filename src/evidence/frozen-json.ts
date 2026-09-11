/** Freeze the parsed copy, so callers cannot change the meaning after its digest was computed. */
export function freezeJson<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

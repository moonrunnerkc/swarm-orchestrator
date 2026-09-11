/** Ignore late provider completions while removing the listener as soon as either side settles. */
export async function withModelCancellation<Value>(
  pending: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  let cancel: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason ?? new Error("model call cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([pending, interrupted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../service/http.ts";

async function call(method: string, path: string, key: string): Promise<number> {
  const service = startService(0);
  const { port } = service.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "x-api-key": key },
  });
  service.close();
  return response.status;
}

test("another account cannot delete the note, and its owner can", async () => {
  assert.equal(await call("DELETE", "/notes/n-1", "key-omar"), 404);
  assert.equal(await call("DELETE", "/notes/n-1", "key-lin"), 204);
  assert.equal(await call("DELETE", "/notes/n-1", "key-lin"), 404);
});

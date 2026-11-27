import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../service/http.ts";

test("an account lists its own notes", async () => {
  const service = startService(0);
  const { port } = service.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/notes`, {
    headers: { "x-api-key": "key-lin" },
  });
  service.close();
  const listed = (await response.json()) as { slug: string }[];
  assert.deepEqual(
    listed.map((one) => one.slug),
    ["n-1"],
  );
});

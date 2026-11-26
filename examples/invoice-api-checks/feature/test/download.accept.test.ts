import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { handle } from "../src/app.ts";

test("the owner downloads their invoice as JSON", async () => {
  const server = createServer(handle);
  await new Promise<void>((settle) => server.listen(0, settle));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/invoices/inv-1/download`, {
    headers: { authorization: "Bearer token-ada" },
  });
  const body = (await response.json()) as Record<string, unknown>;
  server.close();
  assert.equal(response.status, 200);
  assert.equal(body.number, "INV-2026-0001");
  assert.equal(body.totalCents, 12_900);
  assert.deepEqual(body.lines, ["Hosting, November"]);
});

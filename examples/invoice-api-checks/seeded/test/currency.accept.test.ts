import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { handle } from "../src/app.ts";

async function download(token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = createServer(handle);
  await new Promise<void>((settle) => server.listen(0, settle));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/invoices/inv-1/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as Record<string, unknown>;
  server.close();
  return { status: response.status, body };
}

test("the owner's download carries the currency", async () => {
  const { status, body } = await download("token-ada");
  assert.equal(status, 200);
  assert.equal(body.currency, "USD");
  assert.equal(body.number, "INV-2026-0001");
});

test("another customer is not served the invoice", async () => {
  const { status, body } = await download("token-grace");
  assert.ok(status === 403 || status === 404, `status ${status}`);
  assert.equal(body.number, undefined);
});

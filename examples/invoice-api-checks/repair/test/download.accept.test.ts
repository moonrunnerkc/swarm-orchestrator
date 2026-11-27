import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { handle } from "../src/app.ts";

async function download(token: string): Promise<number> {
  const server = createServer(handle);
  await new Promise<void>((settle) => server.listen(0, settle));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/invoices/inv-1/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await response.text();
  server.close();
  return response.status;
}

test("another customer gets 404 for an invoice that is not theirs", async () => {
  assert.equal(await download("token-grace"), 404);
});

test("the owner still downloads their invoice", async () => {
  assert.equal(await download("token-ada"), 200);
});

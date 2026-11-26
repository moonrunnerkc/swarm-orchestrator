import assert from "node:assert/strict";
import { test } from "node:test";
import { users } from "../src/data.ts";
import { listInvoices } from "../src/invoices.ts";

test("a customer's list holds only their own invoices", () => {
  const [ada] = users;
  assert.ok(ada);
  assert.deepEqual(
    listInvoices(ada).map((invoice) => invoice.number),
    ["INV-2026-0001"],
  );
});

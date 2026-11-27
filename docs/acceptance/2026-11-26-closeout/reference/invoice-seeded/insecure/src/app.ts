import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticate } from "./auth.ts";
import { invoices } from "./data.ts";
import { listInvoices } from "./invoices.ts";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Every request the API answers: its health, and the signed-in user's invoices. */
export function handle(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/health") {
    send(response, 200, { ok: true });
    return;
  }
  const user = authenticate(request);
  if (user === null) {
    send(response, 401, { error: "sign in with a bearer token" });
    return;
  }
  if (request.method === "GET" && path === "/invoices") {
    send(response, 200, { invoices: listInvoices(user) });
    return;
  }
  const match = /^\/invoices\/([\w-]+)\/download$/.exec(path);
  const invoice = invoices.find((one) => one.id === match?.[1]);
  if (request.method === "GET" && invoice !== undefined) {
    send(response, 200, {
      number: invoice.number,
      totalCents: invoice.totalCents,
      lines: invoice.lines,
      currency: "USD",
    });
    return;
  }
  send(response, 404, { error: "not found" });
}

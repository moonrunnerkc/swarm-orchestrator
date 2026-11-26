import { invoices, type User } from "./data.ts";

/** An invoice as the list shows it: enough to pick one, not its lines. */
export interface InvoiceSummary {
  readonly id: string;
  readonly number: string;
  readonly totalCents: number;
}

/** The invoices a user owns, in the order they were issued. */
export function listInvoices(user: User): InvoiceSummary[] {
  return invoices
    .filter((invoice) => invoice.ownerId === user.id)
    .map(({ id, number, totalCents }) => ({ id, number, totalCents }));
}

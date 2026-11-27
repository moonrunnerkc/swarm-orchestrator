/** A person who can sign in. The tokens are synthetic fixtures for this example, not secrets. */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly role: "customer" | "support";
  readonly token: string;
}

/** One invoice, owned by the customer it was issued to. */
export interface Invoice {
  readonly id: string;
  readonly ownerId: string;
  readonly number: string;
  readonly totalCents: number;
  readonly lines: readonly string[];
}

/** The seed users: two customers and one member of support. */
export const users: readonly User[] = [
  { id: "u1", name: "Ada", role: "customer", token: "token-ada" },
  { id: "u2", name: "Grace", role: "customer", token: "token-grace" },
  { id: "u3", name: "Sam", role: "support", token: "token-sam" },
];

/** The seed invoices: one for each customer. */
export const invoices: readonly Invoice[] = [
  {
    id: "inv-1",
    ownerId: "u1",
    number: "INV-2026-0001",
    totalCents: 12_900,
    lines: ["Hosting, November"],
  },
  {
    id: "inv-2",
    ownerId: "u2",
    number: "INV-2026-0002",
    totalCents: 4900,
    lines: ["Support plan"],
  },
];

import type { IncomingMessage } from "node:http";
import { type User, users } from "./data.ts";

/** The user a request's bearer token names, or null where it names none. */
export function authenticate(request: IncomingMessage): User | null {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return users.find((user) => user.token === token) ?? null;
}

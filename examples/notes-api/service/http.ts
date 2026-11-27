import { createServer, type Server } from "node:http";
import { accounts, notes } from "./store.ts";

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  run(handle: string, match: RegExpExecArray): { status: number; body: unknown };
}

const routes: readonly Route[] = [
  {
    method: "GET",
    pattern: /^\/notes$/,
    run: (handle) => ({ status: 200, body: notes.filter((note) => note.authorId === handle) }),
  },
];

/** Starts the notes service on a port; 0 takes any free one. */
export function startService(port: number): Server {
  return createServer((request, response) => {
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(status === 204 ? undefined : JSON.stringify(body));
    };
    if (request.url === "/ready") return send(200, { ready: true });
    const account = accounts.find((one) => one.key === request.headers["x-api-key"]);
    if (account === undefined) return send(401, { error: "no key" });
    for (const route of routes) {
      const match = route.pattern.exec(request.url ?? "");
      if (request.method !== route.method || match === null) continue;
      const answer = route.run(account.handle, match);
      return send(answer.status, answer.body);
    }
    send(404, { error: "no such route" });
  }).listen(port);
}

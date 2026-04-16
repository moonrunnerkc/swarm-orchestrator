// Entry point. Starts the HTTP listener on the configured host:port.

import { makeApp } from "./app.js";

const { app, config } = makeApp();

const server = app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`calculations-api listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

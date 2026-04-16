// Express application factory. Returns a configured app without starting
// the listener, so tests can import it without binding a port.

import express from "express";
import cors from "cors";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { healthRouter } from "./routes/health.js";
import { notesRouter } from "./routes/notes.js";
import { notFoundHandler, errorHandler } from "./errors.js";
import { securityHeaders } from "./security.js";

export function makeApp(overrides = {}) {
  const cfg = overrides.config ?? loadConfig();
  const store =
    overrides.store ?? createStore({ dataFile: cfg.dataFile });

  const app = express();

  app.use(securityHeaders);
  app.use(cors({ origin: cfg.corsOrigin }));
  app.use(express.json({ limit: cfg.maxBodyBytes }));

  if (cfg.logRequests) {
    app.use((req, _res, next) => {
      // eslint-disable-next-line no-console
      console.log(`${req.method} ${req.originalUrl}`);
      next();
    });
  }

  app.disable("x-powered-by");

  app.use("/health", healthRouter());
  app.use("/notes", notesRouter(store, cfg));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, config: cfg, store };
}

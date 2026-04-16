// Runtime configuration sourced from environment variables.
// All values are resolved once at import time; the result is frozen so no
// downstream code can mutate the config by accident.

import path from "node:path";

const DEFAULTS = Object.freeze({
  port: 3002,
  host: "127.0.0.1",
  dataFile: path.resolve("./data/notes.json"),
  corsOrigin: "*",
  logRequests: false,
  maxTitleLength: 200,
  maxContentLength: 10_000,
  maxBodyBytes: 64 * 1024,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
});

function parsePort(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return n;
}

function parseBool(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`expected boolean (true|false|1|0), got "${raw}"`);
}

export function loadConfig(env = process.env) {
  const corsOrigin = env.CORS_ORIGIN ?? DEFAULTS.corsOrigin;
  return Object.freeze({
    port: parsePort(env.PORT, DEFAULTS.port),
    host: env.HOST || DEFAULTS.host,
    dataFile: env.DATA_FILE
      ? path.resolve(env.DATA_FILE)
      : DEFAULTS.dataFile,
    corsOrigin: corsOrigin.includes(",")
      ? corsOrigin.split(",").map((s) => s.trim()).filter(Boolean)
      : corsOrigin,
    logRequests: parseBool(env.LOG_REQUESTS, DEFAULTS.logRequests),
    maxTitleLength: DEFAULTS.maxTitleLength,
    maxContentLength: DEFAULTS.maxContentLength,
    maxBodyBytes: DEFAULTS.maxBodyBytes,
    rateLimitWindowMs: DEFAULTS.rateLimitWindowMs,
    rateLimitMax: DEFAULTS.rateLimitMax,
  });
}

export const config = loadConfig();

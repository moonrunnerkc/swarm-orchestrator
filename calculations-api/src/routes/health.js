// Liveness probe. Returns process uptime and a monotonically increasing
// timestamp so operators can tell a stuck process from a fresh one.

import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

export function healthRouter() {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: pkg.name,
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });
  return router;
}

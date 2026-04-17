// Dev server that serves static files and proxies /api requests to notes-api.
// No dependencies beyond Node.js builtins. Usage: node dev-server.js

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEV_PORT || 5173);
const API_TARGET = process.env.API_URL || "http://127.0.0.1:3002";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Bad Request");
    return;
  }
  const filePath = path.resolve(path.join(__dirname, urlPath === "/" ? "index.html" : urlPath));

  // Prevent path traversal — resolved path must stay within the web root.
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ...SECURITY_HEADERS });
    res.end(data);
  });
}

function proxyApi(req, res) {
  const target = new URL(req.url.replace(/^\/api\/notes/, "/notes"), API_TARGET);
  const opts = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };

  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: { code: "PROXY_ERROR", message: "notes-api unreachable" } }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    proxyApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Inkwell dev server → http://localhost:${PORT}`);
  console.log(`API proxy → ${API_TARGET}/notes`);
});

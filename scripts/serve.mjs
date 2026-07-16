#!/usr/bin/env bun
// Self-hosted HTTP-Server für TanStack Start.
// 1. Serviert statische Dateien aus dist/client (Assets, Favicons, etc.)
// 2. Fällt für alles andere auf den gebauten Worker-Handler
//    (export default { fetch }) aus dist/server/server.js zurück.

import { fileURLToPath } from "node:url";
import { dirname, resolve, join, normalize, extname } from "node:path";
import { createServer } from "node:http";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const requestedBuildRoot = process.env.PORTAL_BUILD_DIR ? resolve(process.env.PORTAL_BUILD_DIR) : rootDir;
// Wichtig für Atomic-Deploys: PORTAL_BUILD_DIR zeigt auf `.current` (Symlink).
// Wenn ein Deploy den Symlink umschaltet, darf ein bereits laufender Prozess
// nicht plötzlich alte HTML-Handler mit neuen Asset-Dateien mischen.
const buildRoot = existsSync(requestedBuildRoot) ? realpathSync(requestedBuildRoot) : requestedBuildRoot;

const buildCandidates = [
  {
    handlerPath: resolve(buildRoot, "dist", "server", "index.mjs"),
    clientDir: resolve(buildRoot, "dist", "client"),
  },
  {
    handlerPath: resolve(buildRoot, "dist", "server", "server.js"),
    clientDir: resolve(buildRoot, "dist", "client"),
  },
  {
    handlerPath: resolve(buildRoot, ".output", "server", "index.mjs"),
    clientDir: resolve(buildRoot, ".output", "public"),
  },
];

const build = buildCandidates.find(
  (candidate) => existsSync(candidate.handlerPath) && existsSync(candidate.clientDir),
);

if (!build) {
  console.error(
    "[serve] Kein gebautes Portal gefunden. Bitte erst `bun run build` ausführen. Erwartet .output/server/index.mjs + .output/public oder dist/server/server.js + dist/client.",
  );
  process.exit(1);
}

const { handlerPath, clientDir } = build;

const mod = await import(handlerPath);
function findFetch(o, depth = 0) {
  if (!o || depth > 4) return null;
  if (typeof o.fetch === "function") return o;
  if (o.default) return findFetch(o.default, depth + 1);
  return null;
}
const handler = findFetch(mod);

if (!handler) {
  console.error(`[serve] ${handlerPath} exportiert kein { fetch }. Keys: ${Object.keys(mod).join(",")} | default keys: ${mod.default ? Object.keys(mod.default).join(",") : "n/a"}`);
  process.exit(1);
}


const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";
const serverContext = {
  waitUntil(promise) {
    Promise.resolve(promise).catch((err) => console.error("[serve] waitUntil rejected:", err));
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/** Versucht, eine statische Datei aus dist/client zu liefern. Gibt true zurück, wenn erledigt. */
function tryServeStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  // Path-Traversal verhindern. `pathname` beginnt immer mit `/`; wenn wir
  // diesen Slash an `join(clientDir, ...)` weitergeben, ignoriert Node den
  // `clientDir` komplett und sucht fälschlich unter `/assets/...`.
  const safePath = normalize(decoded).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(clientDir, safePath);
  if (!filePath.startsWith(clientDir)) return false;

  if (!existsSync(filePath)) return false;
  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const ext = extname(filePath).toLowerCase();
  const headers = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-length": stat.size,
  };
  // Gehashte Assets dürfen aggressiv gecacht werden
  if (decoded.startsWith("/assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else {
    headers["cache-control"] = "public, max-age=3600";
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
  } else {
    createReadStream(filePath).pipe(res);
  }
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${hostname}:${port}`}`);

    // Statische Dateien zuerst (Assets, Favicon, robots.txt, ...)
    if (tryServeStatic(req, res, url.pathname)) return;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const init = {
      method: req.method,
      headers: req.headers,
      body: hasBody ? await readBody(req) : undefined,
    };
    const response = await handler.fetch(new Request(url, init), process.env, serverContext);

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    console.error("[serve] Unhandled request error:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(port, hostname, () => {
  console.log(`[serve] Portal läuft auf http://${hostname}:${port} (Assets: ${clientDir})`);
});

// Sauberer Shutdown bei SIGTERM/SIGINT (wichtig für systemd).
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[serve] ${sig} empfangen — beende Server.`);
    server.close(() => process.exit(0));
  });
}

process.on("uncaughtException", (err) => {
  console.error("[serve] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[serve] unhandledRejection:", err);
});

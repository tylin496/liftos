import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMockSummary, isMockMode, tryHandleMockApi } from "./mock-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

const API_ROUTES = {
  "/api/auth/config": "../api/auth/config.js",
  "/api/auth/google": "../api/auth/google.js",
  "/api/auth/logout": "../api/auth/logout.js",
  "/api/auth/session": "../api/auth/session.js",
  "/api/config": "../api/config.js",
  "/api/phase": "../api/phase.js",
  "/api/save": "../api/save.js",
  "/api/delete": "../api/delete.js",
  "/api/summary": "../api/summary.js",
  "/api/entries": "../api/entries.js"
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function createVercelResponse(nodeRes) {
  const headerStore = {};

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      headerStore[name.toLowerCase()] = value;
      return this;
    },
    json(payload) {
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        ...headerStore
      };
      nodeRes.writeHead(this.statusCode || 200, headers);
      nodeRes.end(JSON.stringify(payload));
    },
    end() {
      nodeRes.writeHead(this.statusCode || 204, headerStore);
      nodeRes.end();
    }
  };

  return res;
}

async function handleLocalApi(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const routePath = url.pathname;
  const modulePath = API_ROUTES[routePath];

  if (!modulePath) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "API route not found" }));
    return;
  }

  let body = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    const raw = await readRequestBody(req);
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
    }
  }

  if (isMockMode() && tryHandleMockApi(req, res, url, body)) {
    return;
  }

  const vercelReq = {
    method: req.method,
    headers: req.headers,
    body,
    query: Object.fromEntries(url.searchParams.entries())
  };
  const vercelRes = createVercelResponse(res);
  const handler = (await import(new URL(modulePath, import.meta.url).href)).default;
  await handler(vercelReq, vercelRes);
}

function serveStatic(req, res) {
  const urlPath = req.url?.split("?")[0] || "/";
  const relativePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, path.normalize(relativePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/")) {
    handleLocalApi(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Local API error" }));
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.SESSION_SECRET);
  const devBypass = process.env.DEV_BYPASS_AUTH === "1";
  console.log(`Calorie tracker dev server: http://127.0.0.1:${PORT}/`);
  if (devBypass) {
    console.log("Auth: DEV_BYPASS_AUTH=1 (auto signed-in as dev@local on localhost)");
  } else if (hasGoogle) {
    console.log("Auth: Google Sign-In (.env.local)");
  } else {
    console.log("Warning: set GOOGLE_CLIENT_ID, SESSION_SECRET, ALLOWED_GOOGLE_EMAILS in .env.local");
  }
  if (isMockMode()) {
    const summary = getMockSummary();
    console.log(`Data: in-memory mock (${summary.entryCount} entries, ${summary.firstDate} → ${summary.lastDate})`);
    console.log("      Set NOTION_TOKEN + NOTION_DATABASE_ID in .env.local to use real Notion.");
  } else {
    console.log("Data: Notion API");
  }
});

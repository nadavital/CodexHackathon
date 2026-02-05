import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, ROOT_DIR } from "./config.js";
import { hasOpenAI } from "./openai.js";
import {
  askMemories,
  buildProjectContext,
  createMemory,
  listProjects,
  listRecentMemories,
  searchMemories,
} from "./memoryService.js";
import { taskRepo } from "./tasksDb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJsonBody(req, maxBytes = 15 * 1024 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) {
      throw new Error("Request too large");
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sanitizePath(baseDir, requestedPath) {
  const normalized = path.normalize(requestedPath).replace(/^([/\\])+/, "");
  const resolved = path.resolve(baseDir, normalized);
  if (!resolved.startsWith(baseDir)) {
    return null;
  }
  return resolved;
}

async function serveFile(res, absolutePath) {
  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(absolutePath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      openaiConfigured: hasOpenAI(),
      cwd: process.cwd(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notes") {
    const query = url.searchParams.get("query") || "";
    const project = url.searchParams.get("project") || "";
    const limit = Number(url.searchParams.get("limit") || "20");

    const results = query
      ? await searchMemories({ query, project, limit })
      : (await listRecentMemories(limit)).map((note, index) => ({
          rank: index + 1,
          score: 1,
          note,
        }));

    sendJson(res, 200, {
      items: results,
      count: results.length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/recent") {
    const limit = Number(url.searchParams.get("limit") || "20");
    const notes = await listRecentMemories(limit);
    sendJson(res, 200, { items: notes, count: notes.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = listProjects();
    sendJson(res, 200, { items: projects, count: projects.length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notes") {
    const body = await readJsonBody(req);
    const note = await createMemory({
      content: body.content,
      sourceType: body.sourceType,
      sourceUrl: body.sourceUrl,
      imageDataUrl: body.imageDataUrl,
      fileDataUrl: body.fileDataUrl,
      fileName: body.fileName,
      fileMimeType: body.fileMimeType,
      project: body.project,
      metadata: {
        createdFrom: "web-app",
      },
    });
    sendJson(res, 201, { note });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const result = await askMemories({
      question: body.question,
      project: body.project,
      limit: Number(body.limit || 6),
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/context") {
    const body = await readJsonBody(req);
    const result = await buildProjectContext({
      task: body.task,
      project: body.project,
      limit: Number(body.limit || 8),
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const status = url.searchParams.get("status") || "open";
    const tasks = taskRepo.listTasks(status);
    sendJson(res, 200, { items: tasks, count: tasks.length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readJsonBody(req);
    const task = taskRepo.createTask({
      title: body.title,
      status: body.status || "open",
    });
    sendJson(res, 201, { task });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/uploads/")) {
      const relative = url.pathname.replace(/^\/uploads\//, "");
      const absolutePath = sanitizePath(config.uploadDir, relative);
      if (!absolutePath) {
        sendText(res, 403, "Forbidden");
        return;
      }
      await serveFile(res, absolutePath);
      return;
    }

    const routePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const absolutePath = sanitizePath(PUBLIC_DIR, routePath);
    if (!absolutePath) {
      sendText(res, 403, "Forbidden");
      return;
    }

    await serveFile(res, absolutePath);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Project Memory server running on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`Using db: ${config.dbPath}`);
  if (!hasOpenAI()) {
    // eslint-disable-next-line no-console
    console.log("OPENAI_API_KEY not set. Running with heuristic enrichment/retrieval fallback.");
  }
});

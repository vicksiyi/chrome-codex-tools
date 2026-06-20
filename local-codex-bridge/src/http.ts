import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AppConfig, CodexOutput, PagePayload, ToolRunBody } from "./types.ts";
import { resolveCodexPath } from "./codex.ts";
import { loadConfig } from "./config.ts";
import { HttpError, httpError } from "./errors.ts";
import { buildSessionTitle, normalizePage } from "./prompt.ts";
import { listTools } from "./skills.ts";
import { SqliteStore } from "./store.ts";
import { handleToolRun } from "./tool-runner.ts";
import { cleanString, safeLimit } from "./utils.ts";

export function createBridgeServer(
  config = loadConfig(),
  store = new SqliteStore(config.dbPath),
  runCodexFn?: (prompt: string, codexSessionId?: string) => Promise<CodexOutput>
): Server {
  return createServer(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(isAllowedOrigin(req.headers.origin) ? 204 : 403);
      res.end();
      return;
    }

    try {
      if (!isAllowedOrigin(req.headers.origin)) {
        throw httpError(403, "Origin is not allowed");
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);
      await routeRequest(req, res, url, config, store, runCodexFn);
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : "Unexpected server error";
      writeJson(res, status, { ok: false, error: message });
    }
  });
}

export function startServer(config = loadConfig()) {
  const store = new SqliteStore(config.dbPath);
  const server = createBridgeServer(config, store);

  server.listen(config.port, config.host, () => {
    console.log(`Codex Web Assistant bridge listening on http://${config.host}:${config.port}`);
    console.log(`SQLite database: ${config.dbPath}`);
  });

  server.on("close", () => {
    store.close();
  });

  return { server, store, config };
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: AppConfig,
  store: SqliteStore,
  runCodexFn?: (prompt: string, codexSessionId?: string) => Promise<CodexOutput>
) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const codexPath = await resolveCodexPath(config);
    writeJson(res, 200, {
      ok: true,
      codexPath,
      timeoutMs: config.codexTimeoutMs,
      maxPageTextChars: config.maxPageTextChars,
      dbPath: config.dbPath,
      toolCount: listTools(config).length
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tools") {
    writeJson(res, 200, { ok: true, tools: listTools(config) });
    return;
  }

  const toolRunMatch = url.pathname.match(/^\/api\/tools\/([^/]+)\/runs$/);
  if (req.method === "POST" && toolRunMatch) {
    const toolId = decodeURIComponent(toolRunMatch[1]);
    const body = await readJsonBody<ToolRunBody>(req, config.requestLimitBytes);
    const result = await handleToolRun(toolId, body, {
      config,
      store,
      runCodex: runCodexFn
    });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runs") {
    const limit = safeLimit(url.searchParams.get("limit"), 50, 200);
    writeJson(res, 200, { ok: true, runs: store.listToolRuns(limit) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    const limit = safeLimit(url.searchParams.get("limit"), 50, 200);
    writeJson(res, 200, { ok: true, sessions: store.listSessions(limit) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJsonBody<{ title?: string; page?: Partial<PagePayload> }>(req, config.requestLimitBytes);
    const now = new Date().toISOString();
    const page = normalizePage(body.page, config.maxPageTextChars);
    const session = store.ensureSession({
      id: randomUUID(),
      title: cleanString(body.title, 160) || buildSessionTitle(page, "新对话"),
      pageTitle: page.title,
      pageUrl: page.url,
      createdAt: now
    });
    writeJson(res, 200, { ok: true, session: store.getSession(session.id) || session });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
    const session = store.getSession(id);
    if (!session) {
      throw httpError(404, "Session not found");
    }
    writeJson(res, 200, { ok: true, session });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/runs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/runs/".length));
    const run = store.getToolRun(id);
    if (!run) {
      throw httpError(404, "Tool run not found");
    }
    writeJson(res, 200, { ok: true, run });
    return;
  }

  if (url.pathname === "/api/history/prompts") {
    if (req.method === "GET") {
      const limit = safeLimit(url.searchParams.get("limit"), 50, 200);
      writeJson(res, 200, { ok: true, prompts: store.listPrompts(limit) });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody<{ instruction?: string; taskName?: string }>(req, config.requestLimitBytes);
      const instruction = cleanString(body.instruction, 3000);
      if (!instruction) {
        throw httpError(400, "Missing instruction");
      }
      store.savePrompt(instruction, cleanString(body.taskName, 80) || "自定义指令");
      writeJson(res, 200, { ok: true, prompts: store.listPrompts() });
      return;
    }

    if (req.method === "DELETE") {
      store.clearPrompts();
      writeJson(res, 200, { ok: true });
      return;
    }
  }

  writeJson(res, 404, { ok: false, error: "Not found" });
}

async function readJsonBody<T>(req: IncomingMessage, requestLimitBytes: number): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    let raw = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > requestLimitBytes) {
        reject(httpError(413, "Request body is too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      try {
        resolvePromise(raw ? JSON.parse(raw) as T : {} as T);
      } catch {
        reject(httpError(400, "Invalid JSON body"));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin || "*";
  if (!req.headers.origin || isAllowedOrigin(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "chrome-extension:" || url.protocol === "moz-extension:";
  } catch {
    return false;
  }
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

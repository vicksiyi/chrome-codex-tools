import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  InputSource,
  PromptHistoryItem,
  SessionCreateInput,
  SessionDetail,
  SessionMessage,
  SessionMessageCreateInput,
  SessionSummary,
  ToolRunCreateInput,
  ToolRunDetail,
  ToolRunFinishInput,
  ToolRunResult,
  ToolRunSummary
} from "./types.ts";
import { cleanString, normalizeInputSource, normalizeRunStatus, parseStringArray } from "./utils.ts";

export class SqliteStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instruction TEXT NOT NULL UNIQUE,
        task_name TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        codex_session_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        page_title TEXT NOT NULL,
        page_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        tool_title TEXT NOT NULL,
        input_source TEXT NOT NULL,
        page_title TEXT NOT NULL,
        page_url TEXT NOT NULL,
        selection_only INTEGER NOT NULL,
        instruction TEXT NOT NULL,
        request_json TEXT NOT NULL,
        prompt TEXT NOT NULL,
        raw_output TEXT NOT NULL DEFAULT '',
        normalized_output_json TEXT NOT NULL DEFAULT '',
        normalization_warnings_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        elapsed_ms INTEGER,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        tool_run_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        content_text TEXT NOT NULL DEFAULT '',
        output_json TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
    `);
    this.ensureColumn("tool_runs", "session_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("sessions", "codex_session_id", "TEXT NOT NULL DEFAULT ''");
  }

  close() {
    this.db.close();
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<Record<string, unknown>>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  savePrompt(instruction: string, taskName = "自定义指令", now = new Date()) {
    const text = cleanString(instruction, 3000);
    if (!text) {
      return;
    }

    const timestamp = now.toISOString();
    this.db.prepare(`
      INSERT INTO prompt_history (instruction, task_name, use_count, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(instruction) DO UPDATE SET
        task_name = excluded.task_name,
        use_count = prompt_history.use_count + 1,
        updated_at = excluded.updated_at
    `).run(text, taskName, timestamp, timestamp);
  }

  listPrompts(limit = 50): PromptHistoryItem[] {
    const rows = this.db.prepare(`
      SELECT id, instruction, task_name, use_count, created_at, updated_at
      FROM prompt_history
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      instruction: String(row.instruction || ""),
      taskName: String(row.task_name || ""),
      useCount: Number(row.use_count || 0),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || "")
    }));
  }

  clearPrompts() {
    this.db.prepare("DELETE FROM prompt_history").run();
  }

  ensureSession(input: SessionCreateInput): SessionSummary {
    const existing = this.getSessionSummary(input.id);
    if (existing) {
      this.touchSession(input.id, input.createdAt);
      return this.getSessionSummary(input.id) || existing;
    }

    this.db.prepare(`
      INSERT INTO sessions (id, title, page_title, page_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.title,
      input.pageTitle,
      input.pageUrl,
      input.createdAt,
      input.createdAt
    );

    const session = this.getSessionSummary(input.id);
    if (!session) {
      throw new Error("Failed to create session");
    }
    return session;
  }

  updateSessionCodexSessionId(id: string, codexSessionId: string) {
    const value = cleanString(codexSessionId, 120);
    if (!value) {
      return;
    }
    this.db.prepare("UPDATE sessions SET codex_session_id = ? WHERE id = ?").run(value, id);
  }

  touchSession(id: string, updatedAt: string) {
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(updatedAt, id);
  }

  listSessions(limit = 50): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.codex_session_id, s.title, s.page_title, s.page_url, s.created_at, s.updated_at,
             COUNT(m.id) AS message_count
      FROM sessions s
      LEFT JOIN session_messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(toSessionSummary);
  }

  getSessionSummary(id: string): SessionSummary | null {
    const row = this.db.prepare(`
      SELECT s.id, s.codex_session_id, s.title, s.page_title, s.page_url, s.created_at, s.updated_at,
             COUNT(m.id) AS message_count
      FROM sessions s
      LEFT JOIN session_messages m ON m.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(id) as Record<string, unknown> | undefined;

    return row ? toSessionSummary(row) : null;
  }

  getSession(id: string): SessionDetail | null {
    const summary = this.getSessionSummary(id);
    if (!summary) {
      return null;
    }

    const rows = this.db.prepare(`
      SELECT m.id, m.session_id, m.role, m.tool_run_id, m.created_at, m.content_text, m.output_json,
             r.tool_title, r.status
      FROM session_messages m
      LEFT JOIN tool_runs r ON r.id = m.tool_run_id
      WHERE m.session_id = ?
      ORDER BY m.created_at ASC, m.rowid ASC
    `).all(id) as Array<Record<string, unknown>>;

    return {
      ...summary,
      messages: rows.map(toSessionMessage)
    };
  }

  createSessionMessage(input: SessionMessageCreateInput) {
    this.db.prepare(`
      INSERT INTO session_messages (id, session_id, role, tool_run_id, created_at, content_text, output_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.sessionId,
      input.role,
      input.toolRunId,
      input.createdAt,
      input.contentText,
      input.output ? JSON.stringify(input.output, null, 2) : ""
    );
    this.touchSession(input.sessionId, input.createdAt);
  }

  createToolRun(input: ToolRunCreateInput) {
    this.db.prepare(`
      INSERT INTO tool_runs (
        id,
        session_id,
        created_at,
        tool_id,
        tool_title,
        input_source,
        page_title,
        page_url,
        selection_only,
        instruction,
        request_json,
        prompt,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')
    `).run(
      input.id,
      input.sessionId || "",
      input.createdAt,
      input.tool.id,
      input.tool.title,
      input.inputSource,
      input.page.title,
      input.page.url,
      input.page.selectionOnly ? 1 : 0,
      input.instruction,
      input.requestJson,
      input.prompt
    );
  }

  finishToolRun(id: string, input: ToolRunFinishInput) {
    this.db.prepare(`
      UPDATE tool_runs
      SET status = ?,
          elapsed_ms = ?,
          raw_output = ?,
          normalized_output_json = ?,
          normalization_warnings_json = ?,
          error = ?,
          stdout = ?,
          stderr = ?
      WHERE id = ?
    `).run(
      input.status,
      input.elapsedMs,
      input.rawOutput || "",
      input.normalizedOutput ? JSON.stringify(input.normalizedOutput, null, 2) : "",
      JSON.stringify(input.normalizationWarnings || []),
      input.error || "",
      input.stdout || "",
      input.stderr || "",
      id
    );
  }

  listToolRuns(limit = 50): ToolRunSummary[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, created_at, tool_id, tool_title, input_source, page_title, page_url,
             status, elapsed_ms, error, normalized_output_json
      FROM tool_runs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(toToolRunSummary);
  }

  getToolRun(id: string): ToolRunDetail | null {
    const row = this.db.prepare(`
      SELECT id, session_id, created_at, tool_id, tool_title, input_source, page_title, page_url,
             status, elapsed_ms, error, normalized_output_json, normalization_warnings_json,
             instruction, request_json, prompt, raw_output, stdout, stderr
      FROM tool_runs
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    return row ? toToolRunDetail(row) : null;
  }
}

export function buildToolRunDetail(input: {
  id: string;
  sessionId: string;
  createdAt: string;
  tool: ToolDefinition;
  inputSource: InputSource;
  page: PagePayload;
  instruction: string;
  requestJson: string;
  prompt: string;
  rawOutput: string;
  normalizedOutput: ToolRunResult;
  normalizationWarnings: string[];
  status: ToolRunStatus;
  elapsedMs: number;
  error: string;
  stdout: string;
  stderr: string;
}): ToolRunDetail {
  return {
    id: input.id,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    toolId: input.tool.id,
    toolTitle: input.tool.title,
    inputSource: input.inputSource,
    pageTitle: input.page.title,
    pageUrl: input.page.url,
    status: input.status,
    elapsedMs: input.elapsedMs,
    hasError: Boolean(input.error),
    cardCount: input.normalizedOutput.cards.length,
    summary: input.normalizedOutput.summary,
    instruction: input.instruction,
    requestJson: input.requestJson,
    prompt: input.prompt,
    rawOutput: input.rawOutput,
    normalizedOutput: input.normalizedOutput,
    normalizedOutputJson: JSON.stringify(input.normalizedOutput, null, 2),
    normalizationWarnings: input.normalizationWarnings,
    error: input.error,
    stdout: input.stdout,
    stderr: input.stderr
  };
}

function toToolRunSummary(row: Record<string, unknown>): ToolRunSummary {
  const normalizedOutput = parseStoredResult(row.normalized_output_json);
  const error = String(row.error || "");

  return {
    id: String(row.id || ""),
    sessionId: String(row.session_id || ""),
    createdAt: String(row.created_at || ""),
    toolId: String(row.tool_id || ""),
    toolTitle: String(row.tool_title || ""),
    inputSource: normalizeInputSource(row.input_source),
    pageTitle: String(row.page_title || ""),
    pageUrl: String(row.page_url || ""),
    status: normalizeRunStatus(row.status),
    elapsedMs: row.elapsed_ms === null || row.elapsed_ms === undefined ? null : Number(row.elapsed_ms),
    hasError: Boolean(error),
    cardCount: normalizedOutput.cards.length,
    summary: normalizedOutput.summary
  };
}

function toToolRunDetail(row: Record<string, unknown>): ToolRunDetail {
  const summary = toToolRunSummary(row);
  const normalizedOutput = parseStoredResult(row.normalized_output_json);
  const warnings = parseStringArray(row.normalization_warnings_json);

  return {
    ...summary,
    instruction: String(row.instruction || ""),
    requestJson: String(row.request_json || ""),
    prompt: String(row.prompt || ""),
    rawOutput: String(row.raw_output || ""),
    normalizedOutput,
    normalizedOutputJson: JSON.stringify(normalizedOutput, null, 2),
    normalizationWarnings: warnings,
    error: String(row.error || ""),
    stdout: String(row.stdout || ""),
    stderr: String(row.stderr || "")
  };
}

function toSessionSummary(row: Record<string, unknown>): SessionSummary {
  return {
    id: String(row.id || ""),
    codexSessionId: String(row.codex_session_id || ""),
    title: String(row.title || ""),
    pageTitle: String(row.page_title || ""),
    pageUrl: String(row.page_url || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    messageCount: Number(row.message_count || 0)
  };
}

function toSessionMessage(row: Record<string, unknown>): SessionMessage {
  const role = row.role === "assistant" ? "assistant" : "user";
  const parsedOutput = parseStoredResult(row.output_json);
  const output = parsedOutput.title || parsedOutput.summary || parsedOutput.cards.length ? parsedOutput : null;

  return {
    id: String(row.id || ""),
    sessionId: String(row.session_id || ""),
    role,
    toolRunId: String(row.tool_run_id || ""),
    toolTitle: String(row.tool_title || ""),
    status: row.status ? normalizeRunStatus(row.status) : "",
    createdAt: String(row.created_at || ""),
    contentText: String(row.content_text || ""),
    output
  };
}

function parseStoredResult(value: unknown): ToolRunResult {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Stored result is not an object");
    }
    const cards = Array.isArray(parsed.cards) ? parsed.cards as ToolResultCard[] : [];
    return {
      title: cleanString(parsed.title, 160),
      summary: cleanString(parsed.summary, 1000),
      cards,
      rawText: cleanString(parsed.rawText, 2_000_000)
    };
  } catch {
    return {
      title: "",
      summary: "",
      cards: []
    };
  }
}

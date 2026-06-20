import { randomUUID } from "node:crypto";
import type { AppConfig, CodexOutput, InputSource, ToolRunBody, ToolRunResponse } from "./types.ts";
import { runCodexCommand } from "./codex.ts";
import { loadConfig } from "./config.ts";
import { httpError } from "./errors.ts";
import { emptyToolRunResult, normalizeToolOutput, parseCodexOutput } from "./output.ts";
import { buildSessionHistoryText, buildSessionTitle, buildToolPrompt, buildUserMessageText, normalizePage } from "./prompt.ts";
import { getToolDefinition } from "./skills.ts";
import { buildToolRunDetail, SqliteStore } from "./store.ts";
import { cleanString } from "./utils.ts";

export interface TaskContext {
  config?: AppConfig;
  store?: SqliteStore;
  runCodex?: (prompt: string, codexSessionId?: string) => Promise<CodexOutput>;
  now?: () => Date;
}

export async function handleToolRun(
  toolId: string,
  body: ToolRunBody,
  context: TaskContext = {}
): Promise<ToolRunResponse> {
  const config = context.config || loadConfig();
  const store = context.store;
  const now = context.now || (() => new Date());
  const tool = getToolDefinition(toolId, config);
  if (!tool) {
    throw httpError(404, `Unknown tool: ${toolId}`);
  }

  const page = normalizePage(body?.page, config.maxPageTextChars);
  const inputSource: InputSource = page.selectionOnly ? "selection" : "page";
  const sessionId = cleanString(body?.sessionId, 120) || randomUUID();
  const existingSession = store?.getSession(sessionId) || null;
  const codexSessionId = cleanString(existingSession?.codexSessionId, 120);
  const customInstruction = cleanString(body?.instruction, 3000);
  const instruction = tool.requiresInstruction ? customInstruction : tool.instruction;

  if (!page.text) {
    throw httpError(400, "Missing page text");
  }
  if (tool.requiresInstruction && !customInstruction) {
    throw httpError(400, "Missing custom instruction");
  }

  const runId = randomUUID();
  const createdAt = now().toISOString();
  const sessionTitle = buildSessionTitle(page, tool.title);
  const requestJson = JSON.stringify({
    toolId: tool.id,
    sessionId,
    codexSessionId,
    inputSource,
    instruction: customInstruction,
    page
  }, null, 2);
  const prompt = buildToolPrompt({
    tool,
    instruction,
    page,
    inputSource,
    sessionHistory: codexSessionId ? "" : buildSessionHistoryText(existingSession)
  });

  store?.ensureSession({
    id: sessionId,
    title: sessionTitle,
    pageTitle: page.title,
    pageUrl: page.url,
    createdAt
  });
  if (tool.requiresInstruction) {
    store?.savePrompt(customInstruction, tool.title, new Date(createdAt));
  }
  store?.createToolRun({
    id: runId,
    sessionId,
    createdAt,
    tool,
    inputSource,
    instruction: tool.requiresInstruction ? customInstruction : "",
    page,
    prompt,
    requestJson
  });
  store?.createSessionMessage({
    id: randomUUID(),
    sessionId,
    role: "user",
    toolRunId: runId,
    createdAt,
    contentText: buildUserMessageText(tool, customInstruction, inputSource)
  });

  const startedAt = Date.now();
  const runCodex = context.runCodex || ((input: string, resumeId?: string) => runCodexCommand(input, config, resumeId));

  try {
    const { stdout, stderr, lastMessage, codexSessionId: returnedCodexSessionId } = await runCodex(
      prompt,
      codexSessionId || undefined
    );
    const elapsedMs = Date.now() - startedAt;
    const rawOutput = lastMessage.trim() || parseCodexOutput(stdout);
    if (returnedCodexSessionId && returnedCodexSessionId !== codexSessionId) {
      store?.updateSessionCodexSessionId(sessionId, returnedCodexSessionId);
    }
    const normalized = normalizeToolOutput(rawOutput, tool);
    const status: ToolRunStatus = normalized.warnings.length ? "success_with_warnings" : "success";

    store?.finishToolRun(runId, {
      status,
      elapsedMs,
      rawOutput,
      normalizedOutput: normalized.result,
      normalizationWarnings: normalized.warnings,
      stdout,
      stderr
    });
    store?.createSessionMessage({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      toolRunId: runId,
      createdAt: new Date(Date.now()).toISOString(),
      contentText: normalized.result.summary || normalized.result.title || tool.title,
      output: normalized.result
    });

    return {
      ok: true,
      run: buildToolRunDetail({
        id: runId,
        sessionId,
        createdAt,
        tool,
        inputSource,
        page,
        instruction: tool.requiresInstruction ? customInstruction : "",
        requestJson,
        prompt,
        rawOutput,
        normalizedOutput: normalized.result,
        normalizationWarnings: normalized.warnings,
        status,
        elapsedMs,
        error: "",
        stdout,
        stderr
      }),
      session: store?.getSession(sessionId) || undefined
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Unexpected Codex error";
    const normalizedOutput = emptyToolRunResult(tool, "Codex 执行失败。");

    store?.finishToolRun(runId, {
      status: "failed",
      elapsedMs,
      normalizedOutput,
      normalizationWarnings: [],
      error: message
    });
    store?.createSessionMessage({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      toolRunId: runId,
      createdAt: new Date(Date.now()).toISOString(),
      contentText: message,
      output: normalizedOutput
    });

    return {
      ok: true,
      run: buildToolRunDetail({
        id: runId,
        sessionId,
        createdAt,
        tool,
        inputSource,
        page,
        instruction: tool.requiresInstruction ? customInstruction : "",
        requestJson,
        prompt,
        rawOutput: "",
        normalizedOutput,
        normalizationWarnings: [],
        status: "failed",
        elapsedMs,
        error: message,
        stdout: "",
        stderr: ""
      }),
      session: store?.getSession(sessionId) || undefined
    };
  }
}

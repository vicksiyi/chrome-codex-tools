import type { CardRenderType, ToolDefinition, ToolResultCard, ToolRunResult } from "./types.ts";
import { cleanString, isRecord, readProperty, stringifyForDisplay, stripAnsi } from "./utils.ts";

const CARD_RENDER_TYPES = new Set(["markdown", "code", "html", "table", "kv"]);

export function normalizeToolOutput(rawOutput: string, tool: ToolDefinition) {
  const rawText = cleanString(rawOutput, 2_000_000);
  const warnings: string[] = [];
  const parsed = parseJsonObject(rawText);

  if (!parsed.ok) {
    warnings.push(parsed.error);
    return {
      result: {
        ...emptyToolRunResult(tool, "Codex 返回了非结构化结果，已降级为 Markdown 卡片。"),
        rawText,
        cards: [createMarkdownCard("原始输出", rawText || "Codex 没有返回可展示内容。")]
      },
      warnings
    };
  }

  const value = parsed.value;
  const title = cleanString(readProperty(value, "title"), 160) || tool.title;
  const summary = cleanString(readProperty(value, "summary"), 1000);
  const rawCards = Array.isArray(readProperty(value, "cards")) ? readProperty(value, "cards") as unknown[] : [];

  if (!rawCards.length) {
    warnings.push("Structured output did not include cards[].");
  }

  const cards = rawCards
    .map((card, index) => normalizeCard(card, index, tool, warnings))
    .filter((card): card is ToolResultCard => Boolean(card));

  if (!cards.length) {
    warnings.push("No valid cards were found; downgraded to a markdown card.");
    cards.push(createMarkdownCard("原始输出", rawText || JSON.stringify(value, null, 2)));
  }

  return {
    result: {
      title,
      summary,
      cards,
      rawText
    },
    warnings
  };
}

export function parseCodexOutput(stdout: string) {
  const text = stripAnsi(stdout).trim();
  if (!text) {
    return "";
  }

  const markers = [
    "Final answer:",
    "final answer:",
    "Final:",
    "Assistant:"
  ];

  for (const marker of markers) {
    const index = text.lastIndexOf(marker);
    if (index !== -1) {
      return text.slice(index + marker.length).trim();
    }
  }

  return text;
}

function normalizeCard(
  value: unknown,
  index: number,
  tool: ToolDefinition,
  warnings: string[]
): ToolResultCard | null {
  if (!isRecord(value)) {
    warnings.push(`Card ${index + 1} is not an object.`);
    return null;
  }

  const requestedType = cleanString(value.renderType || value.type, 40) as CardRenderType;
  const renderType = CARD_RENDER_TYPES.has(requestedType) ? requestedType : "markdown";
  if (renderType !== requestedType) {
    warnings.push(`Card ${index + 1} used an unsupported renderType and was downgraded to markdown.`);
  }

  const title = cleanString(value.title, 160) || `结果 ${index + 1}`;
  const id = cleanString(value.id, 120) || `${renderType}-${index + 1}`;
  const content = isRecord(value.content) ? value.content : {};

  if (renderType === "markdown") {
    return {
      id,
      title,
      renderType,
      content: {
        markdown: cleanString(content.markdown ?? value.markdown ?? value.text ?? value.content, 2_000_000)
          || stringifyForDisplay(value)
      }
    };
  }

  if (renderType === "code") {
    const code = cleanString(content.code ?? value.code ?? content.html ?? value.html ?? value.content, 2_000_000);
    if (!code) {
      warnings.push(`Code card ${index + 1} did not include code.`);
      return null;
    }
    return {
      id,
      title,
      renderType,
      content: {
        language: cleanString(content.language ?? value.language, 80) || (content.html || value.html ? "html" : "text"),
        code
      }
    };
  }

  if (renderType === "html") {
    const html = cleanString(content.html ?? value.html ?? content.code ?? value.content, 2_000_000);
    if (!html) {
      warnings.push(`HTML card ${index + 1} did not include html.`);
      return null;
    }
    return {
      id,
      title,
      renderType,
      allowPreview: Boolean(tool.safety.allowHtmlPreview && value.allowPreview === true),
      content: { html }
    };
  }

  if (renderType === "table") {
    const table = normalizeTableContent(content, value);
    if (!table) {
      warnings.push(`Table card ${index + 1} did not include usable rows.`);
      return null;
    }
    return {
      id,
      title,
      renderType,
      content: table
    };
  }

  if (renderType === "kv") {
    const kv = normalizeKvContent(content, value);
    if (!kv) {
      warnings.push(`KV card ${index + 1} did not include usable items.`);
      return null;
    }
    return {
      id,
      title,
      renderType,
      content: kv
    };
  }

  return null;
}

function normalizeTableContent(content: Record<string, unknown>, value: Record<string, unknown>) {
  const sourceColumns = Array.isArray(content.columns) ? content.columns : value.columns;
  const sourceRows = Array.isArray(content.rows) ? content.rows : value.rows;
  const rows = Array.isArray(sourceRows) ? sourceRows : [];

  if (!rows.length) {
    return null;
  }

  let columns = Array.isArray(sourceColumns)
    ? sourceColumns.map((column) => cleanString(column, 160)).filter(Boolean)
    : [];

  if (rows.every(isRecord)) {
    if (!columns.length) {
      columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row as Record<string, unknown>))));
    }
    return {
      columns,
      rows: rows.map((row) => columns.map((column) => cleanString((row as Record<string, unknown>)[column], 4000)))
    };
  }

  const arrayRows = rows
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).map((cell) => cleanString(cell, 4000)));

  if (!arrayRows.length) {
    return null;
  }
  if (!columns.length) {
    columns = arrayRows[0].map((_, index) => `列 ${index + 1}`);
  }

  return {
    columns,
    rows: arrayRows
  };
}

function normalizeKvContent(content: Record<string, unknown>, value: Record<string, unknown>) {
  const rawItems = Array.isArray(content.items) ? content.items : value.items;

  if (Array.isArray(rawItems)) {
    const items = rawItems
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const key = cleanString(item.key ?? item.name ?? item.label, 160);
        const itemValue = cleanString(item.value ?? item.text, 4000);
        return key || itemValue ? { key: key || "值", value: itemValue } : null;
      })
      .filter((item): item is { key: string; value: string } => Boolean(item));
    return items.length ? { items } : null;
  }

  if (isRecord(content.items)) {
    const items = Object.entries(content.items)
      .map(([key, itemValue]) => ({
        key: cleanString(key, 160),
        value: cleanString(itemValue, 4000)
      }))
      .filter((item) => item.key || item.value);
    return items.length ? { items } : null;
  }

  return null;
}

export function createMarkdownCard(title: string, markdown: string): ToolResultCard {
  return {
    id: "markdown-1",
    title,
    renderType: "markdown",
    content: { markdown }
  };
}

export function emptyToolRunResult(tool: ToolDefinition, summary = ""): ToolRunResult {
  return {
    title: tool.title,
    summary,
    cards: []
  };
}

export function extractCodexSessionId(output: string) {
  for (const line of String(output || "").split(/\n+/)) {
    const text = line.trim();
    const plainMatch = text.match(/^session id:\s*([a-zA-Z0-9:_-]+)/i);
    if (plainMatch?.[1]) {
      return cleanString(plainMatch[1], 120);
    }

    if (!text.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(text) as Record<string, unknown>;
      const payload = isRecord(event.payload) ? event.payload : {};
      const direct = cleanString(event.session_id ?? event.sessionId ?? event.id, 120);
      const nested = cleanString(payload.id ?? payload.session_id ?? payload.sessionId, 120);
      const threadId = cleanString(event.thread_id ?? event.threadId, 120);

      if (event.type === "session_meta" && nested) {
        return nested;
      }
      if (threadId && String(event.type || "").includes("thread")) {
        return threadId;
      }
      if (nested && String(event.type || "").includes("session")) {
        return nested;
      }
      if (direct && String(event.type || "").includes("session")) {
        return direct;
      }
    } catch {
      // Ignore non-event stdout lines.
    }
  }

  return "";
}

function parseJsonObject(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidates = extractJsonCandidates(text);
  if (!candidates.length) {
    return { ok: false, error: "Codex output did not contain a JSON object." };
  }

  let firstError = "";
  const parsedCandidates: Array<{ value: unknown; score: number; index: number }> = [];
  for (const jsonText of candidates) {
    try {
      const value = JSON.parse(jsonText);
      parsedCandidates.push({
        value,
        score: scoreToolResultCandidate(value),
        index: parsedCandidates.length
      });
    } catch (error) {
      firstError ||= error instanceof Error ? error.message : "Invalid JSON";
    }
  }

  if (parsedCandidates.length) {
    parsedCandidates.sort((left, right) => right.score - left.score || left.index - right.index);
    return { ok: true, value: parsedCandidates[0].value };
  }

  return { ok: false, error: `Failed to parse Codex JSON output: ${firstError || "Invalid JSON"}` };
}

function scoreToolResultCandidate(value: unknown) {
  if (!isRecord(value)) {
    return 0;
  }

  let score = 10;
  const cards = readProperty(value, "cards");
  if (Array.isArray(cards)) {
    score += 1000 + cards.length * 10;
    for (const card of cards) {
      if (!isRecord(card)) {
        continue;
      }
      if (CARD_RENDER_TYPES.has(cleanString(card.renderType || card.type, 40))) {
        score += 5;
      }
      if (cleanString(card.title, 160)) {
        score += 2;
      }
      if (isRecord(card.content)) {
        score += 2;
      }
    }
  }
  if (cleanString(readProperty(value, "title"), 160)) {
    score += 50;
  }
  if (cleanString(readProperty(value, "summary"), 1000)) {
    score += 20;
  }
  if (cleanString(readProperty(value, "type"), 120).includes("session")) {
    score -= 100;
  }

  return score;
}

function extractJsonCandidates(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const value = candidate.trim();
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    addCandidate(match[1]);
  }

  addCandidate(trimmed);
  for (const candidate of [...candidates]) {
    for (const jsonText of extractBalancedJsonObjects(candidate)) {
      addCandidate(jsonText);
    }
  }

  return candidates.filter((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));
}

function extractBalancedJsonObjects(text: string) {
  const candidates: string[] = [];
  const source = String(text || "");

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "{") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let cursor = index; cursor < source.length; cursor += 1) {
      const char = source[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(source.slice(index, cursor + 1));
          break;
        }
      }
    }
  }

  return candidates;
}

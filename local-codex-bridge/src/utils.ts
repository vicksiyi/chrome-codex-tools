import type { InputSource, ToolRunStatus } from "./types.ts";

export function cleanString(value: unknown, maxLength: number) {
  const text = String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function readProperty(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringifyForDisplay(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function stripAnsi(value: string) {
  return String(value || "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function safeLimit(value: string | null, fallback: number, max: number) {
  const limit = Number.parseInt(value || "", 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(limit, max);
}

export function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function normalizeRunStatus(value: unknown): ToolRunStatus {
  return value === "running" || value === "success_with_warnings" || value === "failed" ? value : "success";
}

export function normalizeInputSource(value: unknown): InputSource {
  return value === "selection" || value === "manual" ? value : "page";
}

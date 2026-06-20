import { homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, "../..");
export const BUILTIN_SKILLS_DIR = join(ROOT_DIR, "local-codex-bridge", "skills");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.CODEX_WEB_ASSISTANT_HOST || "127.0.0.1",
    port: Number.parseInt(env.CODEX_WEB_ASSISTANT_PORT || "8787", 10),
    requestLimitBytes: Number.parseInt(env.CODEX_WEB_ASSISTANT_MAX_BODY || "900000", 10),
    codexTimeoutMs: Number.parseInt(env.CODEX_WEB_ASSISTANT_TIMEOUT_MS || "180000", 10),
    maxPageTextChars: Number.parseInt(env.CODEX_WEB_ASSISTANT_MAX_TEXT || "60000", 10),
    rootDir: ROOT_DIR,
    dbPath: env.CODEX_WEB_ASSISTANT_DB_PATH || defaultDbPath(),
    fallbackCodexPaths: [
      env.CODEX_BIN,
      "/Applications/Codex.app/Contents/Resources/codex",
      "codex"
    ].filter(Boolean) as string[],
    skillDirs: [
      BUILTIN_SKILLS_DIR,
      ...String(env.CODEX_WEB_ASSISTANT_SKILL_DIRS || "")
        .split(delimiter)
        .map((item) => item.trim())
        .filter(Boolean)
    ]
  };
}

export function defaultDbPath() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "chrome-codex-tools", "history.sqlite");
  }

  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "chrome-codex-tools",
    "history.sqlite"
  );
}

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfig, CodexOutput } from "./types.ts";
import { loadConfig } from "./config.ts";
import { httpError } from "./errors.ts";
import { extractCodexSessionId } from "./output.ts";

export async function runCodexCommand(
  prompt: string,
  config = loadConfig(),
  codexSessionId = ""
): Promise<CodexOutput> {
  const codexPath = await resolveCodexPath(config);
  const outputPath = join(tmpdir(), `codex-web-assistant-${randomUUID()}.txt`);
  const args = codexSessionId
    ? [
      "exec",
      "resume",
      "--json",
      "--output-last-message",
      outputPath,
      codexSessionId,
      "-"
    ]
    : [
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "--output-last-message",
      outputPath,
      "--cd",
      config.rootDir,
      "-"
    ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(codexPath, args, {
      cwd: config.rootDir,
      env: {
        ...process.env,
        NO_COLOR: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(httpError(504, `Codex timed out after ${config.codexTimeoutMs}ms`));
    }, config.codexTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(httpError(500, `Failed to start Codex: ${error.message}`));
    });

    child.on("close", async (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        await unlink(outputPath).catch(() => {});
        reject(httpError(502, stderr.trim() || stdout.trim() || `Codex exited with code ${code}`));
        return;
      }

      const lastMessage = await readFile(outputPath, "utf8").catch(() => "");
      await unlink(outputPath).catch(() => {});
      resolvePromise({
        stdout,
        stderr,
        lastMessage,
        codexSessionId: extractCodexSessionId(`${stdout}\n${stderr}`) || codexSessionId
      });
    });

    child.stdin.end(prompt);
  });
}

export async function resolveCodexPath(config = loadConfig()) {
  for (const candidate of config.fallbackCodexPaths) {
    if (candidate === "codex") {
      return candidate;
    }
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  throw httpError(500, "Codex CLI not found. Set CODEX_BIN to the codex executable path.");
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig, InputSource, ToolDefinition, ToolResultCard, ToolSource } from "./types.ts";
import { loadConfig } from "./config.ts";
import { cleanString } from "./utils.ts";

const BUILT_IN_TOOL_ORDER = [
  "summarize",
  "translate",
  "keypoints",
  "qa",
  "extract_code_snippets",
  "make_html_snippet",
  "custom_prompt"
];

const DEFAULT_SAFETY = {
  allowHtmlPreview: false,
  requiresNetwork: false,
  requiresFilesystem: false
};

export const BUILT_IN_TOOLS = loadToolDefinitions(loadConfig()).filter((tool) => tool.source === "built-in");

export function listTools(config = loadConfig()) {
  return loadToolDefinitions(config).map(publicToolDefinition);
}

export function getToolDefinition(id: string, config = loadConfig()) {
  return loadToolDefinitions(config).find((tool) => tool.id === id) || null;
}

export function loadToolDefinitions(config = loadConfig()): ToolDefinition[] {
  const tools = config.skillDirs.flatMap((dir, index) => loadSkillDirectory(dir, index === 0 ? "built-in" : "custom"));
  return tools.sort((left, right) => toolOrder(left) - toolOrder(right) || left.title.localeCompare(right.title, "zh-CN"));
}

function toolOrder(tool: ToolDefinition) {
  const index = BUILT_IN_TOOL_ORDER.indexOf(tool.id);
  return index === -1 ? 10_000 : index;
}

function loadSkillDirectory(dir: string, source: ToolSource): ToolDefinition[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files = discoverSkillFiles(dir);
  return files.map((file) => parseSkillFile(file, source)).filter((tool): tool is ToolDefinition => Boolean(tool));
}

function discoverSkillFiles(dir: string): string[] {
  if (basename(dir) === "SKILL.md" && existsSync(dir)) {
    return [dir];
  }

  const direct = join(dir, "SKILL.md");
  if (existsSync(direct)) {
    return [direct];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry, "SKILL.md"))
    .filter((file) => existsSync(file) && statSync(file).isFile());
}

function parseSkillFile(skillPath: string, source: ToolSource): ToolDefinition | null {
  const raw = readFileSync(skillPath, "utf8");
  const parsed = parseFrontmatter(raw);
  const id = cleanString(parsed.meta.id || basename(join(skillPath, "..")), 80);
  const title = cleanString(parsed.meta.title || parsed.meta.name || id, 120);
  const skillContent = cleanString(parsed.body, 20_000);
  if (!id || !title || !skillContent) {
    return null;
  }

  return {
    id,
    title,
    icon: cleanString(parsed.meta.icon, 16) || title.slice(0, 1),
    description: cleanString(parsed.meta.description, 280) || title,
    inputModes: parseList(parsed.meta.inputModes).filter(isInputSource),
    instruction: cleanString(parsed.meta.instruction, 3000) || skillContent,
    preferredRenderTypes: parseList(parsed.meta.preferredRenderTypes).filter(isRenderType),
    requiresInstruction: parseBoolean(parsed.meta.requiresInstruction),
    safety: {
      ...DEFAULT_SAFETY,
      allowHtmlPreview: parseBoolean(parsed.meta.allowHtmlPreview),
      requiresNetwork: parseBoolean(parsed.meta.requiresNetwork),
      requiresFilesystem: parseBoolean(parsed.meta.requiresFilesystem)
    },
    skillContent,
    skillPath,
    source
  };
}

function parseFrontmatter(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {} as Record<string, string>, body: raw.trim() };
  }

  const meta: Record<string, string> = {};
  match[1].split(/\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return;
    }
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  });

  return { meta, body: match[2].trim() };
}

function parseList(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string) {
  return value === "true" || value === "1" || value === "yes";
}

function isInputSource(value: string): value is InputSource {
  return value === "selection" || value === "page" || value === "manual";
}

function isRenderType(value: string): value is ToolResultCard["renderType"] {
  return value === "markdown" || value === "code" || value === "html" || value === "table" || value === "kv";
}

function publicToolDefinition(tool: ToolDefinition) {
  return {
    id: tool.id,
    title: tool.title,
    icon: tool.icon,
    description: tool.description,
    inputModes: tool.inputModes,
    preferredRenderTypes: tool.preferredRenderTypes,
    requiresInstruction: Boolean(tool.requiresInstruction),
    safety: tool.safety,
    source: tool.source
  };
}

export interface AppConfig {
  host: string;
  port: number;
  requestLimitBytes: number;
  codexTimeoutMs: number;
  maxPageTextChars: number;
  rootDir: string;
  dbPath: string;
  fallbackCodexPaths: string[];
  skillDirs: string[];
}

export interface PagePayload {
  title: string;
  url: string;
  lang: string;
  description: string;
  headings: string[];
  selectionOnly: boolean;
  text: string;
}

export type InputSource = "page" | "selection" | "manual";
export type CardRenderType = "markdown" | "code" | "html" | "table" | "kv";
export type ToolRunStatus = "running" | "success" | "success_with_warnings" | "failed";
export type ToolSource = "built-in" | "custom";

export interface ToolDefinition {
  id: string;
  title: string;
  icon: string;
  description: string;
  inputModes: InputSource[];
  instruction: string;
  preferredRenderTypes: CardRenderType[];
  requiresInstruction?: boolean;
  safety: {
    allowHtmlPreview: boolean;
    requiresNetwork: boolean;
    requiresFilesystem: boolean;
  };
  skillContent: string;
  skillPath: string;
  source: ToolSource;
}

export interface ToolResultCard {
  id: string;
  title: string;
  renderType: CardRenderType;
  content: Record<string, unknown>;
  allowPreview?: boolean;
}

export interface ToolRunResult {
  title: string;
  summary: string;
  cards: ToolResultCard[];
  rawText?: string;
}

export interface ToolRunBody {
  instruction?: string;
  sessionId?: string;
  page?: Partial<PagePayload>;
}

export interface CodexOutput {
  stdout: string;
  stderr: string;
  lastMessage: string;
  codexSessionId?: string;
}

export interface PromptHistoryItem {
  id: number;
  instruction: string;
  taskName: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRunSummary {
  id: string;
  sessionId: string;
  createdAt: string;
  toolId: string;
  toolTitle: string;
  inputSource: InputSource;
  pageTitle: string;
  pageUrl: string;
  status: ToolRunStatus;
  elapsedMs: number | null;
  hasError: boolean;
  cardCount: number;
  summary: string;
}

export interface ToolRunDetail extends ToolRunSummary {
  instruction: string;
  requestJson: string;
  prompt: string;
  rawOutput: string;
  normalizedOutput: ToolRunResult;
  normalizedOutputJson: string;
  normalizationWarnings: string[];
  error: string;
  stdout: string;
  stderr: string;
}

export interface ToolRunResponse {
  ok: true;
  run: ToolRunDetail;
  session?: SessionDetail;
}

export type SessionMessageRole = "user" | "assistant";

export interface SessionSummary {
  id: string;
  codexSessionId: string;
  title: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  toolRunId: string;
  toolTitle: string;
  status: ToolRunStatus | "";
  createdAt: string;
  contentText: string;
  output: ToolRunResult | null;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
}

export interface ToolRunCreateInput {
  id: string;
  sessionId: string;
  createdAt: string;
  tool: ToolDefinition;
  inputSource: InputSource;
  instruction: string;
  page: PagePayload;
  prompt: string;
  requestJson: string;
}

export interface ToolRunFinishInput {
  status: ToolRunStatus;
  elapsedMs: number;
  rawOutput?: string;
  normalizedOutput?: ToolRunResult;
  normalizationWarnings?: string[];
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface SessionCreateInput {
  id: string;
  codexSessionId?: string;
  title: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: string;
}

export interface SessionMessageCreateInput {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  toolRunId: string;
  createdAt: string;
  contentText: string;
  output?: ToolRunResult | null;
}

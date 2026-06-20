import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteStore,
  buildToolPrompt,
  createBridgeServer,
  extractCodexSessionId,
  getToolDefinition,
  handleToolRun,
  listTools,
  loadConfig,
  normalizePage,
  normalizeToolOutput,
  parseCodexOutput
} from "../local-codex-bridge/server.ts";

const baseConfig = {
  ...loadConfig({}),
  host: "127.0.0.1",
  port: 0,
  dbPath: ":memory:",
  codexTimeoutMs: 1000,
  maxPageTextChars: 20,
  requestLimitBytes: 100000,
  fallbackCodexPaths: ["codex"]
};

test("normalizePage trims and truncates page fields", () => {
  const page = normalizePage({
    title: "  Example  ",
    url: "https://example.com",
    headings: [" A ", "", "B"],
    text: "abcdefghijklmnopqrstuvwxyz"
  }, 8);

  assert.equal(page.title, "Example");
  assert.deepEqual(page.headings, ["A", "B"]);
  assert.equal(page.text, "abcdefgh");
});

test("listTools exposes the first batch of built-in tools", () => {
  const ids = listTools().map((tool) => tool.id);

  assert.deepEqual(ids, [
    "summarize",
    "translate",
    "keypoints",
    "qa",
    "extract_code_snippets",
    "make_html_snippet",
    "custom_prompt"
  ]);
  assert.equal(listTools().find((tool) => tool.id === "custom_prompt")?.requiresInstruction, true);
});

test("tool registry loads built-in tools from SKILL files", () => {
  const tool = getToolDefinition("summarize");
  assert.ok(tool);

  assert.equal(tool.source, "built-in");
  assert.match(tool.skillPath, /local-codex-bridge\/skills\/summarize\/SKILL\.md$/);
  assert.match(tool.skillContent, /# AI 阅读/);
});

test("tool registry can load custom SKILL directories", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "codex-web-assistant-skills-"));
  test.after(() => rm(skillsDir, { recursive: true, force: true }));
  const skillDir = join(skillsDir, "domain_review");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "---",
    "id: domain_review",
    "title: 领域审阅",
    "icon: DR",
    "description: 用自定义领域规则审阅网页。",
    "inputModes: selection,page",
    "preferredRenderTypes: markdown,table",
    "allowHtmlPreview: false",
    "---",
    "# 领域审阅",
    "",
    "请按团队自定义领域规则审阅网页内容。"
  ].join("\n"));

  const customConfig = {
    ...baseConfig,
    skillDirs: [...baseConfig.skillDirs, skillsDir]
  };

  const publicTool = listTools(customConfig).find((tool) => tool.id === "domain_review");
  const tool = getToolDefinition("domain_review", customConfig);

  assert.ok(publicTool);
  assert.equal(publicTool.source, "custom");
  assert.ok(tool);
  assert.equal(tool.source, "custom");
  assert.match(tool.skillContent, /团队自定义领域规则/);
});

test("buildToolPrompt includes the tool protocol and current page metadata", () => {
  const tool = getToolDefinition("summarize");
  assert.ok(tool);

  const prompt = buildToolPrompt({
    tool,
    instruction: tool.instruction,
    inputSource: "page",
    page: normalizePage({
      title: "Page Title",
      url: "https://example.com/article",
      headings: ["Intro"],
      text: "Body text"
    })
  });

  assert.match(prompt, /输出必须是一个 JSON 对象/);
  assert.match(prompt, /当前插件 System Prompt/);
  assert.match(prompt, /已加载 SKILL/);
  assert.match(prompt, /# AI 阅读/);
  assert.match(prompt, /工具 ID：summarize/);
  assert.match(prompt, /URL：https:\/\/example.com\/article/);
  assert.match(prompt, /网页内容：\nBody text/);
});

test("parseCodexOutput returns final assistant section", () => {
  assert.equal(parseCodexOutput("logs\nFinal answer:\n结果"), "结果");
  assert.equal(parseCodexOutput("\u001b[32mAssistant:\u001b[0m\n你好"), "你好");
});

test("extractCodexSessionId accepts JSON events, Codex thread events, and stderr text", () => {
  assert.equal(
    extractCodexSessionId("{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-session-json\"}}\n"),
    "codex-session-json"
  );
  assert.equal(
    extractCodexSessionId("{\"type\":\"thread.started\",\"thread_id\":\"019ee494-499d-74e1-b5af-853b52667682\"}\n"),
    "019ee494-499d-74e1-b5af-853b52667682"
  );
  assert.equal(
    extractCodexSessionId("OpenAI Codex\nsession id: 019ee490-53a1-7cf2-9769-2076fd17250c\n"),
    "019ee490-53a1-7cf2-9769-2076fd17250c"
  );
});

test("normalizeToolOutput accepts structured cards", () => {
  const tool = getToolDefinition("keypoints");
  assert.ok(tool);

  const normalized = normalizeToolOutput(JSON.stringify({
    title: "重点",
    summary: "一句话",
    cards: [
      {
        title: "事实",
        renderType: "kv",
        content: {
          items: [
            { key: "日期", value: "2026-06-20" }
          ]
        }
      },
      {
        title: "风险",
        renderType: "table",
        content: {
          columns: ["风险", "说明"],
          rows: [["格式漂移", "模型可能不按 JSON 输出"]]
        }
      }
    ]
  }), tool);

  assert.deepEqual(normalized.warnings, []);
  assert.equal(normalized.result.title, "重点");
  assert.equal(normalized.result.cards[0].renderType, "kv");
  assert.equal(normalized.result.cards[1].renderType, "table");
});

test("normalizeToolOutput converts wrapped HTML code cards to HTML cards", () => {
  const tool = getToolDefinition("custom_prompt");
  assert.ok(tool);

  const raw = `Codex 输出如下：\n（${JSON.stringify({
    title: "AI Hero 网站内容概述",
    summary: "该网站主要介绍面向专业开发者的 AI 工程学习内容。",
    cards: [
      {
        title: "HTML 回答",
        renderType: "code",
        content: {
          language: "html",
          code: "<section>\\n  <h1>AI Hero 网站主要内容</h1>\\n</section>"
        }
      }
    ]
  })}）`;

  const normalized = normalizeToolOutput(raw, tool);

  assert.deepEqual(normalized.warnings, []);
  assert.equal(normalized.result.title, "AI Hero 网站内容概述");
  assert.equal(normalized.result.cards[0].renderType, "html");
  assert.equal(normalized.result.cards[0].allowPreview, true);
  assert.match(String(normalized.result.cards[0].content.html), /<section>/);
});

test("normalizeToolOutput prefers final tool JSON when Codex output contains JSON events", () => {
  const tool = getToolDefinition("custom_prompt");
  assert.ok(tool);

  const finalResult = JSON.stringify({
    title: "HTML result",
    summary: "ok",
    cards: [
      {
        title: "HTML",
        renderType: "code",
        content: {
          language: "html",
          code: "<section>ok</section>"
        }
      }
    ]
  });
  const raw = [
    JSON.stringify({ type: "session_meta", payload: { id: "codex-session-1" } }),
    finalResult
  ].join("\n");

  const normalized = normalizeToolOutput(raw, tool);

  assert.deepEqual(normalized.warnings, []);
  assert.equal(normalized.result.title, "HTML result");
  assert.equal(normalized.result.cards[0].renderType, "html");
  assert.equal(normalized.result.cards[0].allowPreview, true);
  assert.match(String(normalized.result.cards[0].content.html), /<section>ok<\/section>/);
});

test("normalizeToolOutput downgrades invalid JSON to markdown with warnings", () => {
  const tool = getToolDefinition("summarize");
  assert.ok(tool);

  const normalized = normalizeToolOutput("这是一段普通文本。", tool);

  assert.equal(normalized.result.cards.length, 1);
  assert.equal(normalized.result.cards[0].renderType, "markdown");
  assert.match(String(normalized.result.cards[0].content.markdown), /普通文本/);
  assert.ok(normalized.warnings.length > 0);
});

test("SqliteStore keeps custom prompt history and tool runs", () => {
  const store = new SqliteStore(":memory:");
  test.after(() => store.close());
  const tool = getToolDefinition("custom_prompt");
  assert.ok(tool);

  store.savePrompt("整理网页", "自定义指令", new Date("2026-06-20T00:00:00.000Z"));
  store.savePrompt("整理网页", "自定义指令", new Date("2026-06-20T00:01:00.000Z"));

  const prompts = store.listPrompts();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].instruction, "整理网页");
  assert.equal(prompts[0].useCount, 2);

  store.createToolRun({
    id: "run-1",
    createdAt: "2026-06-20T00:00:00.000Z",
    tool,
    inputSource: "page",
    instruction: "整理网页",
    page: normalizePage({ title: "T", url: "https://example.com", text: "Body" }),
    prompt: "Prompt",
    requestJson: "{\"ok\":true}"
  });
  store.finishToolRun("run-1", {
    status: "success",
    elapsedMs: 12,
    rawOutput: "{\"cards\":[]}",
    normalizedOutput: {
      title: "Done",
      summary: "",
      cards: []
    },
    stderr: "warn"
  });

  const run = store.getToolRun("run-1");
  assert.ok(run);
  assert.equal(run.toolId, "custom_prompt");
  assert.equal(run.normalizedOutput.title, "Done");
  assert.equal(run.stderr, "warn");
  assert.equal(store.listToolRuns()[0].id, "run-1");
});

test("handleToolRun stores a structured run when Codex is mocked", async () => {
  const store = new SqliteStore(":memory:");
  test.after(() => store.close());

  const response = await handleToolRun("custom_prompt", {
    instruction: "总结一下",
    page: {
      title: "Current",
      url: "https://example.com/current",
      text: "Current page body"
    }
  }, {
    config: baseConfig,
    store,
    runCodex: async (prompt) => ({
      stdout: "",
      stderr: "",
      lastMessage: JSON.stringify({
        title: "收到",
        summary: `包含正文：${prompt.includes("Current page body")}`,
        cards: [
          {
            title: "结果",
            renderType: "markdown",
            content: { markdown: "结构化完成" }
          }
        ]
      })
    }),
    now: () => new Date("2026-06-20T00:00:00.000Z")
  });

  assert.equal(response.ok, true);
  assert.equal(response.run.status, "success");
  assert.equal(response.run.normalizedOutput.cards[0].renderType, "markdown");
  assert.equal(store.listPrompts()[0].instruction, "总结一下");
  assert.equal(store.listToolRuns().length, 1);
});

test("handleToolRun maps local sessions to Codex sessions and resumes them", async () => {
  const store = new SqliteStore(":memory:");
  test.after(() => store.close());
  const resumeIds: Array<string | undefined> = [];

  const first = await handleToolRun("summarize", {
    page: {
      title: "Session Page",
      url: "https://example.com/session",
      text: "Session body"
    }
  }, {
    config: baseConfig,
    store,
    runCodex: async (_prompt, resumeId) => {
      resumeIds.push(resumeId);
      return {
        stdout: "{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-session-1\"}}\n",
        stderr: "",
        codexSessionId: "codex-session-1",
        lastMessage: JSON.stringify({
          title: "First",
          summary: "first summary",
          cards: [
            {
              title: "First card",
              renderType: "markdown",
              content: { markdown: "first" }
            }
          ]
        })
      };
    }
  });

  assert.ok(first.session);
  assert.equal(first.session.codexSessionId, "codex-session-1");
  assert.equal(first.session.messages.length, 2);

  const second = await handleToolRun("keypoints", {
    sessionId: first.session.id,
    page: {
      title: "Session Page",
      url: "https://example.com/session",
      text: "Session body again"
    }
  }, {
    config: baseConfig,
    store,
    runCodex: async (_prompt, resumeId) => {
      resumeIds.push(resumeId);
      return {
        stdout: "",
        stderr: "",
        lastMessage: JSON.stringify({
          title: "Second",
          summary: "second summary",
          cards: [
            {
              title: "Second card",
              renderType: "kv",
              content: { items: [{ key: "status", value: "resumed" }] }
            }
          ]
        })
      };
    }
  });

  assert.deepEqual(resumeIds, [undefined, "codex-session-1"]);
  assert.equal(second.session?.id, first.session.id);
  assert.equal(second.session?.messages.length, 4);
  assert.equal(store.getSession(first.session.id)?.codexSessionId, "codex-session-1");
});

test("handleToolRun downgrades non-JSON Codex output without failing the run", async () => {
  const store = new SqliteStore(":memory:");
  test.after(() => store.close());

  const response = await handleToolRun("summarize", {
    page: {
      title: "Current",
      url: "https://example.com/current",
      text: "Current page body"
    }
  }, {
    config: baseConfig,
    store,
    runCodex: async () => ({
      stdout: "",
      stderr: "",
      lastMessage: "普通摘要文本"
    })
  });

  assert.equal(response.run.status, "success_with_warnings");
  assert.equal(response.run.normalizedOutput.cards[0].renderType, "markdown");
  assert.match(String(response.run.normalizedOutput.cards[0].content.markdown), /普通摘要文本/);
  assert.ok(response.run.normalizationWarnings.length > 0);
});

test("HTTP tool APIs return tools and write run rows", async () => {
  const store = new SqliteStore(":memory:");
  test.after(() => store.close());

  const server = createBridgeServer(baseConfig, store, async () => ({
    stdout: "",
    stderr: "",
    lastMessage: JSON.stringify({
      title: "HTTP result",
      summary: "",
      cards: [
        {
          title: "HTTP",
          renderType: "markdown",
          content: { markdown: "mocked result" }
        }
      ]
    })
  }));
  test.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address && typeof address === "object" ? address.port : 0;

  const toolsResponse = await fetch(`http://127.0.0.1:${port}/api/tools`);
  const toolsJson = await toolsResponse.json();
  assert.equal(toolsResponse.status, 200);
  assert.equal(toolsJson.ok, true);
  assert.ok(toolsJson.tools.find((tool) => tool.id === "make_html_snippet"));

  const runResponse = await fetch(`http://127.0.0.1:${port}/api/tools/summarize/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: {
        title: "HTTP",
        url: "https://example.com/http",
        text: "HTTP body"
      }
    })
  });
  const runJson = await runResponse.json();

  assert.equal(runResponse.status, 200);
  assert.equal(runJson.ok, true);
  assert.equal(runJson.run.normalizedOutput.title, "HTTP result");
  assert.equal(store.listToolRuns().length, 1);
});

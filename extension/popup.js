const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const MAX_HISTORY_ITEMS = 12;
const MAX_SESSION_ITEMS = 20;
const REFRESH_DEBOUNCE_MS = 350;
const CUSTOM_TOOL_ID = "custom_prompt";
const ICON_PATHS = {
  collapse: ["M6 15l6-6 6 6"],
  expand: ["M6 9l6 6 6-6"],
  copy: [
    "M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    "M9 2h6"
  ],
  fullscreen: [
    "M8 3H3v5",
    "M16 3h5v5",
    "M21 16v5h-5",
    "M3 16v5h5"
  ]
};

const elements = {
  shell: queryElement(".assistant-shell"),
  sidebar: queryElement(".resource-sidebar"),
  composer: queryElement(".composer"),
  sidebarCollapseButton: queryElement("#sidebarCollapseButton"),
  pageMeta: queryElement("#pageMeta"),
  pageContext: queryElement("#pageContext"),
  refreshPageButton: queryElement("#refreshPageButton"),
  healthButton: queryElement("#healthButton"),
  menuButton: queryElement("#menuButton"),
  menuPanel: queryElement("#menuPanel"),
  openDebugButton: queryElement("#openDebugButton"),
  toggleSettingsButton: queryElement("#toggleSettingsButton"),
  settingsPanel: queryElement("#settingsPanel"),
  skillList: queryElement("#skillList"),
  sessionTitle: queryElement("#sessionTitle"),
  sessionMeta: queryElement("#sessionMeta"),
  resultStatus: queryElement("#resultStatus"),
  messageList: queryElement("#messageList"),
  scrollToBottomButton: queryElement("#scrollToBottomButton"),
  sessionList: queryElement("#sessionList"),
  customPrompt: queryElement("#customPrompt"),
  runCustomButton: queryElement("#runCustomButton"),
  serverUrl: queryElement("#serverUrl"),
  serverUrlHistory: queryElement("#serverUrlHistory"),
  clearServerHistoryButton: queryElement("#clearServerHistoryButton"),
  closeSettingsButton: queryElement("#closeSettingsButton"),
  saveSettingsButton: queryElement("#saveSettingsButton"),
  statusText: queryElement("#statusText"),
  progress: queryElement("#progress"),
  copyButton: queryElement("#copyButton"),
  cardModal: queryElement("#cardModal"),
  cardModalTitle: queryElement("#cardModalTitle"),
  cardModalMeta: queryElement("#cardModalMeta"),
  cardModalBody: queryElement("#cardModalBody"),
  cardModalCloseButton: queryElement("#cardModalCloseButton"),
  cardModalCopyButton: queryElement("#cardModalCopyButton")
};

let currentPage = null;
let currentSession = null;
let activeSessionId = "";
let activeRunId = "";
let latestRun = null;
let tools = [];
let latestSessions = [];
let serverUrlHistory = [];
let refreshTimer = 0;
let newSessionPending = false;
let activeModalCard = null;
let composerResizeObserver = null;
const pendingSessionIds = new Set();

init();

async function init() {
  const missingElements = missingElementNames();
  if (missingElements.length) {
    renderFatalStartupError(missingElements);
    return;
  }

  bindEvents();
  observeComposerHeight();
  await loadSettings();
  await Promise.allSettled([
    loadTools(),
    refreshPagePreview(),
    runHealthCheck(false)
  ]);
  await refreshSessions(false, { selectMatchingPage: true, loadLatestIfEmpty: true });
  if (!currentSession && !activeSessionId) {
    renderEmptySession();
  }
}

function queryElement(selector) {
  return document.querySelector(selector);
}

function bindEvent(element, eventName, handler, options) {
  if (!element) {
    return;
  }
  element.addEventListener(eventName, handler, options);
}

function missingElementNames() {
  return Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);
}

function renderFatalStartupError(missingElements) {
  const message = [
    "Codex Web Assistant 界面文件版本不一致。",
    `缺失元素：${missingElements.join(", ")}`,
    "请在 chrome://extensions 重新加载这个扩展，然后重新打开侧边栏。"
  ];
  console.error(message.join("\n"));

  document.body.replaceChildren();
  const wrapper = document.createElement("main");
  wrapper.className = "startup-error";
  const title = document.createElement("h1");
  title.textContent = "扩展界面加载失败";
  const detail = document.createElement("p");
  detail.textContent = message.join(" ");
  wrapper.append(title, detail);
  document.body.append(wrapper);
}

function observeComposerHeight() {
  const setComposerHeight = () => {
    const height = Math.ceil(elements.composer.getBoundingClientRect().height);
    elements.shell.style.setProperty("--composer-height", `${height}px`);
  };

  setComposerHeight();
  if (typeof ResizeObserver === "function") {
    composerResizeObserver = new ResizeObserver(setComposerHeight);
    composerResizeObserver.observe(elements.composer);
  } else {
    window.addEventListener("resize", setComposerHeight);
  }
}

function bindEvents() {
  bindEvent(elements.runCustomButton, "click", () => {
    const instruction = elements.customPrompt.value.trim();
    if (!instruction) {
      setStatus("请先输入自定义指令。", "error");
      return;
    }
    runTool(CUSTOM_TOOL_ID, { instruction });
  });

  bindEvent(elements.customPrompt, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    if (event.metaKey) {
      event.preventDefault();
      insertTextAtCursor(elements.customPrompt, "\n");
      return;
    }

    if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      elements.runCustomButton.click();
    }
  });

  bindEvent(elements.serverUrlHistory, "change", () => {
    if (elements.serverUrlHistory.value) {
      elements.serverUrl.value = elements.serverUrlHistory.value;
      elements.serverUrlHistory.value = "";
    }
  });

  bindEvent(elements.menuButton, "click", (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  bindEvent(elements.toggleSettingsButton, "click", () => {
    closeMenu();
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
  });
  bindEvent(elements.openDebugButton, "click", async () => {
    closeMenu();
    const response = await chrome.runtime.sendMessage({ type: "OPEN_DEBUG_PAGE" });
    if (!response?.ok) {
      setStatus(response?.error || "打开调试页面失败。", "error");
    }
  });

  bindEvent(document, "click", (event) => {
    collapseSidebarFromOutsideClick(event);

    if (!isStaticMenu() && !elements.menuPanel.hidden && !elements.menuPanel.contains(event.target) && event.target !== elements.menuButton) {
      closeMenu();
    }
  });

  bindEvent(elements.refreshPageButton, "click", refreshPagePreview);
  bindEvent(elements.sidebarCollapseButton, "click", toggleSidebar);
  bindEvent(elements.clearServerHistoryButton, "click", clearServerHistory);
  bindEvent(elements.closeSettingsButton, "click", () => {
    elements.settingsPanel.hidden = true;
  });
  bindEvent(elements.saveSettingsButton, "click", saveSettings);
  bindEvent(elements.healthButton, "click", () => runHealthCheck(true));
  bindEvent(elements.copyButton, "click", copyLatestRun);
  bindEvent(elements.messageList, "scroll", syncScrollToBottomButton);
  bindEvent(elements.scrollToBottomButton, "click", () => scrollMessagesToBottom());
  bindEvent(elements.cardModalCloseButton, "click", closeCardModal);
  bindEvent(elements.cardModalCopyButton, "click", () => {
    if (activeModalCard) {
      copyText(cardToPlainText(activeModalCard));
    }
  });
  bindEvent(elements.cardModal, "click", (event) => {
    if (event.target === elements.cardModal) {
      closeCardModal();
    }
  });

  document.querySelectorAll("[data-toggle-section]").forEach((button) => {
    bindEvent(button, "click", () => toggleSidebarSection(button));
  });

  chrome.tabs?.onActivated?.addListener(() => schedulePageRefresh());
  chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.status === "complete" || changeInfo.title || changeInfo.url)) {
      schedulePageRefresh();
    }
  });
  chrome.windows?.onFocusChanged?.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      schedulePageRefresh();
    }
  });
  bindEvent(document, "visibilitychange", () => {
    if (!document.hidden) {
      schedulePageRefresh();
    }
  });
}

async function loadSettings() {
  const legacy = await chrome.storage.sync.get(["serverUrl"]);
  const stored = await chrome.storage.local.get(["serverUrl", "serverUrlHistory"]);
  const serverUrl = normalizeServerUrl(stored.serverUrl || legacy.serverUrl || DEFAULT_SERVER_URL);

  serverUrlHistory = normalizeHistory(stored.serverUrlHistory);
  serverUrlHistory = addHistoryItem(serverUrlHistory, serverUrl);

  elements.serverUrl.value = serverUrl;
  await chrome.storage.local.set({ serverUrl, serverUrlHistory });
  renderServerUrlHistory();
}

async function saveSettings() {
  const serverUrl = normalizeServerUrl(elements.serverUrl.value || DEFAULT_SERVER_URL);
  elements.serverUrl.value = serverUrl;
  serverUrlHistory = addHistoryItem(serverUrlHistory, serverUrl);
  await chrome.storage.local.set({ serverUrl, serverUrlHistory });
  renderServerUrlHistory();
  setStatus("本地服务地址已保存。");
  await Promise.allSettled([
    loadTools(),
    runHealthCheck(false),
    refreshSessions(false)
  ]);
}

async function loadTools() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_TOOLS" });
    if (!response?.ok) {
      throw new Error(response?.error || "读取技能清单失败。");
    }

    tools = response.data.tools || [];
    renderSkillList();
  } catch (error) {
    tools = [];
    renderSkillList();
    setStatus(`${error.message}。请确认本地服务正在运行。`, "error");
  }
}

function renderSkillList() {
  elements.skillList.textContent = "";

  tools.forEach((tool) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sidebar-item skill-item${tool.requiresInstruction ? " needs-input" : ""}`;
    button.dataset.toolId = tool.id;
    button.title = tool.description || tool.title;

    const icon = document.createElement("span");
    icon.className = "skill-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tool.icon || (tool.title || "?").slice(0, 1);

    const text = document.createElement("span");
    text.className = "skill-text";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = tool.title;
    text.append(title);
    button.append(icon, text);

    button.addEventListener("click", () => {
      if (tool.requiresInstruction) {
        elements.customPrompt.focus();
        setStatus("输入自定义指令后发送。");
        return;
      }
      runTool(tool.id);
    });
    elements.skillList.append(button);
  });

  if (!tools.length) {
    elements.skillList.append(renderEmptyItem("未读取到技能"));
  }
}

function schedulePageRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshPagePreview();
  }, REFRESH_DEBOUNCE_MS);
}

async function refreshPagePreview() {
  try {
    currentPage = await extractCurrentPage();
    renderPageContext(currentPage);
    await selectSessionForPage(currentPage);
  } catch (error) {
    currentPage = null;
    elements.pageMeta.textContent = "无法读取当前网页";
    elements.pageContext.textContent = error.message;
    elements.pageContext.title = error.message;
    elements.pageMeta.classList.add("is-error");
    elements.pageContext.classList.add("is-error");
    setStatus(error.message, "error");
  }
}

function renderPageContext(page) {
  const source = page.selectionOnly ? "已选中文本" : "当前网页";
  const length = page.text.length.toLocaleString("zh-CN");
  const title = page.title || "无标题网页";
  elements.pageMeta.textContent = `${source} · ${length} 字符`;
  elements.pageContext.textContent = title;
  elements.pageContext.title = page.url ? `${title}\n${page.url}` : title;
  elements.pageMeta.classList.remove("is-error");
  elements.pageContext.classList.remove("is-error");
  setStatus(`已同步当前网页：${title}`);
}

async function extractCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fallbackTabs = tab ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tab || fallbackTabs[0];

  if (!activeTab?.id) {
    throw new Error("没有找到当前活动标签页。");
  }

  if (!/^https?:\/\//i.test(activeTab.url || "")) {
    throw new Error("这个页面不允许扩展读取内容，请切换到普通网页。");
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content.js"]
    });
  } catch (error) {
    if (!String(error.message || "").includes("Cannot access")) {
      throw error;
    }
    throw new Error("这个页面不允许扩展读取内容，请换一个普通网页重试。");
  }

  const response = await chrome.tabs.sendMessage(activeTab.id, { type: "EXTRACT_PAGE" });
  if (!response?.ok) {
    throw new Error(response?.error || "读取网页内容失败。");
  }
  if (!response.page?.text) {
    throw new Error("当前页没有提取到可分析文本。");
  }

  return {
    ...response.page,
    tabId: activeTab.id
  };
}

async function runTool(toolId, extraPayload = {}) {
  const tool = tools.find((item) => item.id === toolId);
  const toolTitle = tool?.title || toolId;
  let pendingSessionId = "";
  if (isActiveSessionPending()) {
    setStatus("当前 Session 正在等待回答，请先切换到其他 Session。", "error");
    return;
  }

  try {
    currentPage = await extractCurrentPage();
    renderPageContext(currentPage);
    const session = await ensureActiveSession(currentPage, toolTitle);
    const sessionId = session.id;
    pendingSessionId = sessionId;
    const userMessage = createOptimisticUserMessage(tool, extraPayload, currentPage);
    appendOptimisticMessage(sessionId, userMessage);
    pendingSessionIds.add(sessionId);
    syncComposerState();
    await refreshSessions(false);
    if (toolId === CUSTOM_TOOL_ID) {
      elements.customPrompt.value = "";
    }
    setStatus(`${toolTitle}处理中，Codex 会在后台继续回答。`);

    const response = await chrome.runtime.sendMessage({
      type: "RUN_TOOL",
      toolId,
      payload: {
        ...extraPayload,
        sessionId,
        page: currentPage
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "调用本地 Codex 失败。");
    }

    pendingSessionIds.delete(sessionId);
    latestRun = response.data.run;
    activeRunId = latestRun.id;
    if (response.data.session && activeSessionId === sessionId) {
      setCurrentSession(response.data.session);
    } else if (!response.data.session && activeSessionId === sessionId) {
      renderRunAsSession(latestRun);
    }

    await refreshSessions(false);

    if (latestRun.status === "failed") {
      setStatus(latestRun.error || "工具运行失败。", "error");
    } else if (latestRun.normalizationWarnings?.length) {
      setStatus(`完成，用时 ${latestRun.elapsedMs}ms。结构化输出已降级或修正。Debug ID：${latestRun.id}`);
    } else {
      setStatus(`完成，用时 ${latestRun.elapsedMs}ms。Debug ID：${latestRun.id}`);
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    if (pendingSessionId) {
      const wasPending = pendingSessionIds.delete(pendingSessionId);
      if (wasPending && activeSessionId === pendingSessionId && currentSession) {
        renderSession(currentSession);
      }
    }
    syncComposerState();
    await refreshSessions(false).catch(() => {});
  }
}

async function ensureActiveSession(page, fallbackTitle) {
  if (
    activeSessionId
    && currentSession?.id === activeSessionId
    && urlsMatch(currentSession.pageUrl, page.url)
  ) {
    return currentSession;
  }

  const matchingSession = findSessionByUrl(page.url);
  if (matchingSession) {
    await loadSession(matchingSession.id, { refreshLists: false, openPage: false, quiet: true });
    return currentSession;
  }

  const response = await chrome.runtime.sendMessage({
    type: "CREATE_SESSION",
    payload: {
      title: fallbackTitle,
      page
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "创建 Session 失败。");
  }

  newSessionPending = false;
  setCurrentSession(response.data.session);
  return response.data.session;
}

function createOptimisticUserMessage(tool, extraPayload, page) {
  const customInstruction = String(extraPayload.instruction || "").trim();
  return {
    id: `optimistic-user-${Date.now()}`,
    sessionId: activeSessionId,
    role: "user",
    toolRunId: "",
    toolTitle: tool?.title || "Codex",
    status: "",
    createdAt: new Date().toISOString(),
    contentText: tool?.requiresInstruction
      ? customInstruction
      : `${tool?.title || "内置技能"} · ${page.selectionOnly ? "选中文本" : "当前网页"}`,
    output: null
  };
}

function appendOptimisticMessage(sessionId, message) {
  if (!currentSession || currentSession.id !== sessionId) {
    return;
  }

  currentSession = {
    ...currentSession,
    messageCount: (currentSession.messageCount || 0) + 1,
    messages: [...(currentSession.messages || []), message]
  };
  renderSession(currentSession);
  scrollMessagesToBottom();
}

function isActiveSessionPending() {
  return Boolean(activeSessionId && pendingSessionIds.has(activeSessionId));
}

function syncComposerState() {
  const isLocked = isActiveSessionPending();
  elements.customPrompt.disabled = isLocked;
  elements.runCustomButton.disabled = isLocked;
  elements.skillList.querySelectorAll("button").forEach((button) => {
    button.disabled = isLocked;
  });
}

async function createNewSession() {
  activeSessionId = "";
  activeRunId = "";
  latestRun = null;
  currentSession = null;
  newSessionPending = true;
  renderEmptySession();
  syncComposerState();
  await refreshSessions(false);
  setStatus("已切换到新 Session，下一次运行会创建 Codex session。");
}

async function refreshSessions(showErrors, options = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SESSIONS", limit: MAX_SESSION_ITEMS });
    if (!response?.ok) {
      throw new Error(response?.error || "读取历史 session 失败。");
    }
    const sessions = response.data.sessions || [];
    latestSessions = sessions;
    renderSessionList(sessions);
    if (options.selectMatchingPage && currentPage?.url) {
      const selected = await selectSessionForPage(currentPage, { sessions });
      if (selected) {
        return;
      }
    }
    if (options.loadLatestIfEmpty && !currentPage?.url && !activeSessionId && !newSessionPending && sessions[0]?.id) {
      await loadSession(sessions[0].id, { refreshLists: false, openPage: false });
    }
  } catch (error) {
    elements.sessionList.textContent = "";
    if (showErrors) {
      setStatus(error.message, "error");
    }
  }
}

function renderSessionList(sessions) {
  elements.sessionList.textContent = "";

  if (!sessions.length) {
    elements.sessionList.append(renderEmptyItem("暂无 session"));
    return;
  }

  sessions.forEach((session) => {
    const isLoading = pendingSessionIds.has(session.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "sidebar-item",
      "session-item",
      activeSessionId === session.id ? "is-active" : "",
      isLoading ? "is-loading" : ""
    ].filter(Boolean).join(" ");
    button.dataset.sessionId = session.id;

    const title = document.createElement("span");
    title.className = "item-title";
    const sessionTitle = session.pageTitle || session.title || "未命名 Session";
    title.textContent = sessionTitle;
    title.title = sessionTitle;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = isLoading ? `回答中 · ${formatTime(session.updatedAt)}` : formatTime(session.updatedAt);
    button.append(title, meta);

    button.addEventListener("click", () => loadSession(session.id, { openPage: true }));
    elements.sessionList.append(button);
  });
}

async function selectSessionForPage(page, options = {}) {
  if (!page?.url || newSessionPending) {
    return false;
  }

  const sessions = options.sessions || latestSessions;
  const matchingSession = findSessionByUrl(page.url, sessions);
  if (matchingSession) {
    if (activeSessionId !== matchingSession.id) {
      await loadSession(matchingSession.id, {
        refreshLists: false,
        openPage: false,
        quiet: true
      });
    }
    renderSessionList(sessions);
    scrollMessagesToBottom();
    return true;
  }

  if (activeSessionId && !urlsMatch(currentSession?.pageUrl, page.url)) {
    activeSessionId = "";
    activeRunId = "";
    latestRun = null;
    currentSession = null;
    renderEmptySession();
    renderSessionList(sessions);
    syncComposerState();
  }
  return false;
}

function findSessionByUrl(url, sessions = latestSessions) {
  const normalizedUrl = normalizeUrlForSession(url);
  if (!normalizedUrl) {
    return null;
  }
  return sessions.find((session) => normalizeUrlForSession(session.pageUrl) === normalizedUrl) || null;
}

function urlsMatch(left, right) {
  const normalizedLeft = normalizeUrlForSession(left);
  const normalizedRight = normalizeUrlForSession(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeUrlForSession(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    url.hash = "";
    return url.href;
  } catch {
    return text.replace(/#.*$/, "");
  }
}

async function openSessionPage(session) {
  const url = session?.pageUrl || "";
  if (!/^https?:\/\//i.test(url)) {
    return;
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const existingTab = tabs.find((tab) => urlsMatch(tab.url, url));
  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    return;
  }

  await chrome.tabs.create({ url, active: true });
}

async function loadSession(id, options = {}) {
  const response = await chrome.runtime.sendMessage({ type: "GET_SESSION", id });
  if (!response?.ok) {
    setStatus(response?.error || "读取 session 失败。", "error");
    return;
  }

  newSessionPending = false;
  setCurrentSession(response.data.session);
  if (options.openPage) {
    await openSessionPage(response.data.session);
  }
  if (options.refreshLists !== false) {
    await refreshSessions(false);
  }
  if (!options.quiet) {
    setStatus(`已加载 Session：${response.data.session.title || response.data.session.id}`);
  }
}

function setCurrentSession(session) {
  currentSession = session;
  activeSessionId = session?.id || "";
  renderSession(session);
  syncComposerState();
}

function renderEmptySession() {
  elements.sessionTitle.textContent = "新 Session";
  elements.sessionMeta.textContent = "点击底部内置技能会基于当前网页创建本地对话记录，并映射到 Codex session。";
  elements.resultStatus.textContent = "idle";
  elements.resultStatus.className = "result-status";
  elements.messageList.textContent = "";
  elements.messageList.append(renderSystemMessage("选择一个内置技能，或输入自定义指令开始。"));
  elements.copyButton.disabled = true;
  scrollMessagesToBottom();
}

function renderSession(session) {
  const title = session.pageTitle || session.title || "未命名 Session";
  elements.sessionTitle.textContent = title;
  elements.sessionTitle.title = title;
  elements.sessionMeta.textContent = [
    session.codexSessionId ? `Codex：${session.codexSessionId}` : "Codex：待创建",
    session.pageTitle || session.pageUrl || "",
    `${session.messageCount || 0} 条消息`
  ].filter(Boolean).join(" · ");
  elements.messageList.textContent = "";
  elements.copyButton.disabled = true;
  if (pendingSessionIds.has(session.id)) {
    elements.resultStatus.textContent = "running";
    elements.resultStatus.className = "result-status is-warning";
  } else {
    elements.resultStatus.textContent = "idle";
    elements.resultStatus.className = "result-status";
  }

  if (!session.messages?.length) {
    elements.messageList.append(renderSystemMessage("这个 Session 还没有消息。"));
    elements.copyButton.disabled = true;
    scrollMessagesToBottom();
    return;
  }

  session.messages.forEach((message) => {
    elements.messageList.append(renderSessionMessage(message));
    if (message.role === "assistant" && message.toolRunId) {
      activeRunId = message.toolRunId;
    }
  });

  const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant" && message.output);
  elements.copyButton.disabled = !lastAssistant?.output?.cards?.length;
  if (lastAssistant && !pendingSessionIds.has(session.id)) {
    latestRun = {
      toolTitle: lastAssistant.toolTitle,
      normalizedOutput: lastAssistant.output
    };
    elements.resultStatus.textContent = formatStatus(lastAssistant.status);
    elements.resultStatus.className = `result-status is-${lastAssistant.status || "idle"}`;
  }
  scrollMessagesToBottom();
}

function renderRunAsSession(run) {
  const session = {
    id: run.sessionId || "",
    title: run.normalizedOutput?.title || run.toolTitle || "运行结果",
    codexSessionId: "",
    pageTitle: run.pageTitle,
    pageUrl: run.pageUrl,
    messageCount: 1,
    messages: [
      {
        id: `${run.id}-assistant`,
        role: "assistant",
        toolRunId: run.id,
        toolTitle: run.toolTitle,
        status: run.status,
        createdAt: run.createdAt,
        contentText: run.normalizedOutput?.summary || "",
        output: run.normalizedOutput
      }
    ]
  };
  setCurrentSession(session);
}

function renderSessionMessage(message) {
  const article = document.createElement("article");
  article.className = `chat-message ${message.role}`;

  const header = document.createElement("div");
  header.className = "chat-message-header";
  const titleGroup = document.createElement("div");
  titleGroup.className = "chat-message-title-group";
  const title = document.createElement("div");
  title.className = "chat-message-title";
  title.textContent = message.role === "assistant" ? (message.toolTitle || "Codex") : "你";
  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  meta.textContent = formatTime(message.createdAt);
  titleGroup.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "chat-message-actions";
  const collapseButton = createIconButton("collapse", "收起", "card-tool-button");
  collapseButton.setAttribute("aria-expanded", "true");
  collapseButton.addEventListener("click", () => {
    toggleFoldable(article, body, collapseButton, {
      expandedLabel: "收起",
      collapsedLabel: "展开",
      expandedIcon: "collapse",
      collapsedIcon: "expand"
    });
  });
  actions.append(collapseButton);
  header.append(titleGroup, actions);

  const body = document.createElement("div");
  body.className = "chat-message-body";

  if (message.contentText) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.contentText;
    body.append(text);
  }

  if (message.output?.cards?.length) {
    const list = document.createElement("div");
    list.className = "card-list";
    message.output.cards.forEach((card) => list.append(renderResultCard(card)));
    body.append(list);
  }

  article.append(header, body);
  return article;
}

function renderSystemMessage(text) {
  const node = document.createElement("div");
  node.className = "system-message";
  node.textContent = text;
  return node;
}

function renderResultCard(card) {
  const article = document.createElement("article");
  article.className = `result-card card-${card.renderType}`;

  const header = document.createElement("div");
  header.className = "card-header";
  const title = document.createElement("h3");
  title.textContent = card.title || card.renderType;
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const collapse = createIconButton("collapse", "收起", "card-tool-button");
  collapse.setAttribute("aria-expanded", "true");
  const open = createIconButton("fullscreen", "全屏查看", "card-tool-button");
  open.addEventListener("click", () => openCardModal(card));
  const copy = createIconButton("copy", "复制", "card-tool-button");
  copy.addEventListener("click", () => copyText(cardToPlainText(card)));
  const type = document.createElement("span");
  type.className = "card-type";
  type.textContent = formatCardMeta(card);
  actions.append(type, collapse, open, copy);
  header.append(title, actions);

  const body = document.createElement("div");
  body.className = "card-body";
  body.append(renderCardContent(card));
  collapse.addEventListener("click", () => {
    toggleFoldable(article, body, collapse, {
      expandedLabel: "收起",
      collapsedLabel: "展开",
      expandedIcon: "collapse",
      collapsedIcon: "expand"
    });
  });

  article.append(header, body);
  return article;
}

function renderCardContent(card) {
  const fragment = document.createDocumentFragment();

  if (card.renderType === "markdown") {
    fragment.append(renderIframePreview(markdownToHtml(card.content?.markdown || ""), `${card.title || "Markdown"} 渲染`));
  } else if (card.renderType === "code") {
    fragment.append(renderCodeBlock(card.content?.code || "", card.content?.language || "text"));
  } else if (card.renderType === "html") {
    fragment.append(renderHtmlBlock(card));
  } else if (card.renderType === "table") {
    fragment.append(renderTable(card.content));
  } else if (card.renderType === "kv") {
    fragment.append(renderKv(card.content));
  } else {
    fragment.append(renderIframePreview(`<pre>${escapeHtml(JSON.stringify(card.content || {}, null, 2))}</pre>`, "JSON 渲染"));
  }

  return fragment;
}

function renderCodeBlock(code, language) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const meta = document.createElement("div");
  meta.className = "code-meta";
  meta.textContent = language || "text";

  const pre = document.createElement("pre");
  const codeNode = document.createElement("code");
  codeNode.textContent = code;
  pre.append(codeNode);
  wrapper.append(meta, pre);
  return wrapper;
}

function renderHtmlBlock(card) {
  const wrapper = document.createElement("div");
  wrapper.className = "html-block";
  if (card.allowPreview) {
    wrapper.append(renderIframePreview(card.content?.html || "", `${card.title || "HTML"} 安全预览`));
  } else {
    wrapper.append(renderCodeBlock(card.content?.html || "", "html"));
  }
  return wrapper;
}

function renderIframePreview(html, title) {
  const iframe = document.createElement("iframe");
  iframe.className = "card-preview";
  iframe.title = title;
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.addEventListener("load", () => resizeIframePreview(iframe));
  iframe.srcdoc = buildPreviewSrcdoc(html);
  return iframe;
}

function renderFullscreenCardContent(card) {
  if (card.renderType === "markdown") {
    const preview = renderIframePreview(markdownToHtml(card.content?.markdown || ""), `${card.title || "Markdown"} 渲染`);
    preview.classList.add("is-fullscreen-preview");
    return preview;
  }

  if (card.renderType === "html" && card.allowPreview) {
    const preview = renderIframePreview(card.content?.html || "", `${card.title || "HTML"} 安全预览`);
    preview.classList.add("is-fullscreen-preview");
    return preview;
  }

  return renderCardContent(card);
}

function resizeIframePreview(iframe) {
  try {
    const shouldStickToBottom = isMessageListNearBottom();
    const doc = iframe.contentDocument;
    if (!doc) {
      return;
    }
    const body = doc.body;
    const root = doc.documentElement;
    const contentHeight = Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      root?.scrollHeight || 0,
      root?.offsetHeight || 0
    );
    const minHeight = readPixelVariable(iframe, "--preview-min-height", 72);
    const maxHeight = readPixelMaxVariable(iframe, "--preview-max-height", 360);
    const targetHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight));
    iframe.style.height = `${Math.ceil(targetHeight)}px`;
    iframe.classList.toggle("is-scrollable", contentHeight > maxHeight + 1);
    if (shouldStickToBottom) {
      scrollMessagesToBottom();
    } else {
      syncScrollToBottomButton();
    }
  } catch {
    iframe.style.height = "";
  }
}

function readPixelVariable(element, name, fallback) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPixelMaxVariable(element, name, fallback) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (value === "none" || value === "auto" || value === "max-content") {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderTable(content = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  const table = document.createElement("table");
  const columns = Array.isArray(content.columns) ? content.columns : [];
  const rows = Array.isArray(content.rows) ? content.rows : [];

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.append(th);
  });
  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = Array.isArray(row) ? row : [];
    columns.forEach((_, index) => {
      const td = document.createElement("td");
      td.textContent = cells[index] || "";
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function renderKv(content = {}) {
  const list = document.createElement("dl");
  list.className = "kv-list";
  const items = Array.isArray(content.items) ? content.items : [];

  items.forEach((item) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = item.key || "";
    dd.textContent = item.value || "";
    row.append(dt, dd);
    list.append(row);
  });

  return list;
}

async function loadRun(id) {
  const response = await chrome.runtime.sendMessage({ type: "GET_RUN", id });
  if (!response?.ok) {
    setStatus(response?.error || "读取运行详情失败。", "error");
    return;
  }

  latestRun = response.data.run;
  activeRunId = latestRun.id;
  if (latestRun.sessionId) {
    await loadSession(latestRun.sessionId);
  } else {
    renderRunAsSession(latestRun);
  }
  setStatus(`已加载运行：${latestRun.id}`);
}

async function runHealthCheck(showSuccess) {
  elements.healthButton.classList.remove("is-ok", "is-error");

  try {
    const response = await chrome.runtime.sendMessage({ type: "HEALTH_CHECK" });
    if (!response?.ok) {
      throw new Error(response?.error || "本地服务不可用。");
    }
    elements.healthButton.classList.add("is-ok");
    if (showSuccess) {
      setStatus(`本地服务正常：${response.data.codexPath}`);
    }
  } catch (error) {
    elements.healthButton.classList.add("is-error");
    if (showSuccess) {
      setStatus(`${error.message}。请先运行 npm start。`, "error");
    }
  }
}

async function clearServerHistory() {
  const serverUrl = normalizeServerUrl(elements.serverUrl.value || DEFAULT_SERVER_URL);
  serverUrlHistory = [serverUrl];
  await chrome.storage.local.set({ serverUrlHistory });
  renderServerUrlHistory();
  setStatus("历史地址已清空。");
}

async function copyLatestRun() {
  if (!latestRun?.normalizedOutput?.cards?.length) {
    return;
  }
  await copyText(runToPlainText(latestRun));
}

async function copyText(text) {
  await navigator.clipboard.writeText(text || "");
  setStatus("已复制。");
}

function renderServerUrlHistory() {
  renderHistoryOptions(elements.serverUrlHistory, serverUrlHistory, "历史地址");
  elements.clearServerHistoryButton.disabled = serverUrlHistory.length <= 1;
}

function renderHistoryOptions(select, history, label) {
  select.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = label;
  select.append(placeholder);

  history.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item.length > 82 ? `${item.slice(0, 79)}...` : item;
    select.append(option);
  });
}

function setStatus(message, type = "info") {
  elements.statusText.textContent = message;
  elements.statusText.classList.toggle("is-error", type === "error");
}

function toggleMenu() {
  if (isStaticMenu()) {
    return;
  }
  const nextHidden = !elements.menuPanel.hidden;
  elements.menuPanel.hidden = nextHidden;
  elements.menuButton.classList.toggle("is-open", !nextHidden);
}

function closeMenu() {
  if (isStaticMenu()) {
    return;
  }
  elements.menuPanel.hidden = true;
  elements.menuButton.classList.remove("is-open");
}

function isStaticMenu() {
  return elements.menuPanel.dataset.static === "true";
}

function toggleSidebar() {
  setSidebarCollapsed(!elements.shell.classList.contains("is-sidebar-collapsed"));
}

function setSidebarCollapsed(shouldCollapse) {
  elements.shell.classList.toggle("is-sidebar-collapsed", shouldCollapse);
  elements.sidebarCollapseButton.setAttribute("aria-expanded", String(!shouldCollapse));
  elements.sidebarCollapseButton.setAttribute("aria-label", shouldCollapse ? "展开侧边栏" : "折叠侧边栏");
}

function collapseSidebarFromOutsideClick(event) {
  if (elements.shell.classList.contains("is-sidebar-collapsed")) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (!target || elements.cardModal.open || target.closest(".resource-sidebar, .settings-panel")) {
    return;
  }
  setSidebarCollapsed(true);
}

function toggleSidebarSection(button) {
  const targetId = button.dataset.toggleSection;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) {
    return;
  }

  const shouldCollapse = !target.hidden;
  target.hidden = shouldCollapse;
  button.setAttribute("aria-expanded", String(!shouldCollapse));
  button.closest(".sidebar-section, .skill-tray")?.classList.toggle("is-collapsed", shouldCollapse);
}

function toggleFoldable(container, body, button, labels) {
  const shouldCollapse = !body.hidden;
  const label = shouldCollapse ? labels.collapsedLabel : labels.expandedLabel;
  body.hidden = shouldCollapse;
  container.classList.toggle("is-collapsed", shouldCollapse);
  if (button.dataset.iconButton === "true") {
    setIconButton(
      button,
      shouldCollapse ? labels.collapsedIcon || "expand" : labels.expandedIcon || "collapse",
      label
    );
  } else {
    button.textContent = label;
  }
  button.setAttribute("aria-expanded", String(!shouldCollapse));
}

function createIconButton(iconName, label, className = "icon-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${className} is-icon`;
  button.dataset.iconButton = "true";
  setIconButton(button, iconName, label);
  return button;
}

function setIconButton(button, iconName, label) {
  button.textContent = "";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(iconName));
}

function createIcon(iconName) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  for (const data of ICON_PATHS[iconName] || ICON_PATHS.copy) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }

  return svg;
}

function openCardModal(card) {
  activeModalCard = card;
  elements.cardModalTitle.textContent = card.title || "结果详情";
  elements.cardModalMeta.textContent = formatCardMeta(card);
  elements.cardModalBody.textContent = "";
  elements.cardModalBody.append(renderFullscreenCardContent(card));

  if (typeof elements.cardModal.showModal === "function") {
    elements.cardModal.showModal();
  } else {
    elements.cardModal.setAttribute("open", "");
  }
}

function formatCardMeta(card) {
  if (card.renderType === "html" && card.allowPreview) {
    return "html · 安全预览";
  }
  return card.renderType || "";
}

function closeCardModal() {
  if (typeof elements.cardModal.close === "function" && elements.cardModal.open) {
    elements.cardModal.close();
  } else {
    elements.cardModal.removeAttribute("open");
  }
  activeModalCard = null;
  elements.cardModalBody.textContent = "";
}

function scrollMessagesToBottom() {
  window.requestAnimationFrame(() => {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
    syncScrollToBottomButton();
  });
}

function syncScrollToBottomButton() {
  if (!elements.scrollToBottomButton) {
    return;
  }
  elements.scrollToBottomButton.hidden = isMessageListNearBottom();
}

function isMessageListNearBottom(threshold = 80) {
  const distanceFromBottom = elements.messageList.scrollHeight
    - elements.messageList.scrollTop
    - elements.messageList.clientHeight;
  return distanceFromBottom <= threshold;
}

function insertTextAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const cursor = start + text.length;
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function cardToPlainText(card) {
  if (card.renderType === "markdown") {
    return card.content?.markdown || "";
  }
  if (card.renderType === "code") {
    return card.content?.code || "";
  }
  if (card.renderType === "html") {
    return card.content?.html || "";
  }
  if (card.renderType === "table") {
    const columns = Array.isArray(card.content?.columns) ? card.content.columns : [];
    const rows = Array.isArray(card.content?.rows) ? card.content.rows : [];
    return [columns.join("\t"), ...rows.map((row) => (Array.isArray(row) ? row : []).join("\t"))].join("\n");
  }
  if (card.renderType === "kv") {
    const items = Array.isArray(card.content?.items) ? card.content.items : [];
    return items.map((item) => `${item.key}: ${item.value}`).join("\n");
  }
  return JSON.stringify(card.content || {}, null, 2);
}

function runToPlainText(run) {
  const output = run.normalizedOutput || {};
  const cards = Array.isArray(output.cards) ? output.cards : [];
  return [
    output.title || run.toolTitle || "工具结果",
    output.summary || "",
    ...cards.map((card) => `\n## ${card.title}\n${cardToPlainText(card)}`)
  ].filter(Boolean).join("\n");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\n/);
  const html = [];
  let inCode = false;
  let codeLines = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const level = Math.min(line.match(/^#+/)?.[0].length || 2, 6);
      html.push(`<h${level}>${escapeHtml(line.replace(/^#{1,6}\s+/, ""))}</h${level}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      html.push(`<p class="bullet">${escapeHtml(line.replace(/^\s*[-*]\s+/, ""))}</p>`);
    } else if (line.trim()) {
      html.push(`<p>${escapeHtml(line)}</p>`);
    } else {
      html.push("<br>");
    }
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
}

function buildPreviewSrcdoc(html) {
  const cleaned = String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<form[\s\S]*?>[\s\S]*?<\/form>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");

  return [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;\">",
    "<style>",
    "body{margin:0;padding:12px;background:#fff;color:#171a1f;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
    "h1,h2,h3,h4,h5,h6{margin:0.9em 0 0.35em;line-height:1.2;} p{margin:0.45em 0;} pre{overflow:auto;background:#f3f5f7;border:1px solid #d9dde3;border-radius:8px;padding:10px;} code{font:12px/1.5 SFMono-Regular,Consolas,monospace;} .bullet{padding-left:1em;position:relative}.bullet:before{content:'-';position:absolute;left:0;color:#5b6572}",
    "</style>",
    "<base href=\"about:blank\">",
    cleaned
  ].join("");
}

function renderEmptyItem(text) {
  const empty = document.createElement("div");
  empty.className = "history-empty";
  empty.textContent = text;
  return empty;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInputSource(value) {
  if (value === "selection") {
    return "选中文本";
  }
  if (value === "manual") {
    return "手动输入";
  }
  return "当前网页";
}

function formatStatus(value) {
  if (value === "success_with_warnings") {
    return "warning";
  }
  if (value === "failed") {
    return "failed";
  }
  if (value === "success") {
    return "success";
  }
  return "idle";
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN");
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, MAX_HISTORY_ITEMS);
}

function addHistoryItem(history, item) {
  const value = String(item || "").trim();
  if (!value) {
    return normalizeHistory(history);
  }

  return [value, ...normalizeHistory(history).filter((historyItem) => historyItem !== value)]
    .slice(0, MAX_HISTORY_ITEMS);
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

chrome.runtime.onInstalled.addListener(async () => {
  await migrateSettingsToLocalStorage();
  await enableSidePanelAction();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelAction();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_TOOLS") {
    getTools()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RUN_TOOL") {
    runTool(message.toolId, message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SESSIONS") {
    getSessions(message.limit)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SESSION") {
    getSession(message.id)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CREATE_SESSION") {
    createSession(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "HEALTH_CHECK") {
    checkHealth()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_PROMPT_HISTORY") {
    getPromptHistory(message.limit)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_PROMPT_HISTORY") {
    savePromptHistory(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_PROMPT_HISTORY") {
    clearPromptHistory()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_RUNS") {
    getRuns(message.limit)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_RUN") {
    getRun(message.id)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_DEBUG_PAGE") {
    chrome.tabs.create({ url: chrome.runtime.getURL("debug.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

enableSidePanelAction();

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.local.get(["serverUrl"]);
  return normalizeServerUrl(serverUrl || DEFAULT_SERVER_URL);
}

async function migrateSettingsToLocalStorage() {
  const local = await chrome.storage.local.get(["serverUrl", "serverUrlHistory"]);
  const sync = await chrome.storage.sync.get(["serverUrl"]);
  const serverUrl = normalizeServerUrl(local.serverUrl || sync.serverUrl || DEFAULT_SERVER_URL);
  const serverUrlHistory = Array.isArray(local.serverUrlHistory) && local.serverUrlHistory.length
    ? local.serverUrlHistory
    : [serverUrl];

  await chrome.storage.local.set({ serverUrl, serverUrlHistory });
}

async function enableSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

async function checkHealth() {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/health`, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });
}

async function getTools() {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/tools`);
}

async function runTool(toolId, payload) {
  if (!toolId) {
    throw new Error("Missing tool id");
  }

  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/tools/${encodeURIComponent(toolId)}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

async function getSessions(limit = 50) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/sessions?limit=${encodeURIComponent(limit)}`);
}

async function getSession(id) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/sessions/${encodeURIComponent(id)}`);
}

async function createSession(payload = {}) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

async function getPromptHistory(limit = 50) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/history/prompts?limit=${encodeURIComponent(limit)}`);
}

async function savePromptHistory(payload) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/history/prompts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

async function clearPromptHistory() {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/history/prompts`, { method: "DELETE" });
}

async function getRuns(limit = 50) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/runs?limit=${encodeURIComponent(limit)}`);
}

async function getRun(id) {
  const serverUrl = await getServerUrl();
  return fetchJson(`${serverUrl}/api/runs/${encodeURIComponent(id)}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Local Codex bridge returned HTTP ${response.status}`);
  }
  return data;
}

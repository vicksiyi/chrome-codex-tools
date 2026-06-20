const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(["serverUrl"]);
  if (!stored.serverUrl) {
    await chrome.storage.sync.set({ serverUrl: DEFAULT_SERVER_URL });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RUN_CODEX_TASK") {
    runCodexTask(message.payload)
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

  return false;
});

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get(["serverUrl"]);
  return normalizeServerUrl(serverUrl || DEFAULT_SERVER_URL);
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

async function runCodexTask(payload) {
  const serverUrl = await getServerUrl();
  const response = await fetch(`${serverUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Local Codex bridge returned HTTP ${response.status}`);
  }
  return data;
}

async function checkHealth() {
  const serverUrl = await getServerUrl();
  const response = await fetch(`${serverUrl}/api/health`, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Local Codex bridge returned HTTP ${response.status}`);
  }
  return data;
}

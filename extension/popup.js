const TASKS = {
  summarize: {
    label: "总结",
    instruction: "请用简体中文总结这个网页。输出：1）一句话概览；2）5-8条要点；3）值得继续阅读或验证的点。"
  },
  translate: {
    label: "翻译中文",
    instruction: "请把这个网页的主要内容翻译成自然、准确的简体中文。保留标题和层级；删去重复导航、广告、页脚等噪音。"
  },
  keypoints: {
    label: "提取重点",
    instruction: "请从这个网页中提取关键信息。输出：核心结论、关键事实、数字/日期/名称、潜在风险或不确定性。"
  },
  qa: {
    label: "问答准备",
    instruction: "请基于这个网页准备一份问答速查。输出10个可能被问到的问题，并给出简洁答案。"
  }
};

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

const elements = {
  pageMeta: document.querySelector("#pageMeta"),
  healthButton: document.querySelector("#healthButton"),
  taskButtons: Array.from(document.querySelectorAll(".task-button")),
  customPrompt: document.querySelector("#customPrompt"),
  runCustomButton: document.querySelector("#runCustomButton"),
  serverUrl: document.querySelector("#serverUrl"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  statusText: document.querySelector("#statusText"),
  progress: document.querySelector("#progress"),
  resultText: document.querySelector("#resultText"),
  copyButton: document.querySelector("#copyButton")
};

let latestResult = "";
let currentPage = null;

init();

async function init() {
  await loadSettings();
  bindEvents();
  await refreshPagePreview();
  await runHealthCheck(false);
}

function bindEvents() {
  elements.taskButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const task = TASKS[button.dataset.task];
      if (task) {
        runTask(task.label, task.instruction);
      }
    });
  });

  elements.runCustomButton.addEventListener("click", () => {
    const instruction = elements.customPrompt.value.trim();
    if (!instruction) {
      setStatus("请先输入自定义指令。", "error");
      return;
    }
    runTask("自定义指令", instruction);
  });

  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.healthButton.addEventListener("click", () => runHealthCheck(true));
  elements.copyButton.addEventListener("click", copyResult);
}

async function loadSettings() {
  const { serverUrl } = await chrome.storage.sync.get(["serverUrl"]);
  elements.serverUrl.value = serverUrl || DEFAULT_SERVER_URL;
}

async function saveSettings() {
  const serverUrl = normalizeServerUrl(elements.serverUrl.value || DEFAULT_SERVER_URL);
  elements.serverUrl.value = serverUrl;
  await chrome.storage.sync.set({ serverUrl });
  setStatus("本地服务地址已保存。");
  await runHealthCheck(false);
}

async function refreshPagePreview() {
  try {
    currentPage = await extractCurrentPage();
    const source = currentPage.selectionOnly ? "已选中文本" : "当前网页";
    const length = currentPage.text.length.toLocaleString("zh-CN");
    elements.pageMeta.textContent = `${source} · ${length} 字符`;
  } catch (error) {
    elements.pageMeta.textContent = "无法读取当前网页";
    setStatus(error.message, "error");
  }
}

async function extractCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有找到当前标签页。");
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (error) {
    if (!String(error.message || "").includes("Cannot access")) {
      throw error;
    }
    throw new Error("这个页面不允许扩展读取内容，请换一个普通网页重试。");
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PAGE" });
  if (!response?.ok) {
    throw new Error(response?.error || "读取网页内容失败。");
  }
  if (!response.page?.text) {
    throw new Error("当前页没有提取到可分析文本。");
  }
  return response.page;
}

async function runTask(taskName, instruction) {
  setBusy(true, `${taskName}处理中，Codex 可能需要几十秒...`);

  try {
    currentPage = await extractCurrentPage();
    const response = await chrome.runtime.sendMessage({
      type: "RUN_CODEX_TASK",
      payload: {
        taskName,
        instruction,
        page: currentPage
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "调用本地 Codex 失败。");
    }

    latestResult = response.data.result || "";
    elements.resultText.textContent = latestResult || "Codex 没有返回内容。";
    elements.copyButton.disabled = !latestResult;
    setStatus(`完成，用时 ${response.data.elapsedMs}ms。`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
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

async function copyResult() {
  if (!latestResult) {
    return;
  }
  await navigator.clipboard.writeText(latestResult);
  setStatus("结果已复制。");
}

function setBusy(isBusy, message = "") {
  elements.progress.hidden = !isBusy;
  elements.taskButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  elements.runCustomButton.disabled = isBusy;
  if (message) {
    setStatus(message);
  }
}

function setStatus(message, type = "info") {
  elements.statusText.textContent = message;
  elements.statusText.style.color = type === "error" ? "var(--danger)" : "var(--muted)";
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

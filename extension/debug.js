const elements = {
  serverMeta: document.querySelector("#serverMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  healthButton: document.querySelector("#healthButton"),
  runCount: document.querySelector("#runCount"),
  runList: document.querySelector("#runList"),
  selectedRunId: document.querySelector("#selectedRunId"),
  detailTask: document.querySelector("#detailTask"),
  detailSession: document.querySelector("#detailSession"),
  detailStatus: document.querySelector("#detailStatus"),
  detailInputSource: document.querySelector("#detailInputSource"),
  detailPage: document.querySelector("#detailPage"),
  detailElapsed: document.querySelector("#detailElapsed"),
  detailInstruction: document.querySelector("#detailInstruction"),
  detailRequest: document.querySelector("#detailRequest"),
  detailPrompt: document.querySelector("#detailPrompt"),
  detailRawOutput: document.querySelector("#detailRawOutput"),
  detailNormalizedOutput: document.querySelector("#detailNormalizedOutput"),
  detailWarnings: document.querySelector("#detailWarnings"),
  detailError: document.querySelector("#detailError"),
  statusText: document.querySelector("#statusText")
};

let activeRunId = "";

init();

function init() {
  bindEvents();
  refreshAll();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", refreshAll);
  elements.healthButton.addEventListener("click", runHealthCheck);
}

async function refreshAll() {
  try {
    setBusy(true);
    await runHealthCheck();
    await refreshRuns();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function runHealthCheck() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "HEALTH_CHECK" });
    if (!response?.ok) {
      throw new Error(response?.error || "健康检查失败。");
    }

    elements.serverMeta.textContent = `Codex: ${response.data.codexPath} · DB: ${response.data.dbPath || "未知"}`;
    document.querySelector(".debug-header")?.classList.remove("is-error");
    document.querySelector(".debug-header")?.classList.add("is-ok");
    setStatus("本地服务正常。");
  } catch (error) {
    elements.serverMeta.textContent = "本地服务不可用";
    document.querySelector(".debug-header")?.classList.remove("is-ok");
    document.querySelector(".debug-header")?.classList.add("is-error");
    setStatus(error.message, "error");
  }
}

async function refreshRuns() {
  const response = await chrome.runtime.sendMessage({ type: "GET_RUNS", limit: 50 });
  if (!response?.ok) {
    throw new Error(response?.error || "读取运行记录失败。");
  }

  const runs = response.data.runs || [];
  elements.runCount.textContent = String(runs.length);
  elements.runList.textContent = "";

  runs.forEach((run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "run-item",
      run.id === activeRunId ? "is-active" : "",
      run.status === "failed" ? "is-failed" : ""
    ].filter(Boolean).join(" ");
    button.dataset.runId = run.id;
    button.innerHTML = `
      <div class="run-title"></div>
      <div class="run-meta"></div>
    `;
    button.querySelector(".run-title").textContent = `${run.toolTitle}${run.status === "failed" ? " · 错误" : ""}`;
    button.querySelector(".run-meta").textContent = `${formatTime(run.createdAt)} · ${run.pageTitle || run.pageUrl || "无网页标题"}`;
    button.addEventListener("click", () => loadRun(run.id));
    elements.runList.append(button);
  });

  if (!runs.length) {
    elements.runList.append(renderEmptyState("暂无工具运行记录"));
  }

  if (runs.length && !activeRunId) {
    await loadRun(runs[0].id);
  }
}

async function loadRun(id) {
  activeRunId = id;
  const response = await chrome.runtime.sendMessage({ type: "GET_RUN", id });
  if (!response?.ok) {
    setStatus(response?.error || "读取运行详情失败。", "error");
    return;
  }

  const run = response.data.run;
  elements.selectedRunId.textContent = run.id;
  elements.detailTask.textContent = `${run.toolTitle || "-"} (${run.toolId || "-"})`;
  elements.detailSession.textContent = run.sessionId || "-";
  elements.detailStatus.textContent = run.status || "-";
  elements.detailInputSource.textContent = formatInputSource(run.inputSource);
  elements.detailPage.textContent = `${run.pageTitle || "-"}\n${run.pageUrl || ""}`;
  elements.detailElapsed.textContent = run.elapsedMs === null ? "-" : `${run.elapsedMs}ms`;
  elements.detailInstruction.value = run.instruction || "";
  elements.detailRequest.value = run.requestJson || "";
  elements.detailPrompt.value = run.prompt || "";
  elements.detailRawOutput.value = run.rawOutput || "";
  elements.detailNormalizedOutput.value = run.normalizedOutputJson || JSON.stringify(run.normalizedOutput || {}, null, 2);
  elements.detailWarnings.value = (run.normalizationWarnings || []).join("\n");
  elements.detailError.value = [run.error, run.stderr].filter(Boolean).join("\n\n");

  Array.from(elements.runList.querySelectorAll(".run-item")).forEach((item) => {
    item.classList.toggle("is-active", item.dataset.runId === run.id);
  });
  setStatus(`已加载运行：${run.id}`);
}

function setStatus(message, type = "info") {
  elements.statusText.textContent = message;
  elements.statusText.classList.toggle("is-error", type === "error");
}

function setBusy(isBusy) {
  elements.refreshButton.disabled = isBusy;
  elements.healthButton.disabled = isBusy;
}

function renderEmptyState(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
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

function formatInputSource(value) {
  if (value === "selection") {
    return "选中文本";
  }
  if (value === "manual") {
    return "手动输入";
  }
  return "当前网页";
}

(() => {
  if (window.__CODEX_WEB_ASSISTANT_LOADED__) {
    return;
  }
  window.__CODEX_WEB_ASSISTANT_LOADED__ = true;

  const MAX_TEXT_LENGTH = 60000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXTRACT_PAGE") {
      return false;
    }

    try {
      sendResponse({ ok: true, page: extractPage() });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }

    return false;
  });

  function extractPage() {
    const selection = getSelectionText();
    const articleRoot = pickArticleRoot();
    const text = selection || extractReadableText(articleRoot || document.body);
    const headings = Array.from(document.querySelectorAll("h1, h2"))
      .map((heading) => cleanText(heading.textContent))
      .filter(Boolean)
      .slice(0, 20);

    return {
      title: document.title || "",
      url: location.href,
      lang: document.documentElement.lang || "",
      description: getMeta("description") || getMeta("og:description") || "",
      headings,
      selectionOnly: Boolean(selection),
      text: truncateText(text, MAX_TEXT_LENGTH)
    };
  }

  function pickArticleRoot() {
    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".article",
      ".post",
      ".content",
      "#content"
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((node) => node && node.textContent && cleanText(node.textContent).length > 300);

    candidates.sort((a, b) => cleanText(b.textContent).length - cleanText(a.textContent).length);
    return candidates[0] || null;
  }

  function extractReadableText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, footer, header, form, button, input, textarea, select, aside").forEach((node) => node.remove());

    const blocks = Array.from(clone.querySelectorAll("h1, h2, h3, p, li, blockquote, pre, td, th"))
      .map((node) => cleanText(node.textContent))
      .filter(Boolean);

    const uniqueBlocks = [];
    const seen = new Set();

    for (const block of blocks) {
      const key = block.toLowerCase();
      if (block.length < 2 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueBlocks.push(block);
    }

    return uniqueBlocks.join("\n\n") || cleanText(clone.textContent);
  }

  function getSelectionText() {
    const selection = window.getSelection();
    return cleanText(selection ? selection.toString() : "");
  }

  function getMeta(name) {
    const escaped = CSS.escape(name);
    const node = document.querySelector(`meta[name="${escaped}"], meta[property="${escaped}"]`);
    return node?.getAttribute("content") || "";
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function truncateText(value, maxLength) {
    const text = cleanText(value);
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}\n\n[Content truncated by extension at ${maxLength} characters.]`;
  }
})();

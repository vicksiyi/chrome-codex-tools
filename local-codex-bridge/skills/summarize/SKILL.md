---
id: summarize
title: AI 阅读卡片
icon: AI
description: 用简体中文快速概览网页或选中文本，并生成可复用、自包含的 HTML 摘要卡片。
inputModes: selection,page
instruction: 请基于网页内容或选中文本生成一个可复用的 HTML 摘要卡片。卡片需包含一句话概览、5-8 条关键要点、值得继续阅读/验证/追问的点。必须忠实于输入内容，不补充网页中没有提供的信息。输出 html 卡片，HTML 应自包含、结构清晰、语义化；不要包含 script、外链资源、表单提交、自动跳转或危险内联事件。可使用简洁内联样式。若输入信息不足，请在卡片中明确标注“信息不足”。
preferredRenderTypes: html,markdown
allowHtmlPreview: true
requiresNetwork: false
requiresFilesystem: false
---
# AI 阅读卡片

请基于网页内容或选中文本，使用简体中文生成一个可复用的 HTML 摘要卡片。

输出要求：
- 优先输出 `html` 卡片片段，不要只输出 Markdown。
- HTML 必须自包含，适合嵌入页面或笔记中。
- 使用语义化结构，建议包含：
  - 标题区：使用网页标题；如无法识别，使用“AI 阅读摘要”。
  - 一句话概览。
  - 5-8 条关键要点。
  - 值得继续阅读、验证或追问的点。
- 保持忠实：不要补充网页中没有提供的信息。
- 对不确定、缺失或原文未说明的信息，明确写“原文未说明”或“信息不足”。
- 可使用简洁内联样式，让卡片清晰、紧凑、易读。
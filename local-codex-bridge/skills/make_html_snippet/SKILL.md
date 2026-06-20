---
id: make_html_snippet
title: HTML 片段生成
icon: <>
description: 基于网页内容或选中文本生成可复用 HTML 片段。
inputModes: selection,page
instruction: 请基于网页内容生成一个可复用 HTML 片段。输出 html 卡片，HTML 应自包含、结构清晰、不要包含 script、外链资源或表单提交。
preferredRenderTypes: markdown,html
allowHtmlPreview: true
requiresNetwork: false
requiresFilesystem: false
---
# HTML 片段生成

请基于网页内容生成一个可复用 HTML 片段。

要求：
- 输出 `html` 卡片，HTML 应自包含、结构清晰、语义化。
- 不要包含 `script`、外链资源、表单提交、自动跳转或危险内联事件。
- 可使用内联样式，但保持简洁。
- 如有必要，用 `markdown` 卡片解释结构和复用方式。

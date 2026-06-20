---
id: qa
title: 问答准备
icon: ?
description: 基于网页内容生成可快速查阅的问题和答案。
inputModes: selection,page
instruction: 请基于网页准备一份问答速查。输出 10 个可能被问到的问题，并给出简洁答案。
preferredRenderTypes: markdown,table
allowHtmlPreview: false
requiresNetwork: false
requiresFilesystem: false
---
# 问答准备

请基于网页内容准备一份问答速查。

要求：
- 输出 10 个可能被问到的问题。
- 每个答案应简洁、可直接引用，并注明不确定信息。
- 如果网页内容不足以回答某个自然问题，请明确说明“材料未提供”。

优先使用 `table` 卡片组织问题和答案，也可以用 `markdown` 做摘要。

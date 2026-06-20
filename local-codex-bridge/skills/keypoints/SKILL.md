---
id: keypoints
title: 提取重点
icon: 点
description: 提取核心结论、关键事实、数字、日期、名称、风险和不确定性。
inputModes: selection,page
instruction: 请提取网页关键信息。输出核心结论、关键事实、数字/日期/名称、潜在风险或不确定性。优先使用 kv 和 table 卡片表达结构化信息。
preferredRenderTypes: markdown,kv,table
allowHtmlPreview: false
requiresNetwork: false
requiresFilesystem: false
---
# 提取重点

请提取网页中的关键信息，优先把事实结构化。

输出应覆盖：
- 核心结论。
- 关键事实。
- 数字、日期、名称、地点、链接文本等可核对信息。
- 潜在风险、不确定性、限制条件。

优先使用 `kv` 和 `table` 卡片表达结构化信息；必要时用 `markdown` 补充解释。

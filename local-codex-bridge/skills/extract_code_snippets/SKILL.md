---
id: extract_code_snippets
title: 代码片段提取
icon: {}
description: 从技术文档或文章里提取命令、API、配置和代码片段。
inputModes: selection,page
instruction: 请从网页中提取有复用价值的代码、命令、API 示例、配置片段。用 code 卡片输出片段，并用 markdown 卡片说明上下文和注意事项。
preferredRenderTypes: markdown,code
allowHtmlPreview: false
requiresNetwork: false
requiresFilesystem: false
---
# 代码片段提取

请从网页中提取有复用价值的代码、命令、API 示例、配置片段。

要求：
- 每段代码或命令使用 `code` 卡片输出，并设置合适的 language。
- 用 `markdown` 卡片说明片段的上下文、适用条件和注意事项。
- 不要改写代码语义；如果需要修正明显格式问题，请说明。
- 不要执行代码，也不要访问外部链接。

# Chrome Codex Tools

一个本地优先的浏览器网页阅读助手：通过 Chrome / Edge 扩展提取当前网页或选中文本，再经本机桥接服务调用 `codex exec` 完成总结、翻译、重点提取和自定义分析。

它适合用在资料阅读、技术文档理解、新闻/报告速读、网页内容结构化整理等场景。所有分析请求默认在本机完成，不需要把扩展做成云端服务。

## 功能特性

- 总结当前网页正文。
- 将网页主要内容翻译成中文。
- 提取关键事实、日期、数字、名称、风险点。
- 生成问答速查。
- 支持对当前选中文本运行任务。
- 支持自定义指令。
- 支持配置本地 Codex 桥接服务地址。
- 本地服务默认只监听 `127.0.0.1`。
- 默认使用 `codex exec --sandbox read-only --ephemeral` 执行只读任务。

## 项目结构

```text
.
├── extension/              # Chrome / Edge Manifest V3 扩展
│   ├── manifest.json
│   ├── background.js       # 扩展后台脚本，转发请求到本地服务
│   ├── content.js          # 网页正文和选中文本提取
│   ├── popup.html
│   ├── popup.css
│   └── popup.js            # 弹窗交互逻辑
├── local-codex-bridge/
│   └── server.js           # 本机 HTTP 桥接服务
├── scripts/
│   ├── check.sh
│   └── start.sh
├── package.json
└── README.md
```

## 工作原理

1. 浏览器扩展在当前标签页注入 `content.js`。
2. `content.js` 提取页面标题、URL、描述、标题结构、正文或选中文本。
3. `popup.js` 将任务指令和页面内容发送给扩展后台脚本。
4. `background.js` 请求本机桥接服务。
5. `local-codex-bridge/server.js` 调用本机 `codex exec`。
6. Codex 返回结果后展示在扩展弹窗中，可一键复制。

## 环境要求

- Node.js 18+
- Chrome 或 Microsoft Edge
- 本机可用的 Codex CLI

桥接服务会按顺序寻找 Codex：

1. 环境变量 `CODEX_BIN`
2. `/Applications/Codex.app/Contents/Resources/codex`
3. `codex` 命令

## 快速开始

启动本地桥接服务：

```bash
npm start
```

也可以直接运行：

```bash
node local-codex-bridge/server.js
```

如果 Codex 不在默认位置：

```bash
CODEX_BIN="/path/to/codex" npm start
```

安装浏览器扩展：

1. 打开 Chrome 或 Edge 的扩展管理页面。
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目的 `extension/` 目录。
5. 打开任意普通网页，点击工具栏中的 **Codex Web Assistant**。

## 配置项

本地桥接服务支持以下环境变量：

```bash
CODEX_BIN="/path/to/codex"
CODEX_WEB_ASSISTANT_HOST="127.0.0.1"
CODEX_WEB_ASSISTANT_PORT="8787"
CODEX_WEB_ASSISTANT_TIMEOUT_MS="180000"
CODEX_WEB_ASSISTANT_MAX_TEXT="60000"
CODEX_WEB_ASSISTANT_MAX_BODY="900000"
CODEX_WEB_ASSISTANT_DEBUG="0"
```

扩展默认连接：

```text
http://127.0.0.1:8787
```

你也可以在扩展弹窗里修改本地服务地址。

## 开发检查

运行语法检查：

```bash
npm run check
```

等价于：

```bash
sh scripts/check.sh
```

## 安全说明

- 本地桥接服务默认只绑定 `127.0.0.1`，不会对局域网开放。
- 服务端会拒绝普通网页来源的请求，只允许浏览器扩展来源或本机无 Origin 请求访问。
- 扩展只发送提取到的网页文本和任务指令，不会主动访问页面中的链接。
- 服务端提示词会要求 Codex 忽略网页正文中的指令，降低网页提示注入风险。
- 默认使用只读沙箱和临时会话：`codex exec --sandbox read-only --ephemeral`。
- 不建议把敏感网页内容交给不可信模型、插件或配置。

## 常见问题

### 扩展提示本地服务不可用

先确认本地桥接服务正在运行：

```bash
npm start
```

然后点击扩展右上角状态圆点做健康检查。

### 某些页面无法读取

浏览器扩展通常无法读取 `chrome://`、扩展商店、浏览器设置页、部分 PDF 查看页，以及受浏览器保护的页面。请换一个普通网页重试。

### 页面内容提取不完整

扩展会优先提取 `article`、`main`、`[role="main"]` 等正文区域。如果页面结构非常特殊，可以先手动选中需要分析的文本，再运行任务。

## License

未指定。发布前请根据项目用途补充许可证。

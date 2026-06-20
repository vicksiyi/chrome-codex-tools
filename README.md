# Chrome Codex Tools

一个本地优先的浏览器网页上下文工具面板：通过 Chrome / Edge 侧边栏扩展提取当前网页或选中文本，再经本机 TypeScript 桥接服务调用 `codex exec`，把结果规范化成可渲染卡片。

它适合用在资料阅读、技术文档理解、新闻/报告速读、网页内容结构化整理，以及从网页上下文生成代码或 HTML 片段等场景。所有分析请求默认在本机完成，不需要把扩展做成云端服务。

## 功能特性

- 从 bridge 侧工具注册表动态读取内置工具。
- 内置工具：AI 阅读、翻译、提取重点、问答准备、代码片段提取、HTML 片段生成、自定义指令。
- 自动优先使用当前选中文本；没有选中文本时使用当前网页正文。
- 统一返回 `cards[]`，支持 `markdown`、`code`、`html`、`table`、`kv` 五种渲染类型。
- HTML 卡默认展示源码；只有工具显式允许时才提供严格 sandbox 预览。
- 自定义指令作为内置工具 `custom_prompt` 运行，结果默认展示为 Markdown 卡。
- 点击扩展图标后以浏览器侧边栏形式打开。
- 切换标签页后自动同步当前活动网页，运行任务前会重新读取当前网页。
- 侧边栏左侧维护内置技能、最近运行和历史 Session，可点击技能直接运行，点击历史项切换上下文。
- 维护「新对话」按钮；默认所有运行都基于当前 Session，只有新建对话或切换历史 Session 才改变上下文。
- 使用 SQLite 保存 Session、消息、工具运行记录和自定义指令历史。
- 本地 Session 会映射到 Codex CLI Session；继续当前对话时使用 `codex exec resume` 对齐 Codex 的历史上下文。
- 普通侧边栏显示运行状态、耗时、失败原因和 Debug ID；debug 页面查看完整 prompt、原始输出、规范化 JSON、警告和错误。
- 本地保存历史服务地址。
- 支持配置本地 Codex 桥接服务地址。
- 本地服务默认只监听 `127.0.0.1`。
- 默认使用 `codex exec --sandbox read-only` 执行只读任务，并为每个本地 Session 维护对应的 Codex Session。

## 项目结构

```text
.
├── extension/              # Chrome / Edge Manifest V3 扩展
│   ├── manifest.json
│   ├── background.js       # 扩展后台脚本，转发请求到本地服务
│   ├── content.js          # 网页正文和选中文本提取
│   ├── debug.html          # 调试页面
│   ├── debug.css
│   ├── debug.js
│   ├── icons/              # 扩展图标资源
│   ├── popup.html          # 侧边栏页面
│   ├── popup.css
│   └── popup.js            # 侧边栏交互逻辑
├── local-codex-bridge/
│   ├── server.ts           # 本机 TypeScript HTTP 桥接服务入口
│   ├── src/                # 配置、HTTP、SQLite、Prompt、Codex、SKILL 注册表等模块
│   └── skills/             # 内置工具的 SKILL.md 文件
├── scripts/
│   ├── autostart.sh        # macOS 登录自启动安装/卸载脚本
│   ├── daemon.sh           # 后台守护进程启动/停止脚本
│   ├── check.sh
│   ├── stop.sh             # 统一关闭本地桥接服务
│   └── start.sh
├── package.json
├── test/
│   └── server.test.ts
└── README.md
```

## 工作原理

1. 浏览器扩展在当前标签页注入 `content.js`。
2. `content.js` 提取页面标题、URL、描述、标题结构、正文或选中文本。
3. 侧边栏页面从 bridge 拉取工具清单、最近运行和历史 Session，并将工具 ID、当前 Session、页面内容和可选自定义指令发送给扩展后台脚本。
4. `background.js` 请求本机 TypeScript 桥接服务。
5. `local-codex-bridge/server.ts` 作为兼容入口加载 `src/` 模块；bridge 根据 SKILL 注册表和当前 Session 构造 prompt，写入 SQLite ToolRun，并调用本机 `codex exec` 或 `codex exec resume`。
6. bridge 解析 Codex 输出，校验并规范化成 `cards[]`；如果结构化失败但有文本输出，会降级成 Markdown 卡并记录 warning。
7. 侧边栏按 `renderType` 渲染卡片；Markdown 和安全 HTML 预览放进严格 sandbox 的 iframe，源码保留在卡片内可复制；debug 页面保留完整 prompt、原始输出和规范化 JSON。

侧边栏会监听标签页激活、页面加载完成和窗口焦点变化；每次运行任务前也会重新抽取当前活动标签页，避免继续使用打开侧边栏时的旧网页内容。

## 工具协议

内置工具定义在 `local-codex-bridge/skills/*/SKILL.md`。bridge 会读取这些 SKILL，并按“插件 System Prompt + 已加载 SKILL + 用户/任务指令 + 页面上下文”的结构构造最终 Codex prompt。`local-codex-bridge/src/skills.ts` 负责 SKILL 发现、元数据解析和工具清单输出。

自定义 SKILL 可以通过环境变量追加目录：

```bash
CODEX_WEB_ASSISTANT_SKILL_DIRS="/path/to/custom-skills" npm start
```

目录可以直接包含 `SKILL.md`，也可以包含多个子目录，每个子目录下放一个 `SKILL.md`。

扩展启动后通过内部本地 API 读取工具清单：

```text
GET /api/tools
POST /api/tools/:toolId/runs
GET /api/runs
GET /api/runs/:id
GET /api/sessions
POST /api/sessions
GET /api/sessions/:id
```

这不是公开插件 API；当前只作为本机扩展和 bridge 之间的内部协议使用。代码结构按稳定协议组织，后续可以演进为本地可插拔工具。

一次工具运行返回一个 `ToolRun`，核心结果为：

```json
{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [
    {
      "title": "卡片标题",
      "renderType": "markdown",
      "content": {
        "markdown": "卡片内容"
      }
    }
  ]
}
```

第一阶段支持的 `renderType`：`markdown`、`code`、`html`、`table`、`kv`。

## 环境要求

- Node.js 24+
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
node local-codex-bridge/server.ts
```

如果 Codex 不在默认位置：

```bash
CODEX_BIN="/path/to/codex" npm start
```

关闭本地桥接服务：

```bash
npm stop
```

安装浏览器扩展：

1. 打开 Chrome 或 Edge 的扩展管理页面。
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目的 `extension/` 目录。
5. 打开任意普通网页，点击工具栏中的 **Codex Web Assistant**，扩展会在浏览器侧边栏中打开。

## 配置项

本地桥接服务支持以下环境变量：

```bash
CODEX_BIN="/path/to/codex"
CODEX_WEB_ASSISTANT_HOST="127.0.0.1"
CODEX_WEB_ASSISTANT_PORT="8787"
CODEX_WEB_ASSISTANT_TIMEOUT_MS="180000"
CODEX_WEB_ASSISTANT_MAX_TEXT="60000"
CODEX_WEB_ASSISTANT_MAX_BODY="900000"
CODEX_WEB_ASSISTANT_DB_PATH="/path/to/history.sqlite"
CODEX_WEB_ASSISTANT_DEBUG="0"
```

扩展默认连接：

```text
http://127.0.0.1:8787
```

你也可以在扩展侧边栏里修改本地服务地址。

## 后台守护进程运行

如果不想让终端一直占着前台，可以用 daemon 脚本把本地桥接服务放到后台运行。

启动：

```bash
sh scripts/daemon.sh start
```

如果你的环境有 `npm`：

```bash
npm run daemon:start
```

查看状态：

```bash
sh scripts/daemon.sh status
```

查看日志：

```bash
sh scripts/daemon.sh logs
```

重启：

```bash
sh scripts/daemon.sh restart
```

停止：

```bash
sh scripts/daemon.sh stop
```

也可以使用统一关闭脚本：

```bash
npm stop
```

默认 PID 文件和日志位置：

```text
~/.local/state/chrome-codex-tools/bridge.pid
~/Library/Logs/chrome-codex-tools/bridge.out.log
~/Library/Logs/chrome-codex-tools/bridge.err.log
```

如果 `node` 或 `codex` 不在常规路径，可以在启动时指定绝对路径：

```bash
NODE_BIN="/path/to/node" CODEX_BIN="/path/to/codex" sh scripts/daemon.sh start
```

这个脚本适合手动后台运行当前服务；如果需要登录后自动启动，请使用下面的 macOS LaunchAgent 自启动脚本。

## SQLite 历史与调试

本地桥接服务会使用 SQLite 保存：

- 历史 Session，以及它映射到的 Codex CLI Session ID。
- Session 内的用户消息、工具运行消息和规范化卡片结果。
- 每次工具运行的工具 ID、输入来源、网页元数据、提交给 Codex 的完整 prompt、原始输出、规范化输出、warning、错误和耗时。
- 最近使用过的自定义指令。

macOS 默认数据库路径：

```text
~/Library/Application Support/chrome-codex-tools/history.sqlite
```

其他系统默认路径：

```text
~/.local/state/chrome-codex-tools/history.sqlite
```

侧边栏左侧的「技能」来自 bridge 的 SKILL 注册表；「最近运行」来自 SQLite ToolRun；「Session」来自本地会话表。下一次运行会创建新的本地 Session 和新的 Codex Session；点击历史 Session 会恢复对应上下文并继续通过 `codex exec resume` 运行。

「历史指令」下拉菜单只服务于 `custom_prompt`。debug 页面会显示更多 SQLite 历史指令、Session 和工具运行记录。

历史服务地址仍使用 `chrome.storage.local` 保存在浏览器本地，不使用 `chrome.storage.sync` 做账号同步。

## Debug 页面

侧边栏右上角菜单中点击「调试页面」可以打开 debug 页面。它会展示：

- 本地服务健康状态和 SQLite 数据库路径。
- 最近工具运行记录。
- 每次运行所属的 Session ID。
- 每次运行提交给 Codex 的完整 prompt。
- 原始输入 JSON，包括网页标题、URL、正文或选中文本。
- Codex 原始输出、规范化输出 JSON、warning、stderr 和错误信息。
- SQLite 历史指令列表。

也可以直接打开扩展内页面：

```text
chrome-extension://<extension-id>/debug.html
```

## 扩展图标

扩展图标位于 `extension/icons/`：

```text
icon-16.png
icon-32.png
icon-48.png
icon-128.png
```

`manifest.json` 已将这些图标同时配置为扩展图标和工具栏图标。`icon-source.png` 是生成原图，`icon-master.png` 是带透明圆角的主图。

## macOS 开机自启动

仓库提供了用户级 LaunchAgent 安装脚本，用来在 macOS 登录后自动启动本地桥接服务。

安装并立即启动：

```bash
sh scripts/autostart.sh install
```

如果你的环境有 `npm`：

```bash
npm run autostart:install
```

安装脚本会生成：

```text
~/Library/LaunchAgents/com.vicksiyi.chrome-codex-tools.bridge.plist
```

服务日志会写入：

```text
~/Library/Logs/chrome-codex-tools/bridge.out.log
~/Library/Logs/chrome-codex-tools/bridge.err.log
```

查看状态：

```bash
sh scripts/autostart.sh status
```

重启服务：

```bash
sh scripts/autostart.sh restart
```

停止当前已加载的 LaunchAgent 服务：

```bash
sh scripts/autostart.sh stop
```

如果你的环境有 `npm`：

```bash
npm run autostart:stop
```

卸载自启动：

```bash
sh scripts/autostart.sh uninstall
```

如果 `node` 或 `codex` 不在常规路径，可以在安装时指定绝对路径：

```bash
NODE_BIN="/path/to/node" CODEX_BIN="/path/to/codex" sh scripts/autostart.sh install
```

注意：这是 macOS 用户登录后的自启动，不是系统级后台服务；不需要 `sudo`。`stop` 只停止当前已加载的服务，不删除 plist；`uninstall` 会同时停止并删除自启动配置。

## 开发检查

运行语法检查：

```bash
npm run check
```

等价于：

```bash
sh scripts/check.sh
```

运行单测：

```bash
npm test
```

当前测试使用 Node 内置 `node:test`，覆盖 SKILL 注册表、prompt 构建、Codex 输出解析与降级、SQLite ToolRun/Session 记录、Codex Session resume 映射，以及 HTTP API。项目使用 Node 24 的 TypeScript type stripping 直接运行 `server.ts`，不需要单独构建步骤。

## 安全说明

- 本地桥接服务默认只绑定 `127.0.0.1`，不会对局域网开放。
- 服务端会拒绝普通网页来源的请求，只允许浏览器扩展来源或本机无 Origin 请求访问。
- 扩展只发送提取到的网页文本和任务指令，不会主动访问页面中的链接。
- 服务端提示词会要求 Codex 忽略网页正文中的指令，降低网页提示注入风险。
- 服务端会规范化模型输出；结构化失败时降级成 Markdown 卡片并记录 warning。
- HTML 卡片默认只展示源码；sandbox 预览只有工具显式允许时才出现，并由扩展加入严格 CSP。
- 默认使用只读沙箱：`codex exec --sandbox read-only`；历史对话通过 `codex exec resume` 复用对应 Codex Session。
- 不建议把敏感网页内容交给不可信模型、插件或配置。

## 常见问题

### 扩展提示本地服务不可用

先确认本地桥接服务正在运行：

```bash
npm start
```

然后点击扩展右上角状态圆点做健康检查。

如果你安装了自启动，可以查看 LaunchAgent 状态和错误日志：

```bash
sh scripts/autostart.sh status
tail -n 80 ~/Library/Logs/chrome-codex-tools/bridge.err.log
```

### 某些页面无法读取

浏览器扩展通常无法读取 `chrome://`、扩展商店、浏览器设置页、部分 PDF 查看页，以及受浏览器保护的页面。请换一个普通网页重试。

### 页面内容提取不完整

扩展会优先提取 `article`、`main`、`[role="main"]` 等正文区域。如果页面结构非常特殊，可以先手动选中需要分析的文本，再运行任务。

## License

未指定。发布前请根据项目用途补充许可证。

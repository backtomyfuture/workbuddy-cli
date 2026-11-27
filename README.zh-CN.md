<div align="center">

# workbuddy-cli

**零依赖的腾讯 WorkBuddy 命令行工具 —— 支持独立浏览器登录、实时扫描最新模型，无需保持桌面端常驻。**

[![npm version](https://img.shields.io/npm/v/workbuddy-cli.svg)](https://www.npmjs.com/package/workbuddy-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 为什么选择 `workbuddy-cli`？

- **独立登录，无需开着客户端**：运行一次 `workbuddy login` 完成浏览器授权后，即可彻底关闭 WorkBuddy 桌面端。凭据以 `0600` 权限独立保存并在过期时自动刷新。
- **零第三方依赖**：100% 基于 Node.js 原生内置模块（`fetch`、`net`、`crypto`、`child_process`），启动极速，体积极小。
- **实时扫描可用模型**：运行 `workbuddy models` 直接从服务端拉取当前账号可用模型、积分倍率与能力标签，上新模型无需等待 CLI 更新即可调用。
- **双通道自动容错**：CLI 已登录时直连 HTTPS；未登录时自动回退复用本地运行中的 WorkBuddy 桌面端 WBIPC 通道。
- **管道与脚本友好**：原生支持 Unix 管道（`cat log | workbuddy`）、结构化 `--json` 输出、自定义 `--system` 提示词及超短别名 `wb`。

---

## 快速开始

### 1. 安装

**通过 npm 全局安装（推荐）：**

```bash
npm install -g workbuddy-cli
```

或免安装直接运行：

```bash
npx workbuddy-cli login
```

<details>
<summary>其他安装方式（一键脚本 / 源码安装）</summary>

**一键脚本安装（macOS / Linux）：**

```bash
curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash
```

**手动克隆仓库：**

```bash
git clone https://github.com/backtomyfuture/workbuddy-cli.git
cd workbuddy-cli
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/workbuddy
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/wb
```

</details>

### 2. 登录并开始对话

```bash
# 浏览器扫码/账号授权登录（只需一次）
workbuddy login

# 实时扫描服务端当前可用模型
workbuddy models

# 开始对话（也可使用超短别名 wb）
wb "用 Python 写一个支持泛型的 LRU 缓存"
```

---

## 使用指南

### 子命令

| 命令 | 说明 |
| :--- | :--- |
| `workbuddy login` | 通过浏览器登录（SSH/无界面环境可加 `--no-browser` 打印链接） |
| `workbuddy logout` | 注销服务端会话并删除本地 CLI 凭据 |
| `workbuddy status` / `whoami` | 查看当前 CLI 登录状态、Token 过期时间及桌面端 WBIPC 状态 |
| `workbuddy models` / `-l` | 从服务端实时扫描可用模型（支持 `--all`、`--json`、`--static`） |
| `workbuddy sessions` | 列出本 CLI 保存的对话 |
| `workbuddy continue` / `-c` | 继续当前目录里最近的一条对话 |
| `workbuddy resume [id]` / `-r` | 按 id 继续某一条；省略 id 时列出对话 |
| `workbuddy acp` | 给 T3 Code 用的 ACP stdio 服务 |
| `workbuddy [选项] <提问内容>` | 向指定模型发起对话 |

### 常用选项

| 参数 | 说明 |
| :--- | :--- |
| `-c, --continue` | 继续当前目录最近的一条对话 |
| `-r, --resume [id]` | 按 id 继续；不写 id 时列出已保存对话 |
| `--session-id <id>` | 新建对话时指定 id |
| `-m, --model <id>` | 指定模型 ID 或简写别名（默认：`deepseek-v3-2-volc`） |
| `--effort <level>` | 思考等级：`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，或 `off`。继续对话时沿用上次的等级 |
| `-s, --system <prompt>` | 设定 System Prompt |
| `-p, --print` | 打印结果后退出（默认行为） |
| `--json` | 输出结构化 JSON（包含完整 `reasoning` 思考过程） |
| `--all` | 在 `models` 中包含生图等特殊标签模型 |
| `--static` | 不请求服务端，直接显示内置简写列表 |
| `--no-browser` | 不自动打开浏览器，仅打印登录链接 |
| `-h, --help` | 显示帮助信息 |

### 使用示例

```bash
# 指定模型或简写别名
wb -m hy4 "帮我写一封礼貌的英文跟进邮件"
wb -m deepseek-v4 "分析这段代码的时空复杂度"
wb -m glm "用三句话解释 Raft 共识算法"

# 直接调用 workbuddy models 扫描出的任意新模型 ID
wb -m <任意新模型ID> "你好！"

# 标准 Unix 管道
cat server.log | wb -p "提取所有 500 错误并分析原因"
git diff | wb -p "根据变更生成规范的 Commit Message"

# 设定 System Prompt 并输出 JSON
wb -s "你是一名资深 Go 开发专家" --json "如何避免 goroutine 泄漏？"

# 在 stderr 中附带模型思考过程
WORKBUDDY_SHOW_REASONING=1 wb -m deep "推理一下这道逻辑题..."

# 继续当前目录最近一次对话，或按 id 接着问
wb -c "把刚才的例子改成迭代版本"
wb sessions
wb resume wb_abc123 "补上测试"
```

> **常用简写别名**：内置支持 `auto`、`fast`、`balanced`、`deep`、`hy4`、`ds`（`deepseek`）、`deepseek-v4`、`glm`、`kimi`、`kimi-pro`、`minimax-flash`、`mimo`、`step` 等常见简写。完整实时模型列表请直接运行 `workbuddy models` 查看。

---

## 继续对话

每次成功的提问都会写到 `~/.workbuddy-cli/sessions/`。同一目录里再用 `-c` / `continue`，会把之前的消息一并送给 `/v2/chat/completions`。`resume <id>` 打开指定记录，id 写唯一前缀即可。`--json` 的结果里带 `sessionId`。

这些记录只属于 `workbuddy-cli`，和桌面端 CodeBuddy 自己的会话（`codebuddy -c` / `codebuddy -r`）不是同一份。

## 接到 T3 Code

T3 Code 会把本地 ACP 代理拉成子进程，用换行分隔的 JSON-RPC 走 stdin/stdout。

1. 让 T3 Code 服务所用的那个用户能在 PATH 里找到 `workbuddy`。
2. 用同一用户执行一次 `workbuddy login`。
3. 打开 **Settings → Providers → Add provider → Show more → Local ACP command**。
4. 命令填 `workbuddy`，参数填一行 `acp`，名称填 `WorkBuddy`。

服务端按 ACP v1 应答，常用方法如下：

| 方法 | 行为 |
| :--- | :--- |
| `initialize` | 声明 ACP v1、`loadSession` 和文本提示。未登录时广告终端登录，实际运行 `workbuddy login`。 |
| `authenticate` / `auth/logout` | 终端登录不走 RPC。logout 会注销 CLI 凭据。 |
| `session/new` | 按工作区 `cwd` 新建对话。 |
| `session/load`、`session/resume` | 读回记录并重放历史。 |
| `session/list` | 列出已保存对话。 |
| `session/prompt` | 流式发送 `agent_message_chunk` / `agent_thought_chunk`，结束后返回 `stopReason`。 |
| `session/cancel` | 中断当前这一轮。 |
| `session/close` | 只卸掉内存中的会话，磁盘记录还在。 |
| `session/set_model`、`session/set_config_option` | 切换后续轮次的模型。`thought_level` 是思考等级。 |
| `session/set_mode` | `plan` 时不改文件、不跑命令。 |

一轮对话里模型可以调用 `read_file`、`list_dir`、`write_file` 和 `bash`，最多 500 次模型调用。写文件、跑命令和读文件会先发 `session/request_permission`；T3 声明了 `fs/*` 时，读写走客户端，不直接碰磁盘。已登录时，T3 的模型列表就是 `workbuddy models` 扫到的可对话模型，默认选账号标记的第一个默认模型；生图、生视频不放进这个列表。支持推理的模型会在 `session/new` 里带 `thought_level` 和 `_meta.reasoningEfforts`，思考等级按该模型在服务端的配置给出。T3 Code 用这两项显示思考等级。工作空间沿用桌面端：`session/new` 的 `cwd`（也认 `workingDirectory`）就是项目目录，并带上系统、Shell、是否 Git 仓库和顶层文件。`additionalDirectories` 是额外放行目录。根目录的 `AGENTS.md` 或 `CODEBUDDY.md` 会放进提示。主目录和 `~/.t3/scratch` 草稿目录会说明不是项目。

桌面端自带的 CodeBuddy 也能说 ACP（`codebuddy --acp`）。这台机器上未解包的完整包需要 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1` 才能从现有入口启动。`workbuddy acp` 用的是本 CLI 自己的登录态和会话记录。

## 工作原理

```text
模式 A（推荐）：CLI 独立直连（无需启动桌面端）
┌─────────────────┐        HTTPS + Bearer Token (+ 自动刷新)       ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────────────────> │  Tencent Cloud Backend │
│  (Pure Node.js) │ <─────────────────────────────────────────────── │   (www.workbuddy.cn)   │
└─────────────────┘   ~/.workbuddy-cli/auth.json (0600 权限隔离)     └────────────────────────┘

模式 B（回退）：未登录 CLI 时自动复用桌面端 WBIPC
┌─────────────────┐      Unix Domain Socket (WBIPC)      ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────> │   WorkBuddy Desktop    │
└─────────────────┘   HMAC-SHA256 Handshake + JSON-RPC   └────────────────────────┘
```

1. **独立直连模式**：`workbuddy login` 通过外部链接授权轮询获取 Token 与账号信息，以 `0600` 权限保存在 `~/.workbuddy-cli/auth.json`（与桌面端配置完全隔离）。后续请求直接调用 `/v2/chat/completions` 与 `/v2/enterprises/.../models`，并在 Token 临期或返回 `401` 时自动刷新。
2. **WBIPC 桌面端回退**：若未执行 `workbuddy login`，CLI 会自动检测 `~/.workbuddy/wbipc/endpoint.json`，通过 HMAC-SHA256 握手经桌面端 `wb.request` 管线代理请求。

---

## 版本更新

```bash
# npm 全局安装用户
npm install -g workbuddy-cli@latest

# 一键脚本安装用户
curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash

# Git 克隆用户
git pull
```

---

## 常见问题

**Q：可以完全不开启 WorkBuddy 桌面端使用吗？**  
A：可以。运行一次 `workbuddy login` 完成浏览器授权后，即可彻底关闭 WorkBuddy 客户端。

**Q：服务端上新模型后需要升级 CLI 吗？**  
A：不需要。运行 `workbuddy models` 即可实时扫描出所有新模型，直接通过 `-m <model_id>` 调用即可。

**Q：如何在远程服务器或 SSH 环境下登录？**  
A：运行 `workbuddy login --no-browser`，将终端打印的授权链接复制到本地浏览器打开完成登录即可。

---

## 开源协议

[MIT](LICENSE)

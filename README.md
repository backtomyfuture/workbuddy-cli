# workbuddy-cli 🚀

> **Turn your Tencent WorkBuddy (腾讯混元桌面端) into a zero-config, zero-dependency, ultra-fast CLI assistant.**  
> Call 40+ top LLMs (Hunyuan 4.0, DeepSeek-V3/V4, GLM-5.3, Kimi-K3, MiniMax, Xiaomi MiMo, Step-5) directly from your terminal or scripts without setting up API keys!

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

---

## ✨ 核心特性 / Features

* 🔓 **支持独立登录，告别桌面端常驻**：内置 `workbuddy login` / `logout` / `status`，浏览器扫码授权一次后即可关闭 WorkBuddy 客户端，直接通过 HTTPS 调用并自动刷新 Token。
* 🔑 **免配置 API Key & 双通道容错**：优先使用 CLI 独立凭据直连服务端；未登录 CLI 时，自动回退复用本地运行中的 WorkBuddy 桌面端 WBIPC 通道。
* 📦 **零第三方依赖 (Zero Dependencies)**：100% 采用 Node.js 原生内置模块（`fetch`, `net`, `crypto`, `child_process`），无需安装任何重型包，启动极速。
* 🔎 **实时扫描服务端最新模型**：运行 `workbuddy models`（或 `-l`）动态拉取当前账号所有可用模型、积分倍率与能力标签，新增模型无需更新 CLI 即可直接 `-m <model_id>` 调用。
* 🔄 **流式管道与脚本友好**：
  * 支持标准 Unix 管道（`cat file | workbuddy`）
  * 支持结构化 JSON 输出（`--json`）
  * 支持系统提示词（`-s / --system`）
  * 完美适配 Shell 脚本、Raycast / Alfred 扩展以及 AI Agent 调度中台。

---

## 📦 快速安装 / Quick Start

### 方式 1：一键脚本安装（推荐）

打开终端直接粘贴运行：

```bash
curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash
```

安装完成后会生成两个全局命令：`workbuddy` 以及超短别名 `wb`。

---

### 方式 2：使用 npm 全局安装

```bash
npm install -g workbuddy-cli
```

或者使用 `npx` 免安装直接运行：

```bash
npx workbuddy-cli "你好，请写一个快速排序"
```

---

### 方式 3：手动克隆仓库

```bash
git clone https://github.com/backtomyfuture/workbuddy-cli.git
cd workbuddy-cli
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/workbuddy
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/wb
```

### 🔄 更新到最新版本 / Upgrade

* **npm 全局安装用户**：`npm install -g workbuddy-cli@latest`
* **一键脚本安装用户**：重新运行 `curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash`
* **手动克隆软链用户**：进入仓库目录执行 `git pull`

---

## 💡 使用示例 / Usage Examples

### 0. 独立登录 / 退出（无需保持桌面端运行）
```bash
# 通过浏览器扫码/账号登录，凭据保存在 ~/.workbuddy-cli/auth.json
workbuddy login

# 查看当前登录状态（CLI 独立凭据 & 桌面端 WBIPC）
workbuddy status

# 退出登录并注销服务端会话、清理本地凭据
workbuddy logout
```

> 登录一次后即可关闭 WorkBuddy 桌面客户端，CLI 会直接通过 HTTPS 调用后端接口并在 Token 过期时自动刷新；若未执行 `workbuddy login`，仍会自动回退复用运行中的桌面端 WBIPC。

### 1. 基础问答
```bash
workbuddy "用 Python 写一个支持泛型的 LRU 缓存"
# 或使用超短别名
wb "一句话解释量子纠缠"
```

### 2. 指定模型（使用简写别名）
```bash
# 使用免费版混元 4.0 (客户端同款)
workbuddy -m hy4 "帮我写一封英文催款邮件"

# 使用 DeepSeek V4.1 Flash
workbuddy -m deepseek-v4 "分析这段代码的时空复杂度"

# 使用智谱 GLM-5.3
workbuddy -m glm "以赛博朋克为主题写一首现代诗"

# 使用月之暗面 Kimi 最新旗舰
workbuddy -m kimi-pro "总结一下transformer架构的核心优势"

# 使用小米 MiMo 旗舰
workbuddy -m mimo "推荐三本关于分布式系统的经典书籍"
```

### 3. 文件管道与内容总结
```bash
cat server.log | workbuddy -p "提取所有的 500 错误并分析原因"
git diff | workbuddy -p "根据 git diff 生成规范的 Commit Message"
```

### 4. 设定 System Prompt 与 JSON 格式输出
```bash
workbuddy -s "你是一名资深Go开发专家" "如何避免goroutine泄漏？"

# 输出原始 JSON 结果（包含完整 reasoning 推理思考过程）
workbuddy --json "1+1=?"
```

### 5. 查看 / 实时扫描可用模型清单
```bash
# 登录后自动从服务端实时扫描最新可用模型（未登录时回退到内置静态列表）
workbuddy models
# 或
workbuddy -l

# 包含生图等特殊标签模型 / 输出完整 JSON 元数据
workbuddy models --all --json
```

---

## 📋 模型支持总览（实测全部 200 OK）

| 厂商 / 系列 | 模型 ID / 标识符 | CLI 简写别名 | 特点 / 额度 |
| :--- | :--- | :--- | :--- |
| **智能调度** | `auto` | `auto` | 客户端智能调度 |
| | `fast-model` / `balanced-model` / `deep-model` | `fast` / `balanced` / `deep` | 极速 / 均衡 / 深度推理 |
| **腾讯混元** | `hy4` / `hy4free` | `hy4` | **混元 4.0 [免费]**（客户端同款） |
| | `hy4std` | - | 混元 4.0 标准版（扣付费包） |
| | `hy4-preview` | - | 混元 4.0 尝鲜内测版 |
| | `hy3` | `hy3` | 混元 3.0 [免费] |
| | `hunyuan-chat` | - | 混元 Turbos 极速版 |
| **DeepSeek** | `deepseek-v3-2-volc` | `deepseek`, `ds`, `v3` | **DeepSeek-V3.2**（默认模型） |
| | `deepseek-v4.1-flash` | `deepseek-v4`, `v4` | **DeepSeek-V4.1 Flash** 极速旗舰 |
| | `deepseek-v4-pro` | - | DeepSeek-V4 Pro 高阶专业版 |
| **智谱 GLM** | `glm-5.3` | `glm` | **GLM-5.3** 最新旗舰 |
| | `glm-5.3-flash` | `glm-flash` | GLM-5.3 Flash |
| | `glm-5v-turbo` | `glm-5v` | GLM-5v 视觉多模态 |
| **月之暗面 Kimi** | `kimi-k3.1-pro` | `kimi-pro` | **Kimi-K3.1-Pro** 最新旗舰 |
| | `kimi-k3-1` / `kimi-k3-2` | `kimi-k3` | Kimi-K3 系列 |
| | `kimi-k2.7` | - | Kimi-K2.7-Code 代码专精 |
| | `kimi-k2.5` | `kimi` | Kimi-K2.5 |
| **MiniMax** | `minimax-m3.1-flash` | `minimax-flash` | **MiniMax-M3.1-Flash** |
| | `minimax-m2.7` | `minimax` | MiniMax-M2.7 |
| **其他厂商** | `mimo-v2.6-pro` | `mimo` | **小米 Xiaomi MiMo-V2.6-Pro** |
| | `step-5-preview` | `step` | **阶跃星辰 Step-5-Preview** |
| **代码辅助** | `codewise-rewrite` | - | 代码重构专精 |
| | `codewise-jump` | - | 符号跳转与定义查找 |

---

## 🛠 工作原理 / How It Works

```
模式 A（推荐）：CLI 独立直连（无需启动桌面端）
┌─────────────────┐         HTTPS + Bearer Token (+ 自动刷新)        ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────────────────> │  Tencent Cloud Backend │
│  (Pure Node.js) │ <─────────────────────────────────────────────── │ (www.workbuddy.cn)     │
└─────────────────┘   ~/.workbuddy-cli/auth.json (0600 权限隔离)      └────────────────────────┘

模式 B（回退）：未登录 CLI 时自动复用桌面端 WBIPC
┌─────────────────┐      Unix Domain Socket (WBIPC)      ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────> │   WorkBuddy Desktop    │
└─────────────────┘   HMAC-SHA256 Handshake + JSON-RPC   └────────────────────────┘
```

1. **独立登录与自动刷新（模式 A）**：`workbuddy login` 通过外部链接授权轮询获取 Token 与账号信息，以 `0600` 权限保存在 `~/.workbuddy-cli/auth.json`（与桌面端配置完全隔离）。后续请求直接走 HTTPS `/v2/chat/completions` 与 `/v2/enterprises/.../models`，Token 临期或遇 `401` 时自动刷新；`workbuddy logout` 会注销服务端会话并清理本地凭据。
2. **WBIPC 桌面端回退（模式 B）**：若未执行 `workbuddy login`，CLI 会自动检测 `~/.workbuddy/wbipc/endpoint.json`，通过 HMAC-SHA256 握手与桌面端的 `wb.request` 管线代理请求。

---

## ❓ 常见问题 / FAQ

**Q: 能够脱离 WorkBuddy 桌面端独立运行吗？**  
A: 可以！运行一次 `workbuddy login` 在浏览器完成授权后，即可彻底关闭 WorkBuddy 桌面端，CLI 会直接与服务端通信并自动续期 Token。

**Q: 运行提示 `未登录且 WorkBuddy 桌面端未运行`？**  
A: 请先运行 `workbuddy login` 登录（推荐，无需开客户端），或者启动 WorkBuddy 桌面端（`open -a WorkBuddy`）。

**Q: 服务端新增了模型，CLI 需要升级才能用吗？**  
A: 不需要。运行 `workbuddy models` 可实时从服务端扫描所有最新可用模型，然后直接通过 `workbuddy -m <model_id> "..."` 调用即可。

**Q: 远程 SSH / 无图形界面环境如何登录？**  
A: 运行 `workbuddy login --no-browser`，终端会打印授权链接，在本地浏览器打开完成授权即可。

---

## 📄 开源许可证 / License

本项目基于 [MIT 许可证](LICENSE) 开源。

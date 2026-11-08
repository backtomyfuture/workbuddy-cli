# workbuddy-cli 🚀

> **Turn your Tencent WorkBuddy (腾讯混元桌面端) into a zero-config, zero-dependency, ultra-fast CLI assistant.**  
> Call 40+ top LLMs (Hunyuan 4.0, DeepSeek-V3/V4, GLM-5.3, Kimi-K3, MiniMax, Xiaomi MiMo, Step-5) directly from your terminal or scripts without setting up API keys!

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

---

## ✨ 核心特性 / Features

* 🔑 **免配置 API Key**：直接复用本地已登录的 WorkBuddy 桌面端凭据与免费额度。
* 📦 **零第三方依赖 (Zero Dependencies)**：100% 采用 Node.js 原生内置模块（`net`, `crypto`），无需 `npm install` 任何重型包，启动极速。
* ⚡️ **原生 WBIPC 协议通信**：基于本地 Unix Domain Socket 与 HMAC-SHA256 握手直接与客户端进程通信，毫秒级响应，告别无头浏览器或 GUI 模拟点击。
* 🤖 **内置支持 40+ 顶级大模型**：
  * **免费/默认**：腾讯混元 4.0 (`hy4` / `hy4free`)、混元 3.0 (`hy3`)、DeepSeek-V3.2
  * **最新旗舰**：DeepSeek-V4.1 Flash、GLM-5.3、Kimi-K3.1 Pro、MiniMax-M3.1 Flash、小米 MiMo-V2.6 Pro、阶跃星辰 Step-5
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

---

## 💡 使用示例 / Usage Examples

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

### 5. 查看所有可用模型清单
```bash
workbuddy --models
# 或
workbuddy -l
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
┌─────────────────┐         Unix Domain Socket (WBIPC)         ┌────────────────────────┐
│  workbuddy-cli  │ ─────────────────────────────────────────> │   WorkBuddy Desktop    │
│  (Pure Node.js) │ <───────────────────────────────────────── │     (Electron App)     │
└─────────────────┘      HMAC-SHA256 Handshake + JSON-RPC      └───────────┬────────────┘
                                                                           │
                                                                 Authorized Proxy Fetch
                                                                           │
                                                                           ▼
                                                               ┌────────────────────────┐
                                                               │  Tencent Cloud Backend │
                                                               │ (https://workbuddy.cn) │
                                                               └────────────────────────┘
```

1. **自动发现**：CLI 自动读取 `~/.workbuddy/wbipc/endpoint.json`，获取当前运行中 WorkBuddy 实例的 Unix 套接字与握手 Ticket。
2. **安全握手**：客户端发起 `session_hello`，服务端下发随机 Nonce 挑战，CLI 计算 HMAC-SHA256 签名通过验证。
3. **管线代理**：CLI 绑定 `wb.request` 管线，利用内部 `http.fetch` 发起对话请求，直接继承桌面端已登录会话的鉴权与配额。

---

## ❓ 常见问题 / FAQ

**Q: 运行提示 `WorkBuddy 桌面端未运行，未找到 WBIPC 端点`？**  
A: 请确保你的电脑上已经打开了 WorkBuddy 客户端（`open -a WorkBuddy`）并且处于登录状态。

**Q: 能够脱离桌面端独立运行吗？**  
A: WorkBuddy 的用户鉴权 Token 在本地采用操作系统级安全加密，保护机主权益。本 CLI 的设计理念即是“零配置”借用本地桌面端作为安全通道，因此无需用户在代码或配置文件中粘贴敏感凭据。

---

## 📄 开源许可证 / License

本项目基于 [MIT 许可证](LICENSE) 开源。

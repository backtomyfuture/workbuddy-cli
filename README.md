<div align="center">

# workbuddy-cli

**Zero-dependency CLI for Tencent WorkBuddy — chat with top LLMs directly from your terminal, with standalone browser login and live model discovery.**

[![npm version](https://img.shields.io/npm/v/workbuddy-cli.svg)](https://www.npmjs.com/package/workbuddy-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Why `workbuddy-cli`?

- **Standalone Auth (No Desktop App Required)**: Run `workbuddy login` once via your browser and close the WorkBuddy Electron client for good. Tokens are stored locally with `0600` permissions and refreshed automatically.
- **Zero Dependencies**: Built 100% on Node.js built-in modules (`fetch`, `net`, `crypto`, `child_process`). Instant startup, tiny footprint.
- **Live Model Discovery**: Run `workbuddy models` to query the backend for every model currently available to your account — including credit multipliers, capabilities, and newly launched models — without waiting for CLI updates.
- **Dual-Mode Transport**: Uses direct HTTPS when logged in via CLI, and seamlessly falls back to the local WorkBuddy desktop socket (WBIPC) if you prefer not to log in separately.
- **Script & Pipe Friendly**: Native support for Unix pipes (`cat log | workbuddy`), structured `--json` output, custom `--system` prompts, and short `wb` alias.

---

## Quick Start

### 1. Install

**Via npm (recommended):**

```bash
npm install -g workbuddy-cli
```

Or run without installing:

```bash
npx workbuddy-cli login
```

<details>
<summary>Alternative install methods (one-line script / from source)</summary>

**One-line installer (macOS / Linux):**

```bash
curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash
```

**From source:**

```bash
git clone https://github.com/backtomyfuture/workbuddy-cli.git
cd workbuddy-cli
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/workbuddy
ln -sf "$(pwd)/bin/workbuddy.mjs" ~/.local/bin/wb
```

</details>

### 2. Log in & Chat

```bash
# Authenticate in your browser (only needed once)
workbuddy login

# Discover all models available to your account
workbuddy models

# Start chatting (shorthand alias `wb` also works)
wb "Write a generic LRU cache in Python"
```

---

## Usage

### Commands

| Command | Description |
| :--- | :--- |
| `workbuddy login` | Authenticate via browser (`--no-browser` prints URL for SSH/headless) |
| `workbuddy logout` | Revoke server session and remove local CLI credentials |
| `workbuddy status` / `whoami` | Show CLI auth state, token expiry, and desktop WBIPC status |
| `workbuddy models` / `-l` | Fetch live available models from server (`--all`, `--json`, `--static`) |
| `workbuddy sessions` | List conversations saved by this CLI |
| `workbuddy continue` / `-c` | Continue the latest conversation in the current directory |
| `workbuddy resume [id]` / `-r` | Resume a conversation by id, or list them when the id is omitted |
| `workbuddy acp` | ACP stdio server for T3 Code |
| `workbuddy [options] <prompt>` | Send a prompt to the selected model |

### Options

| Flag | Description |
| :--- | :--- |
| `-c, --continue` | Continue the latest conversation in this directory |
| `-r, --resume [id]` | Resume one conversation; without an id, list saved conversations |
| `--session-id <id>` | Use this id when starting a new conversation |
| `-m, --model <id>` | Model ID or shorthand alias (default: `deepseek-v3-2-volc`) |
| `--effort <level>` | Reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `off`. Continued chats keep the previous level |
| `-s, --system <prompt>` | Set a system prompt |
| `-p, --print` | Print response and exit (default behavior) |
| `--json` | Output structured JSON (includes `reasoning` when available) |
| `--all` | Include specialized tags (e.g. `text-to-image`) in `models` |
| `--static` | Show built-in static alias list without querying server |
| `--no-browser` | Print login URL instead of opening a browser automatically |
| `-h, --help` | Show help message |

### Examples

```bash
# Use a specific model or shorthand alias
wb -m hy4 "Draft a polite follow-up email"
wb -m deepseek-v4 "Analyze the time complexity of this algorithm"
wb -m glm "Explain Raft consensus in 3 bullet points"

# Pass any newly released model ID from `workbuddy models` directly
wb -m <any-new-model-id> "Hello!"

# Unix pipes
cat server.log | wb -p "Extract all 500 errors and summarize root causes"
git diff | wb -p "Generate a conventional commit message"

# System prompt + JSON output
wb -s "You are a senior Go engineer" --json "How do I prevent goroutine leaks?"

# Include reasoning trace in stderr
WORKBUDDY_SHOW_REASONING=1 wb -m deep "Solve this logic puzzle..."

# Continue the latest chat in this directory, or pick one by id
wb -c "Turn that into an iterative version"
wb sessions
wb resume wb_abc123 "Add tests"
```

> **Shorthand Aliases**: Common aliases such as `auto`, `fast`, `balanced`, `deep`, `hy4`, `ds` (`deepseek`), `deepseek-v4`, `glm`, `kimi`, `kimi-pro`, `minimax-flash`, `mimo`, and `step` are mapped automatically. Run `workbuddy models` to see the full live catalog for your account.

---

## Continue a conversation

Each successful prompt is stored under `~/.workbuddy-cli/sessions/`. The next prompt in the same directory with `-c` / `continue` sends the previous messages back to `/v2/chat/completions`. `resume <id>` opens a specific transcript; a unique id prefix is enough. `--json` includes `sessionId`.

This history belongs to `workbuddy-cli`. It is separate from the desktop app's CodeBuddy sessions (`codebuddy -c` / `codebuddy -r`).

## Use it from T3 Code

T3 Code starts a local ACP agent as a subprocess and speaks newline-delimited JSON-RPC on stdin/stdout.

1. Install this CLI so `workbuddy` is on the PATH used by the T3 Code server (`npm install -g`, or the symlink from `install.sh`).
2. Run `workbuddy login` once as that same user.
3. In T3 Code open **Settings → Providers → Add provider → Show more → Local ACP command**.
4. Command: `workbuddy`. Argument: `acp`. Name it `WorkBuddy`.

The server negotiates ACP v1 and implements:

| Method | Behavior |
| :--- | :--- |
| `initialize` | Announces ACP v1, `loadSession`, and text prompts. If the CLI is logged out, advertises a terminal login that runs `workbuddy login`. |
| `authenticate` / `auth/logout` | Terminal login is not an RPC. Logout revokes the CLI credential. |
| `session/new` | Creates a conversation bound to the workspace `cwd`. |
| `session/load`, `session/resume` | Reloads a saved transcript and replays it. |
| `session/list` | Lists saved conversations. |
| `session/prompt` | Streams `agent_message_chunk` / `agent_thought_chunk`, then returns `stopReason`. |
| `session/cancel` | Aborts the in-flight turn. |
| `session/close` | Drops the in-memory session. The transcript stays on disk. |
| `session/set_model`, `session/set_config_option` | Changes the model for later turns. `thought_level` is the reasoning effort. |
| `session/set_mode` | `plan` disables edits and shell commands. |

During a turn the agent can call `read_file`, `list_dir`, `write_file`, and `bash`, up to 500 model rounds. Writes, shell commands, and reads ask `session/request_permission`, then use the client's `fs/*` or `terminal` capability when T3 advertises it. When logged in, T3's model list is the chat-capable slice of `workbuddy models`, and a new session starts on the account's first default model. Image and video models stay out of that list. Reasoning models advertise `thought_level` and `_meta.reasoningEfforts` from the server catalog, which T3 Code uses to show the thinking level.

The desktop CodeBuddy binary already speaks ACP too (`codebuddy --acp`). On this machine the unpacked entrypoint only loads if `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`. `workbuddy acp` is the integration that uses this CLI's own login and transcript store.

## Architecture

```text
Mode A (Default when logged in): Standalone Direct HTTPS
┌─────────────────┐        HTTPS + Bearer Token (Auto-Refresh)       ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────────────────> │  Tencent Cloud Backend │
│  (Pure Node.js) │ <─────────────────────────────────────────────── │   (www.workbuddy.cn)   │
└─────────────────┘   ~/.workbuddy-cli/auth.json (0600 isolated)     └────────────────────────┘

Mode B (Fallback): Local Desktop WBIPC
┌─────────────────┐      Unix Domain Socket (WBIPC)      ┌────────────────────────┐
│  workbuddy-cli  │ ───────────────────────────────────> │   WorkBuddy Desktop    │
└─────────────────┘   HMAC-SHA256 Handshake + JSON-RPC   └────────────────────────┘
```

1. **Standalone Mode**: `workbuddy login` completes browser OAuth polling and stores credentials in `~/.workbuddy-cli/auth.json` (`0600` permissions, isolated from the desktop app). Requests hit `/v2/chat/completions` and `/v2/enterprises/.../models` directly and auto-refresh expired tokens.
2. **WBIPC Fallback**: If no CLI session exists, `workbuddy-cli` discovers `~/.workbuddy/wbipc/endpoint.json`, completes an HMAC-SHA256 challenge-response handshake, and proxies requests through the running desktop app's `wb.request` pipe.

---

## Upgrading

```bash
# npm global install
npm install -g workbuddy-cli@latest

# One-line script install
curl -fsSL https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main/install.sh | bash

# Git clone
git pull
```

---

## FAQ

**Can I run `workbuddy-cli` without keeping the WorkBuddy desktop app open?**  
Yes. Run `workbuddy login` once and you can quit the desktop app completely.

**How do I use new models added on the server?**  
Run `workbuddy models` to scan the live catalog, then pass any returned model ID with `-m <model_id>`. No CLI upgrade needed.

**How do I log in on a remote server or over SSH?**  
Run `workbuddy login --no-browser`, open the printed URL in your local browser, and complete authorization.

---

## License

[MIT](LICENSE)

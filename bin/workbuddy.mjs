#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAcpServer } from './acp-server.mjs';
import { accountDefaultModel, acpModelsFromCatalog } from './catalog.mjs';
import { applyReasoning, installModelProfiles, parseEffort, resolveEffort } from './effort.mjs';
import { accessShouldRenew, apiAuthHeaders, apiOrigin, clientUserAgent, enterpriseHost, isApiKeySession, shouldRefreshAccessToken } from './session-auth.mjs';
import {
  conversationHeaders,
  encodeChatBody,
  explainChatError,
  gzipRejected,
  isChannelRefusal,
  modelsFromProductConfig,
  prepareChat,
  refusalFallbacks,
  restoreToolNames
} from './wire.mjs';
import {
  authFilePath,
  cliHome,
  createSessionId,
  latestSession,
  listSessions,
  loadSession,
  saveSession
} from './sessions.mjs';

const PROTOCOL_VERSION = 1;
const DEFAULT_ENDPOINT = 'https://www.workbuddy.cn';
const AUTH_PREFIX = '/v2/plugin';
const AUTH_PLATFORM = 'workbuddy';
const DEFAULT_MODEL = 'deepseek-v3-2-volc';
const AUTH_DIR = cliHome();
const AUTH_FILE = authFilePath();
const LOGIN_POLL_INTERVAL_MS = 1500;
const LOGIN_TIMEOUT_MS = 300000;
const LOGIN_TOKEN_PENDING_CODE = 11217;
const LOGIN_ACCOUNT_PENDING_CODE = 12151;
const CHAT_TIMEOUT_MS = 180000;

const MODEL_ALIASES = {
  // 模式
  'auto': 'auto',
  'fast': 'fast-model',
  'balanced': 'balanced-model',
  'deep': 'deep-model',

  // 腾讯混元 (Hunyuan)
  'hy4': 'hy4',
  'hy4free': 'hy4free',
  'hy4std': 'hy4std',
  'hy4-preview': 'hy4-preview',
  'hy3': 'hy3',
  'hy3-free': 'hy3',
  'hy3-std': 'hy3-x',
  'hy3-preview': 'hy3-preview',
  'hunyuan': 'hy4',
  'hunyuan-chat': 'hunyuan-chat',

  // DeepSeek 系列
  'ds': 'deepseek-v3-2-volc',
  'deepseek': 'deepseek-v3-2-volc',
  'deepseek-v3': 'deepseek-v3-2-volc',
  'deepseek-v4': 'deepseek-v4.1-flash',
  'deepseek-v4.1': 'deepseek-v4.1-flash',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro',

  // 智谱 GLM 系列
  'glm': 'glm-5.3',
  'glm-5.3': 'glm-5.3',
  'glm-flash': 'glm-5.3-flash',
  'glm-5.3-flash': 'glm-5.3-flash',
  'glm-5.3-flashx': 'glm-5.3-flashx',
  'glm-5.2': 'glm-5.2',
  'glm-5v': 'glm-5v-turbo',
  'glm-5v-turbo': 'glm-5v-turbo',

  // 月之暗面 Kimi 系列
  'kimi': 'kimi-k2.5',
  'kimi-k2.5': 'kimi-k2.5',
  'kimi-k2.6': 'kimi-k2.6',
  'kimi-k2.7': 'kimi-k2.7',
  'kimi-k2.8': 'kimi-k2.8-preview',
  'kimi-k3': 'kimi-k3-1',
  'kimi-k3-1': 'kimi-k3-1',
  'kimi-k3-2': 'kimi-k3-2',
  'kimi-pro': 'kimi-k3.1-pro',
  'kimi-k3.1-pro': 'kimi-k3.1-pro',

  // MiniMax 系列
  'minimax': 'minimax-m2.7',
  'minimax-m2.7': 'minimax-m2.7',
  'minimax-m3': 'minimax-m3-pay',
  'minimax-flash': 'minimax-m3.1-flash',
  'minimax-m3.1-flash': 'minimax-m3.1-flash',

  // 小米 / 阶跃星辰 / 其他
  'mimo': 'mimo-v2.6-pro',
  'mimo-v2.6-pro': 'mimo-v2.6-pro',
  'step': 'step-5-preview',
  'step-5-preview': 'step-5-preview',
  'space-bunny': 'space-bunny',
  'wb-lite': 'wb-lite'
};

const ACP_MODELS = [
  ['deepseek-v3-2-volc', 'DeepSeek V3.2'],
  ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
  ['hy4', '混元 4.0'],
  ['glm-5.3', 'GLM-5.3'],
  ['kimi-k3.1-pro', 'Kimi K3.1 Pro'],
  ['kimi-k2.5', 'Kimi K2.5'],
  ['minimax-m3.1-flash', 'MiniMax M3.1 Flash'],
  ['auto', 'Auto'],
  ['fast-model', 'Fast'],
  ['balanced-model', 'Balanced'],
  ['deep-model', 'Deep']
];

function acpModels() {
  return ACP_MODELS.map(([modelId, name]) => ({ modelId, name }));
}

function printSessions(asJson) {
  const sessions = listSessions();
  if (asJson) {
    console.log(JSON.stringify({
      ok: true,
      sessions: sessions.map(session => ({
        id: session.id,
        title: session.title || '',
        cwd: session.cwd,
        model: session.model,
        updatedAt: session.updatedAt,
        messages: Array.isArray(session.messages) ? session.messages.length : 0
      }))
    }, null, 2));
    return;
  }
  if (!sessions.length) {
    console.log('还没有保存的会话。直接提问一次后，可用 workbuddy -c 继续。');
    return;
  }
  console.log('已保存的会话（最近在前）:\n');
  for (const session of sessions.slice(0, 30)) {
    const when = session.updatedAt ? new Date(session.updatedAt).toISOString().replace('T', ' ').slice(0, 16) : '-';
    console.log(`  ${session.id}  ${when}  ${session.model || ''}`);
    console.log(`    ${session.title || '(无标题)'}  ${session.cwd || ''}`);
  }
  console.log('\n继续当前目录最近一条：workbuddy -c "..."');
  console.log('按 id 继续：workbuddy resume <id> "..."');
}

function showModels() {
  console.log(`WorkBuddy 完整模型清单（经实测 200 OK 确认可用）:

1. 智能调度模式:
  auto                             自动调度
  fast-model (简写: fast)          快速响应
  balanced-model (简写: balanced)  均衡模式
  deep-model (简写: deep)          极致推理/深度模式

2. 腾讯混元 (Hunyuan):
  hy4 (或 hy4free)                 混元 4.0 [免费] (客户端默认)
  hy4std                           混元 4.0 标准版 [付费包额度]
  hy4-preview                      混元 4.0 尝鲜内测版
  hy4-preview-ctrl                 混元 4.0 对照组
  hy4-preview-exp                  混元 4.0 实验组
  hy4preview-exp1 / exp2           混元 4.0 实验组 1/2
  hy3 (或 hy3-free)                混元 3.0 [免费]
  hy3-x (或 hy3-std)               混元 3.0 标准版 [付费包额度]
  hy3-b / hy3-c / hy3-preview      混元 3.0 衍生版本
  hunyuan-chat                     混元 Turbos

3. DeepSeek 系列:
  deepseek-v3-2-volc (简写: deepseek, ds)  DeepSeek-V3.2 (火山/腾讯聚合，默认模型)
  deepseek-v4.1-flash (简写: deepseek-v4)  DeepSeek-V4.1-Flash (极速旗舰)
  deepseek-v4-flash                        DeepSeek-V4-Flash
  deepseek-v4-pro                          DeepSeek-V4-Pro (高阶专业版)

4. 智谱 GLM 系列:
  glm-5.3 (简写: glm)              GLM-5.3 最新旗舰
  glm-5.3-flash (简写: glm-flash)  GLM-5.3-Flash
  glm-5.3-flashx                   GLM-5.3-FlashX
  glm-5.2                          GLM-5.2
  glm-5v-turbo (简写: glm-5v)      GLM-5v-Turbo 视觉多模态

5. 月之暗面 Kimi 系列:
  kimi-k3.1-pro (简写: kimi-pro)   Kimi-K3.1-Pro 最新旗舰
  kimi-k3-1 / kimi-k3-2            Kimi-K3 / K3-v2
  kimi-k2.8-preview                Kimi-K2.8-Preview
  kimi-k2.7                        Kimi-K2.7-Code 代码专精
  kimi-k2.6                        Kimi-K2.6
  kimi-k2.5 (简写: kimi)           Kimi-K2.5

6. MiniMax 系列:
  minimax-m3.1-flash (简写: minimax-flash) MiniMax-M3.1-Flash 极速版
  minimax-m3-pay (简写: minimax-m3)        MiniMax-M3
  minimax-m2.7 (简写: minimax)             MiniMax-M2.7

7. 其他合作厂商与特色模型:
  mimo-v2.6-pro (简写: mimo)       小米 Xiaomi MiMo-V2.6-Pro
  step-5-preview (简写: step)      阶跃星辰 Step-5-Preview
  space-bunny                      Space-Bunny
  wb-lite                          WorkBuddy Lite

8. 内置代码辅助模型 (直接可调):
  codewise-rewrite                 代码重构专精
  codewise-jump                    符号定义跳转辅助
  codewise-nes-a4-027-aide         IDE 代码补全辅助

注：
- 腾讯内网专属模型（如 GPT-5 / GPT-6 / Claude-5 / Gemini-3 等海外模型）需处于腾讯内部 IOA 办公网环境方可访问，非 IOA 环境会返回 400 'is only available on IOA'。
- 生图模型 (hunyuan-image-v3.0) 与生视频模型 (kling-video-v3, minimax-video-h3) 为多模态生成专用接口，不走普通文本流式对话。
`);
}

function showHelp() {
  console.log(`Usage: workbuddy [command] [options] [prompt]

Interact with WorkBuddy directly (after login) or via local desktop WBIPC.

Commands:
  login                   Log in via browser (no desktop app needed afterwards)
  login --api-key         Save a key from https://www.workbuddy.cn/profile/keys
  logout                  Revoke session and remove local CLI credentials
  status, whoami          Show current CLI auth and desktop WBIPC status
  models                  Scan available models from server (falls back to static list)
  sessions                List saved CLI conversations
  continue [prompt]       Continue the most recent conversation in this directory
  resume [id] [prompt]    Resume a conversation by id (or a unique prefix)
  acp                     Speak Agent Client Protocol on stdin/stdout (for T3 Code)

Arguments:
  prompt                  Your prompt / question

Options:
  -p, --print             Print response and exit (default behavior)
  -c, --continue          Continue the most recent conversation in this directory
  -r, --resume [id]       Resume a conversation by id, or list conversations when omitted
  --session-id <id>       Pin the session id for a new conversation
  -m, --model <model>     Model name or alias (e.g. hy4, deepseek, glm, default: deepseek-v3-2-volc)
  --effort <level>        Reasoning effort: minimal, low, medium, high, xhigh, max, or off
  -l, --models            Scan/list available models and aliases
  --all                   Include specialized/image models when listing models
  --static                Show built-in static model list without querying server
  --json                  Output response as JSON
  -s, --system <prompt>   System prompt
  --no-browser            Print login URL instead of opening browser automatically
  --api-key               Log in with a key from the WorkBuddy keys page (prompted, or WORKBUDDY_API_KEY)
  -h, --help              Show this help message

Examples:
  workbuddy login
  workbuddy login --api-key
  workbuddy models
  workbuddy "用Python写一个快速排序"
  workbuddy -c "把刚才的例子改成迭代版本"
  workbuddy resume wb_abc123 "再补上测试"
  workbuddy sessions
  workbuddy -m hy4 "帮我写一封商务邮件"
  workbuddy --effort high "先看结构再改"
  cat document.txt | workbuddy -p "总结主要内容"
  workbuddy acp
  workbuddy logout
`);
}

function parseArgs(args) {
  let command = 'chat';
  let prompt = '';
  let model = DEFAULT_MODEL;
  let modelExplicit = false;
  let asJson = false;
  let systemPrompt = '';
  let systemExplicit = false;
  let noBrowser = false;
  let apiKey = false;
  let includeAllModels = false;
  let staticModels = false;
  let continueSession = false;
  let resumeId = undefined;
  let expectResumeId = false;
  let sessionId = '';
  let effort = '';
  let effortExplicit = false;

  const first = args[0];
  if (first === 'login' || first === '--login') {
    command = 'login';
    args = args.slice(1);
  } else if (first === 'logout' || first === '--logout') {
    command = 'logout';
    args = args.slice(1);
  } else if (first === 'status' || first === 'whoami' || first === '--status') {
    command = 'status';
    args = args.slice(1);
  } else if (first === 'models') {
    command = 'models';
    args = args.slice(1);
  } else if (first === 'sessions') {
    command = 'sessions';
    args = args.slice(1);
  } else if (first === 'acp') {
    command = 'acp';
    args = args.slice(1);
  } else if (first === 'continue') {
    command = 'chat';
    continueSession = true;
    args = args.slice(1);
  } else if (first === 'resume') {
    command = 'chat';
    expectResumeId = true;
    args = args.slice(1);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-l' || arg === '--models') {
      command = 'models';
    } else if (arg === '-p' || arg === '--print') {
      // default
    } else if (arg === '--json') {
      asJson = true;
    } else if (arg === '--no-browser') {
      noBrowser = true;
    } else if (arg === '--api-key') {
      apiKey = true;
    } else if (arg === '--all') {
      includeAllModels = true;
    } else if (arg === '--static') {
      staticModels = true;
    } else if (arg === '-c' || arg === '--continue') {
      continueSession = true;
    } else if (arg === '-r' || arg === '--resume') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        resumeId = next;
        i += 1;
      } else {
        resumeId = '';
      }
    } else if (arg.startsWith('--resume=')) {
      resumeId = arg.slice('--resume='.length);
    } else if (arg === '--session-id') {
      sessionId = args[++i] || '';
    } else if (arg.startsWith('--session-id=')) {
      sessionId = arg.slice('--session-id='.length);
    } else if (arg === '-m' || arg === '--model') {
      model = args[++i];
      modelExplicit = true;
    } else if (arg.startsWith('--model=')) {
      model = arg.slice(8);
      modelExplicit = true;
    } else if (arg === '--effort') {
      effort = args[++i] || '';
      effortExplicit = true;
    } else if (arg.startsWith('--effort=')) {
      effort = arg.slice('--effort='.length);
      effortExplicit = true;
    } else if (arg === '-s' || arg === '--system') {
      systemPrompt = args[++i];
      systemExplicit = true;
    } else if (arg.startsWith('--system=')) {
      systemPrompt = arg.slice(9);
      systemExplicit = true;
    } else if (!arg.startsWith('-')) {
      if (expectResumeId && resumeId === undefined) {
        resumeId = arg;
        expectResumeId = false;
      } else {
        prompt = prompt ? `${prompt} ${arg}` : arg;
      }
    }
  }

  // Resolve alias
  if (model && MODEL_ALIASES[model.toLowerCase()]) {
    model = MODEL_ALIASES[model.toLowerCase()];
  }

  if (resumeId === undefined && expectResumeId) resumeId = '';

  return {
    command,
    prompt,
    model,
    modelExplicit,
    asJson,
    systemPrompt,
    systemExplicit,
    noBrowser,
    apiKey,
    includeAllModels,
    staticModels,
    continueSession,
    resumeId,
    sessionId,
    effort,
    effortExplicit
  };
}

function encodeTranscript(role, t) {
  const domain = role === 'server' ? 'wbipc-s' : 'wbipc-c';
  const parts = [domain, String(t.protocol), t.endpoint, t.clientNonce, t.serverNonce];
  const chunks = [];
  for (const part of parts) {
    const buf = Buffer.from(part, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length, 0);
    chunks.push(len, buf);
  }
  return Buffer.concat(chunks);
}

function computeProof(ticket, role, transcript) {
  return crypto.createHmac('sha256', Buffer.from(ticket, 'utf8'))
    .update(encodeTranscript(role, transcript))
    .digest('base64url');
}

function ticketIdOf(ticket) {
  return crypto.createHash('sha256').update(ticket, 'utf8').digest('hex').slice(0, 16);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readCliSession() {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCliSession(session) {
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}

function removeCliSession() {
  if (fs.existsSync(AUTH_FILE)) {
    fs.unlinkSync(AUTH_FILE);
  }
}

function normalizeToken(raw, fallbackDomain = 'www.workbuddy.cn') {
  const now = Date.now();
  const expiresAt = raw.expiresAt || (raw.expiresIn ? now + raw.expiresIn * 1000 : undefined);
  const refreshExpiresAt = raw.refreshExpiresAt || (raw.refreshExpiresIn ? now + raw.refreshExpiresIn * 1000 : undefined);
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    tokenType: raw.tokenType,
    domain: raw.domain || fallbackDomain,
    expiresAt,
    refreshExpiresAt,
    lastRefreshTime: now
  };
}

function buildDomainHeader(endpoint, auth) {
  try {
    return auth?.domain || new URL(endpoint).host;
  } catch {
    return 'www.workbuddy.cn';
  }
}

function buildEnterpriseHeaders(endpoint, auth, account) {
  const headers = {
    'User-Agent': clientUserAgent(),
    'X-Domain': buildDomainHeader(endpoint, auth)
  };
  const enterpriseId = account?.enterpriseId;
  if (enterpriseId) {
    headers['X-Enterprise-Id'] = enterpriseId;
    headers['X-Tenant-Id'] = enterpriseId;
  }
  return headers;
}

function openExternalUrl(url) {
  return new Promise(resolve => {
    const platform = process.platform;
    let cmd;
    let args;
    if (platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else if (platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.unref();
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      status: res.status,
      ok: res.ok,
      json,
      text,
      wwwAuthenticate: res.headers.get('www-authenticate') || ''
    };
  } finally {
    clearTimeout(timer);
  }
}

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('请设置环境变量 WORKBUDDY_API_KEY，或在终端中运行 workbuddy login --api-key'));
      return;
    }
    const stdin = process.stdin;
    let value = '';
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = chunk => {
      if (chunk === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        process.stderr.write('\n');
        process.exit(130);
      }
      if (chunk === '\r' || chunk === '\n' || chunk === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stderr.write('\n');
        resolve(value.trim());
        return;
      }
      if (chunk === '\u007f' || chunk === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (chunk.charCodeAt(0) < 32) return;
      value += chunk;
    };
    stdin.on('data', onData);
  });
}

async function loginWithApiKey() {
  const fromEnv = process.env.WORKBUDDY_API_KEY?.trim();
  const key = fromEnv || await readSecret('WorkBuddy API 密钥（输入不回显）: ');
  if (!key) throw new Error('未提供 API 密钥');
  const session = {
    endpoint: DEFAULT_ENDPOINT,
    auth: {
      accessToken: key,
      tokenType: 'ApiKey',
      source: 'api-key',
      lastRefreshTime: Date.now()
    },
    account: {
      uid: `anonymous_${key.slice(-8)}`,
      type: 'api-key'
    },
    updatedAt: Date.now()
  };
  writeCliSession(session);
  return session;
}

async function loginWorkBuddy(options = {}) {
  const endpoint = DEFAULT_ENDPOINT;
  const noAuthHeaders = {
    'Content-Type': 'application/json',
    'X-Domain': buildDomainHeader(endpoint),
    'X-No-Authorization': 'true',
    'X-No-User-Id': 'true',
    'X-No-Enterprise-Id': 'true',
    'X-No-Department-Info': 'true'
  };

  const stateRes = await fetchJson(`${endpoint}${AUTH_PREFIX}/auth/state?platform=${AUTH_PLATFORM}`, {
    method: 'POST',
    headers: noAuthHeaders,
    body: '{}'
  });

  if (!stateRes.ok || !stateRes.json?.data?.state || !stateRes.json?.data?.authUrl) {
    throw new Error(`获取登录链接失败 (HTTP ${stateRes.status}): ${stateRes.json?.msg || stateRes.text}`);
  }

  const { state, authUrl } = stateRes.json.data;
  console.error(`请在浏览器中完成 WorkBuddy 登录:\n${authUrl}\n`);
  if (!options.noBrowser) {
    const opened = await openExternalUrl(authUrl);
    if (!opened) {
      console.error('未能自动打开浏览器，请手动复制上方链接到浏览器打开。');
    }
  }
  console.error('等待登录完成...');

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let tokenData = null;

  while (Date.now() < deadline) {
    await sleep(LOGIN_POLL_INTERVAL_MS);
    const tokenRes = await fetchJson(
      `${endpoint}${AUTH_PREFIX}/auth/token?state=${encodeURIComponent(state)}`,
      { headers: noAuthHeaders }
    );
    const body = tokenRes.json;
    if (body?.data?.accessToken) {
      tokenData = normalizeToken(body.data, buildDomainHeader(endpoint));
      break;
    }
    if (body?.code === LOGIN_TOKEN_PENDING_CODE) {
      continue;
    }
    throw new Error(`登录轮询失败 (HTTP ${tokenRes.status}): ${body?.msg || tokenRes.text}`);
  }

  if (!tokenData) {
    throw new Error('登录超时（5 分钟内未完成登录）');
  }

  let account = null;
  const authHeaders = {
    ...buildEnterpriseHeaders(endpoint, tokenData),
    'Authorization': `Bearer ${tokenData.accessToken}`,
    'X-No-User-Id': 'true',
    'X-No-Enterprise-Id': 'true',
    'X-No-Department-Info': 'true'
  };

  const accountDeadline = Math.min(deadline, Date.now() + 30000);
  while (Date.now() < accountDeadline) {
    const accRes = await fetchJson(
      `${endpoint}${AUTH_PREFIX}/login/account?state=${encodeURIComponent(state)}`,
      { headers: authHeaders }
    );
    if (accRes.json?.data) {
      account = accRes.json.data;
      break;
    }
    if (accRes.json?.code === LOGIN_ACCOUNT_PENDING_CODE) {
      await sleep(1000);
      continue;
    }
    break;
  }

  if (!account) {
    const listRes = await fetchJson(`${endpoint}${AUTH_PREFIX}/accounts`, {
      headers: {
        ...buildEnterpriseHeaders(endpoint, tokenData),
        'Authorization': `Bearer ${tokenData.accessToken}`
      }
    });
    const accounts = listRes.json?.data?.accounts;
    if (Array.isArray(accounts) && accounts.length > 0) {
      account = accounts.find(a => a.lastLogin) || accounts[0];
    }
  }

  const session = {
    endpoint: enterpriseHost(tokenData.domain) ? `https://${enterpriseHost(tokenData.domain)}` : endpoint,
    auth: tokenData,
    account: account ? {
      uid: account.uid,
      nickname: account.nickname || account.name || account.username,
      enterpriseId: account.enterpriseId,
      type: account.type
    } : null,
    updatedAt: Date.now()
  };

  writeCliSession(session);
  return session;
}

let refreshFlight = null;

async function refreshCliSessionOnce(session) {
  const endpoint = apiOrigin(session);
  const refreshToken = session.auth?.refreshToken;
  if (!refreshToken) {
    throw new Error('当前凭据缺少 refreshToken，请重新运行 "workbuddy login"');
  }

  const res = await fetchJson(`${endpoint}${AUTH_PREFIX}/auth/token/refresh`, {
    method: 'POST',
    headers: {
      ...buildEnterpriseHeaders(endpoint, session.auth, session.account),
      'X-Refresh-Token': refreshToken,
      'X-Auth-Refresh-Source': 'plugin'
    },
    body: '{}'
  });

  if (!res.ok || !res.json?.data?.accessToken) {
    throw new Error(`刷新登录态失败 (HTTP ${res.status}): ${res.json?.msg || res.text}，请重新运行 "workbuddy login"`);
  }

  const updated = {
    ...session,
    endpoint,
    auth: normalizeToken(res.json.data, session.auth?.domain || buildDomainHeader(endpoint)),
    updatedAt: Date.now()
  };
  writeCliSession(updated);
  return updated;
}

async function refreshCliSession(session) {
  if (isApiKeySession(session)) {
    throw new Error('API 密钥不会自动续期。请到密钥页核对后重新运行 "workbuddy login --api-key"');
  }
  if (!refreshFlight) {
    const flight = (async () => {
      const latest = readCliSession() || session;
      const stillCurrent = latest.auth?.accessToken
        && latest.auth.accessToken !== session.auth?.accessToken
        && latest.auth.expiresAt
        && Date.now() < latest.auth.expiresAt - 60000;
      if (stillCurrent) return latest;
      return refreshCliSessionOnce(latest.auth?.refreshToken ? latest : session);
    })().finally(() => {
      if (refreshFlight === flight) refreshFlight = null;
    });
    refreshFlight = flight;
  }
  return refreshFlight;
}

async function withFreshSession(session) {
  if (!accessShouldRenew(session)) return session;
  try {
    return await refreshCliSession(session);
  } catch (err) {
    if (session.auth?.expiresAt && Date.now() < session.auth.expiresAt - 60000) return session;
    throw err;
  }
}

async function logoutWorkBuddy() {
  const session = readCliSession();
  if (!session) {
    return { hadSession: false, serverRevoked: false };
  }

  let serverRevoked = false;
  const endpoint = session.endpoint || DEFAULT_ENDPOINT;
  const refreshToken = session.auth?.refreshToken;

  if (refreshToken) {
    try {
      const res = await fetchJson(`${endpoint}${AUTH_PREFIX}/auth/logout`, {
        method: 'POST',
        headers: {
          ...buildEnterpriseHeaders(endpoint, session.auth, session.account),
          'X-Refresh-Token': refreshToken,
          'X-Auth-Refresh-Source': 'plugin',
          'X-No-Authorization': 'true'
        },
        body: '{}'
      });
      serverRevoked = res.ok;
    } catch {
      serverRevoked = false;
    }
  }

  removeCliSession();
  return { hadSession: true, serverRevoked };
}

function createSseAccumulator(onDelta, onReasoning) {
  let text = '';
  let reasoning = '';
  let raw = '';
  const toolCalls = new Map();

  const absorbMessage = message => {
    if (!message) return;
    if (message.content) {
      text += message.content;
      onDelta?.(message.content);
    }
    const thought = typeof message.reasoning_content === 'string' && message.reasoning_content
      ? message.reasoning_content
      : typeof message.reasoning === 'string' ? message.reasoning : '';
    if (thought) {
      reasoning += thought;
      onReasoning?.(thought);
    }
    for (const call of message.tool_calls || []) {
      const idx = call.index ?? toolCalls.size;
      toolCalls.set(idx, {
        id: call.id || `call_${idx}`,
        name: call.function?.name || '',
        arguments: call.function?.arguments || ''
      });
    }
  };

  return {
    pushLine(line) {
      raw += `${line}\n`;
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') return;
      let parsed;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        return;
      }
      if (parsed.error) {
        const message = parsed.error.message || parsed.error.msg || JSON.stringify(parsed.error);
        throw new Error(message);
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        onDelta?.(delta.content);
      }
      const thought = typeof delta?.reasoning_content === 'string' && delta.reasoning_content
        ? delta.reasoning_content
        : typeof delta?.reasoning === 'string' ? delta.reasoning : '';
      if (thought) {
        reasoning += thought;
        onReasoning?.(thought);
      }
      for (const call of delta?.tool_calls || []) {
        const idx = call.index ?? 0;
        const current = toolCalls.get(idx) || { id: '', name: '', arguments: '' };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name += call.function.name;
        if (call.function?.arguments) current.arguments += call.function.arguments;
        toolCalls.set(idx, current);
      }
      if (!delta && choice?.message) absorbMessage(choice.message);
    },
    finish() {
      if (!text && toolCalls.size === 0) {
        const body = raw.trim();
        if (body.startsWith('{')) {
          try {
            const parsed = JSON.parse(body);
            absorbMessage(parsed.choices?.[0]?.message);
          } catch {}
        }
      }
      return {
        text,
        reasoning,
        toolCalls: [...toolCalls.values()].filter(call => call.name).map((call, index) => ({
          ...call,
          id: call.id || `call_${index}`
        }))
      };
    }
  };
}

function parseSseCompletion(raw) {
  const acc = createSseAccumulator();
  for (const line of String(raw || '').split(/\n/)) acc.pushLine(line);
  return acc.finish();
}

async function readSseResponse(res, onDelta, onReasoning) {
  if (!onDelta && !onReasoning) return parseSseCompletion(await res.text());
  const acc = createSseAccumulator(onDelta, onReasoning);
  if (!res.body?.getReader) return parseSseCompletion(await res.text());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) acc.pushLine(line);
  }
  if (buf) acc.pushLine(buf);
  return acc.finish();
}

function mockComplete({ messages, signal, onDelta }) {
  const lastUser = [...messages].reverse().find(message => message.role === 'user');
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';
  const hasToolResult = messages.some(message => message.role === 'tool');
  if (!hasToolResult && userText.includes('TOOL')) {
    return Promise.resolve({
      text: '',
      reasoning: '',
      toolCalls: [{ id: 'call_mock', name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) }]
    });
  }
  if (userText.includes('SLOW')) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ text: 'mock:slow-finished', reasoning: '', toolCalls: [] }), 30000);
      const abort = () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  const text = hasToolResult ? 'mock-after-tool' : `mock:${userText.slice(0, 200)}`;
  onDelta?.(text);
  return Promise.resolve({ text, reasoning: '', toolCalls: [] });
}

async function fetchDirectApi(session, method, apiPath, body) {
  let activeSession = await withFreshSession(session);

  const sendOnce = async s => {
    const endpoint = apiOrigin(s);
    const headers = apiAuthHeaders(s, { accept: 'application/json' });
    const init = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetchJson(`${endpoint}${apiPath}`, init);
  };

  let res = await sendOnce(activeSession);
  if (
    !isApiKeySession(activeSession)
    && activeSession.auth?.refreshToken
    && shouldRefreshAccessToken(res.status, res.wwwAuthenticate, res.text)
  ) {
    activeSession = await refreshCliSession(activeSession);
    res = await sendOnce(activeSession);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.json?.msg || res.json?.message || res.text}`);
  }

  return res.json?.data ?? res.json;
}

async function fetchIpcApi(method, apiPath, body) {
  const discoveryFile = path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json');
  if (!fs.existsSync(discoveryFile)) {
    throw new Error('WorkBuddy 桌面端未运行');
  }
  const discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));

  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: discovery.endpoint });
    let buffer = Buffer.alloc(0);
    const clientNonce = crypto.randomBytes(16).toString('base64url');
    const send = frame => socket.write(JSON.stringify(frame) + '\n');

    const timeoutTimer = setTimeout(() => {
      socket.destroy();
      reject(new Error('WBIPC 请求超时 (15s)'));
    }, 15000);

    socket.on('connect', () => {
      send({
        type: 'session_hello',
        protocol_min: PROTOCOL_VERSION,
        protocol_max: PROTOCOL_VERSION,
        client_nonce: clientNonce,
        ticket_id: ticketIdOf(discovery.ticket),
        client: { kind: 'cli', id: 'workbuddy-cli' }
      });
    });

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const nl = buffer.indexOf(0x0a);
        if (nl < 0) break;
        const line = buffer.subarray(0, nl);
        buffer = buffer.subarray(nl + 1);
        if (line.length === 0) continue;

        let f;
        try {
          f = JSON.parse(line.toString('utf8'));
        } catch {
          continue;
        }

        if (f.type === 'session_challenge') {
          send({
            type: 'session_prove',
            client_proof: computeProof(discovery.ticket, 'client', {
              protocol: PROTOCOL_VERSION,
              endpoint: discovery.endpoint,
              clientNonce,
              serverNonce: f.server_nonce
            })
          });
        } else if (f.type === 'session_hello_ack') {
          send({ jsonrpc: '2.0', id: 1, method: 'broker/GetPipe', params: { pipe: 'wb.request' } });
        } else if (f.id === 1) {
          if (f.error) {
            clearTimeout(timeoutTimer);
            socket.end();
            return reject(new Error(`GetPipe 错误: ${f.error.message}`));
          }
          const channel = f.result?.channel;
          const params = {
            method,
            path: apiPath,
            headers: { 'accept': 'application/json' }
          };
          if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
            params.headers['content-type'] = 'application/json';
            params.body_b64 = Buffer.from(JSON.stringify(body)).toString('base64');
          }
          send({ jsonrpc: '2.0', id: 2, method: `${channel}/http.fetch`, mode: 'call', params });
        } else if (f.id === 2) {
          clearTimeout(timeoutTimer);
          socket.end();
          if (f.error) return reject(new Error(f.error.message));
          const raw = f.result?.body_b64 ? Buffer.from(f.result.body_b64, 'base64').toString('utf8') : '';
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (f.result?.status && f.result.status >= 400) {
            return reject(new Error(`HTTP ${f.result.status}: ${parsed?.msg || parsed?.message || raw}`));
          }
          resolve(parsed?.data ?? parsed);
        }
      }
    });

    socket.on('error', err => {
      clearTimeout(timeoutTimer);
      reject(new Error(`连接 WorkBuddy 套接字失败: ${err.message}`));
    });
  });
}

async function scanAvailableModels(options = {}) {
  const cliSession = readCliSession();
  const discoveryFile = path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json');
  const hasIpc = fs.existsSync(discoveryFile);

  if (!cliSession?.auth?.accessToken && !hasIpc) {
    return { source: 'static', models: null, reason: '未登录且桌面端未运行' };
  }

  let lastErr = null;
  const readConfig = async () => {
    if (cliSession?.auth?.accessToken) return fetchDirectApi(cliSession, 'GET', '/v3/config');
    if (hasIpc) return fetchIpcApi('GET', '/v3/config');
    return null;
  };
  try {
    const config = await readConfig();
    const configured = modelsFromProductConfig(config, { includeAll: options.includeAll });
    if (configured.length) {
      return {
        source: cliSession?.auth?.accessToken ? 'remote-config' : 'remote-config-ipc',
        models: configured
      };
    }
  } catch (err) {
    lastErr = err;
  }

  const enterpriseId = cliSession?.account?.enterpriseId;
  const candidatePaths = enterpriseId
    ? [`/v2/enterprises/${encodeURIComponent(enterpriseId)}/models`, '/v2/enterprises/personal/models']
    : ['/v2/enterprises/personal/models'];

  let payload = null;
  for (const apiPath of candidatePaths) {
    try {
      payload = cliSession?.auth?.accessToken
        ? await fetchDirectApi(cliSession, 'GET', apiPath)
        : await fetchIpcApi('GET', apiPath);
      if (payload) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!payload) {
    throw lastErr || new Error('获取模型列表失败');
  }

  const rawList = Array.isArray(payload.models) ? payload.models : Array.isArray(payload) ? payload : [];
  const excludedTags = new Set(['text-to-image']);
  const models = options.includeAll
    ? rawList
    : rawList.filter(m => {
        if (!m || typeof m.id !== 'string' || !m.id) return false;
        const tags = Array.isArray(m.tags) ? m.tags.map(String) : [];
        return !tags.some(t => excludedTags.has(t));
      });

  return { source: cliSession?.auth?.accessToken ? 'remote-direct' : 'remote-ipc', models };
}

function buildReverseAliasMap() {
  const map = new Map();
  for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
    if (alias === target) continue;
    if (!map.has(target)) map.set(target, []);
    map.get(target).push(alias);
  }
  return map;
}

function printScannedModels(models, source) {
  const aliasMap = buildReverseAliasMap();
  console.log(`WorkBuddy 可用模型列表 (来源: ${source}, 共 ${models.length} 个):\n`);
  for (const m of models) {
    const aliases = aliasMap.get(m.id);
    const aliasText = aliases?.length ? ` (简写: ${aliases.join(', ')})` : '';
    const credits = m.credits ? ` [${m.credits}]` : '';
    const caps = [];
    if (m.supportsReasoning) caps.push('推理');
    if (m.supportsImages) caps.push('视觉');
    if (m.supportsToolCall) caps.push('工具');
    if (m.maxInputTokens) caps.push(`上下文 ${m.maxInputTokens}`);
    if (Array.isArray(m.tags) && m.tags.length) caps.push(m.tags.join(','));
    const capText = caps.length ? ` (${caps.join(' / ')})` : '';
    const title = m.name && m.name !== m.id ? ` — ${m.name}` : '';
    console.log(`  ${m.id}${aliasText}${title}${credits}${capText}`);
    const desc = m.descriptionZh || m.descriptionEn;
    if (desc) {
      console.log(`      ${desc}`);
    }
  }
  console.log(`\n提示: 使用 workbuddy -m <model_id> "..." 即可直接调用任意新模型，无需等待 CLI 更新。`);
}

function chatPayload(userPrompt, options = {}) {
  const { model = DEFAULT_MODEL, systemPrompt, tools } = options;
  const messages = options.messages
    ? options.messages.map(message => {
        const next = { role: message.role, content: message.content ?? '' };
        if (message.tool_calls) next.tool_calls = message.tool_calls;
        if (message.tool_call_id) next.tool_call_id = message.tool_call_id;
        if (message.name) next.name = message.name;
        if (typeof message.reasoning === 'string' && message.reasoning) next.reasoning = message.reasoning;
        if (typeof message.reasoning_content === 'string' && message.reasoning_content) next.reasoning_content = message.reasoning_content;
        if (Array.isArray(message.reasoning_details)) next.reasoning_details = message.reasoning_details;
        return next;
      })
    : [];
  if (!options.messages) {
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    if (userPrompt) messages.push({ role: 'user', content: userPrompt });
  } else if (!tools?.length) {
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].role === 'tool') {
        messages.splice(i, 1);
        i -= 1;
        continue;
      }
      if (messages[i].tool_calls) delete messages[i].tool_calls;
      if (!messages[i].content) {
        messages.splice(i, 1);
        i -= 1;
      }
    }
  }
  const payload = { model, messages, stream: true }; // the chat endpoint answers a stream
  if (tools?.length) payload.tools = tools;
  applyReasoning(payload, options.effort);
  return payload;
}

function linkAbortSignals(external, timeoutMs) {
  const controller = new AbortController();
  const seconds = Math.round(timeoutMs / 1000);
  const timer = setTimeout(() => {
    const err = new Error(`请求超时 (${seconds}s)`);
    err.name = 'TimeoutError';
    controller.abort(err);
  }, timeoutMs);
  const onAbort = () => controller.abort(external.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  };
}

function accountScope(session) {
  const key = isApiKeySession(session) ? session?.auth?.accessToken || '' : '';
  return `${session?.account?.uid || ''}|${session?.account?.enterpriseId || ''}|${key}`;
}

function chatBodies(userPrompt, options) {
  const prepared = prepareChat(chatPayload(userPrompt, options));
  return {
    names: prepared.names,
    bodies: [prepared.payload, ...refusalFallbacks(prepared.payload)]
  };
}

async function callWorkBuddyDirect(session, userPrompt, options = {}) {
  let activeSession = await withFreshSession(session);
  const { names, bodies } = chatBodies(userPrompt, options);
  const timeoutMs = options.timeoutMs || CHAT_TIMEOUT_MS;
  let refreshed = false;

  const sendRequest = async (s, payload, packed) => {
    const endpoint = apiOrigin(s);
    const headers = {
      'Content-Type': 'application/json',
      ...apiAuthHeaders(s, { accept: 'text/event-stream' }),
      ...conversationHeaders({
        sessionId: options.sessionId,
        messages: payload.messages,
        scope: accountScope(s)
      })
    };
    if (packed.encoding) headers['Content-Encoding'] = packed.encoding;

    const linked = linkAbortSignals(options.signal, timeoutMs);
    try {
      const res = await fetch(`${endpoint}/v2/chat/completions`, {
        method: 'POST',
        headers,
        body: packed.body,
        signal: linked.signal
      });
      if (!res.ok) {
        const raw = await res.text();
        return {
          status: res.status,
          raw,
          wwwAuthenticate: res.headers.get('www-authenticate') || '',
          completion: null
        };
      }
      const completion = await readSseResponse(res, options.onDelta, options.onReasoning);
      return { status: res.status, raw: '', completion };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || linked.signal.aborted) {
        if (options.signal?.aborted) {
          const aborted = new Error('cancelled');
          aborted.name = 'AbortError';
          throw aborted;
        }
        throw new Error(linked.signal.reason?.message || `请求超时 (${Math.round(timeoutMs / 1000)}s)`);
      }
      throw err;
    } finally {
      linked.close();
    }
  };

  let res = null;
  for (let i = 0; i < bodies.length; i += 1) {
    const payload = bodies[i];
    let packed = encodeChatBody(payload);
    res = await sendRequest(activeSession, payload, packed);
    if (
      !refreshed
      && !isApiKeySession(activeSession)
      && activeSession.auth?.refreshToken
      && shouldRefreshAccessToken(res.status, res.wwwAuthenticate, res.raw)
    ) {
      activeSession = await refreshCliSession(activeSession);
      refreshed = true;
      res = await sendRequest(activeSession, payload, packed);
    }
    if (gzipRejected(res.status, res.raw)) {
      packed = { body: JSON.stringify(payload), encoding: null };
      res = await sendRequest(activeSession, payload, packed);
    }
    if (res.status < 400) break;
    if (!isChannelRefusal(res.raw) || i === bodies.length - 1) break;
  }

  if (!res || res.status >= 400) {
    throw new Error(explainChatError(res?.status || 0, res?.raw || ''));
  }

  return restoreToolNames(res.completion, names);
}

async function callWorkBuddy(userPrompt, options = {}) {
  if (process.env.WORKBUDDY_ACP_MOCK === '1') {
    return mockComplete({
      messages: options.messages || chatPayload(userPrompt, options).messages,
      signal: options.signal,
      onDelta: options.onDelta
    });
  }

  const cliSession = readCliSession();
  if (cliSession?.auth?.accessToken) {
    return callWorkBuddyDirect(cliSession, userPrompt, options);
  }

  const discoveryFile = path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json');
  if (!fs.existsSync(discoveryFile)) {
    throw new Error('未登录且 WorkBuddy 桌面端未运行。请先运行 "workbuddy login" 登录，或启动 WorkBuddy 桌面端。');
  }

  let discovery;
  try {
    discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
  } catch (err) {
    throw new Error(`读取 WBIPC endpoint.json 失败: ${err.message}`);
  }

  const { names, bodies } = chatBodies(userPrompt, options);
  const timeoutMs = options.timeoutMs || CHAT_TIMEOUT_MS;

  const postOne = payload => new Promise((resolve, reject) => {
    const socket = net.connect({ path: discovery.endpoint });
    let buffer = Buffer.alloc(0);
    const clientNonce = crypto.randomBytes(16).toString('base64url');
    const send = frame => socket.write(JSON.stringify(frame) + '\n');
    let settled = false;
    let timeoutTimer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      socket.destroy();
      const err = new Error('cancelled');
      err.name = 'AbortError';
      finish(reject, err);
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    timeoutTimer = setTimeout(() => {
      socket.destroy();
      finish(reject, new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    socket.on('connect', () => {
      send({
        type: 'session_hello',
        protocol_min: PROTOCOL_VERSION,
        protocol_max: PROTOCOL_VERSION,
        client_nonce: clientNonce,
        ticket_id: ticketIdOf(discovery.ticket),
        client: { kind: 'cli', id: 'workbuddy-cli' }
      });
    });

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const nl = buffer.indexOf(0x0a);
        if (nl < 0) break;
        const line = buffer.subarray(0, nl);
        buffer = buffer.subarray(nl + 1);
        if (line.length === 0) continue;

        let f;
        try {
          f = JSON.parse(line.toString('utf8'));
        } catch {
          continue;
        }

        if (f.type === 'session_challenge') {
          const transcript = {
            protocol: PROTOCOL_VERSION,
            endpoint: discovery.endpoint,
            clientNonce,
            serverNonce: f.server_nonce
          };
          send({
            type: 'session_prove',
            client_proof: computeProof(discovery.ticket, 'client', transcript)
          });
        } else if (f.type === 'session_hello_ack') {
          send({ jsonrpc: '2.0', id: 1, method: 'broker/GetPipe', params: { pipe: 'wb.request' } });
        } else if (f.id === 1) {
          if (f.error) {
            socket.end();
            return finish(reject, new Error(`GetPipe 错误: ${f.error.message}`));
          }
          const channel = f.result?.channel;
          send({
            jsonrpc: '2.0',
            id: 2,
            method: `${channel}/http.fetch`,
            mode: 'call',
            params: {
              method: 'POST',
              path: '/v2/chat/completions',
              headers: {
                'content-type': 'application/json',
                'accept': 'text/event-stream'
              },
              body_b64: Buffer.from(JSON.stringify(payload)).toString('base64')
            }
          });
        } else if (f.id === 2) {
          socket.end();

          if (f.error) {
            return finish(reject, new Error(f.error.message));
          }

          if (f.result?.status && f.result.status >= 400) {
            let bodyStr = '';
            if (f.result.body_b64) {
              try {
                bodyStr = Buffer.from(f.result.body_b64, 'base64').toString('utf8');
              } catch {}
            }
            const error = new Error(explainChatError(f.result.status, bodyStr));
            error.raw = bodyStr;
            return finish(reject, error);
          }

          if (!f.result || !f.result.body_b64) {
            return finish(resolve, { text: '', reasoning: '', toolCalls: [] });
          }

          const raw = Buffer.from(f.result.body_b64, 'base64').toString('utf8');
          const completion = parseSseCompletion(raw);
          if (completion.text) options.onDelta?.(completion.text);
          if (completion.reasoning) options.onReasoning?.(completion.reasoning);
          finish(resolve, completion);
        }
      }
    });

    socket.on('error', err => {
      finish(reject, new Error(`连接 WorkBuddy 套接字失败: ${err.message}`));
    });
  });

  let lastError = null;
  for (let i = 0; i < bodies.length; i += 1) {
    try {
      const completion = await postOne(bodies[i]);
      return restoreToolNames(completion, names);
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || !isChannelRefusal(err.raw || err.message) || i === bodies.length - 1) throw err;
    }
  }
  throw lastError;
}

function getStatusInfo() {
  const cliSession = readCliSession();
  const discoveryFile = path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json');
  const desktopRunning = fs.existsSync(discoveryFile);
  return {
    cliLoggedIn: Boolean(cliSession?.auth?.accessToken),
    authFile: AUTH_FILE,
    endpoint: cliSession?.endpoint || DEFAULT_ENDPOINT,
    account: cliSession?.account || null,
    expiresAt: cliSession?.auth?.expiresAt ? new Date(cliSession.auth.expiresAt).toISOString() : null,
    authSource: cliSession ? (isApiKeySession(cliSession) ? 'api-key' : 'browser') : null,
    domain: cliSession?.auth?.domain || null,
    apiOrigin: cliSession ? apiOrigin(cliSession) : null,
    desktopWbicpRunning: desktopRunning
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'login') {
    try {
      const session = args.apiKey
        ? await loginWithApiKey()
        : await loginWorkBuddy({ noBrowser: args.noBrowser });
      if (args.asJson) {
        console.log(JSON.stringify({
          ok: true,
          account: session.account,
          authSource: isApiKeySession(session) ? 'api-key' : 'browser',
          apiOrigin: apiOrigin(session),
          authFile: AUTH_FILE
        }, null, 2));
      } else if (isApiKeySession(session)) {
        console.log('登录成功。已保存 API 密钥，请求会计入该密钥对应的套餐。');
        console.log(`凭据已保存至: ${AUTH_FILE}`);
      } else {
        const who = session.account?.nickname || session.account?.uid || 'Unknown';
        console.log(`登录成功！当前账号: ${who}`);
        if (enterpriseHost(session.auth?.domain)) console.log(`企业域名: ${apiOrigin(session)}`);
        console.log(`凭据已保存至: ${AUTH_FILE}（后续无需再开启 WorkBuddy 客户端）`);
      }
    } catch (err) {
      if (args.asJson) {
        console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    }
    return;
  }

  if (args.command === 'logout') {
    const result = await logoutWorkBuddy();
    if (args.asJson) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } else if (!result.hadSession) {
      console.log('当前未登录 CLI 会话。');
    } else {
      console.log('已退出登录并清理本地 CLI 凭据。');
    }
    return;
  }

  if (args.command === 'status') {
    const info = getStatusInfo();
    if (args.asJson) {
      console.log(JSON.stringify({ ok: true, data: info }, null, 2));
    } else {
      console.log(`CLI 独立登录: ${info.cliLoggedIn ? '已登录' : '未登录'}`);
      if (info.cliLoggedIn) {
        const who = info.account?.nickname || info.account?.uid || '(未知用户)';
        console.log(`当前账号: ${who}`);
        console.log(`登录方式: ${info.authSource === 'api-key' ? 'API 密钥' : '浏览器授权'}`);
        if (info.domain) console.log(`账号域名: ${info.domain}`);
        if (info.apiOrigin) console.log(`接口地址: ${info.apiOrigin}`);
        if (info.expiresAt) console.log(`Token 过期时间: ${info.expiresAt}`);
        console.log(`凭据文件: ${info.authFile}`);
      }
      console.log(`桌面端 WBIPC: ${info.desktopWbicpRunning ? '运行中' : '未运行'}`);
    }
    return;
  }

  if (args.command === 'models') {
    if (args.staticModels) {
      if (args.asJson) {
        console.log(JSON.stringify({ ok: true, source: 'static', aliases: MODEL_ALIASES }, null, 2));
      } else {
        showModels();
      }
      return;
    }

    try {
      const result = await scanAvailableModels({ includeAll: args.includeAllModels });
      if (!result.models) {
        if (args.asJson) {
          console.log(JSON.stringify({ ok: true, source: 'static', note: result.reason, aliases: MODEL_ALIASES }, null, 2));
        } else {
          console.error(`提示: ${result.reason}，以下为内置静态模型清单；运行 "workbuddy login" 后可实时扫描服务端最新模型。\n`);
          showModels();
        }
        return;
      }

      if (args.asJson) {
        console.log(JSON.stringify({ ok: true, source: result.source, count: result.models.length, models: result.models }, null, 2));
      } else {
        printScannedModels(result.models, result.source);
      }
    } catch (err) {
      if (args.asJson) {
        console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
      } else {
        console.error(`扫描服务端模型失败 (${err.message})，回退到内置清单：\n`);
        showModels();
      }
      process.exit(1);
    }
    return;
  }

  if (args.command === 'acp') {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    let version = '1.4.0';
    try {
      version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || version;
    } catch {}
    let models = acpModels();
    let defaultModel = args.modelExplicit ? args.model : DEFAULT_MODEL;
    if (process.env.WORKBUDDY_ACP_MOCK !== '1') {
      try {
        const result = await scanAvailableModels();
        if (result.models?.length) {
          installModelProfiles(result.models);
          const live = acpModelsFromCatalog(result.models);
          if (live.length) {
            models = live;
            if (!args.modelExplicit) defaultModel = accountDefaultModel(result.models) || defaultModel;
          }
        }
      } catch (err) {
        console.error(`模型列表扫描失败，T3 将使用内置清单: ${err.message}`);
      }
    }
    await runAcpServer({
      version,
      defaultModel,
      models,
      isLoggedIn: () => process.env.WORKBUDDY_ACP_MOCK === '1' || Boolean(readCliSession()?.auth?.accessToken),
      logout: logoutWorkBuddy,
      completeChat: options => callWorkBuddy('', options)
    });
    return;
  }

  if (args.command === 'sessions' || (args.resumeId === '' && !args.prompt)) {
    printSessions(args.asJson);
    return;
  }

  let userPrompt = args.prompt;

  // 如果没有从命令行参数提供 prompt，检查 stdin 是否有输入（例如管道传参）
  if (!userPrompt && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    userPrompt = Buffer.concat(chunks).toString('utf8').trim();
  }

  if (!userPrompt) {
    showHelp();
    process.exit(1);
  }

  let stored = null;
  try {
    if (args.resumeId) {
      stored = loadSession(args.resumeId);
      if (!stored) throw new Error(`找不到会话 ${args.resumeId}。运行 workbuddy sessions 查看已保存的对话。`);
    } else if (args.continueSession) {
      stored = latestSession(process.cwd());
      if (!stored) throw new Error('当前目录没有可继续的会话。先直接提问一次，或用 workbuddy resume <id>。');
    }
  } catch (err) {
    if (args.asJson) console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    else console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let catalog = null;
  if (process.env.WORKBUDDY_ACP_MOCK !== '1' && readCliSession()?.auth?.accessToken) {
    try {
      catalog = await scanAvailableModels();
      if (catalog.models?.length) installModelProfiles(catalog.models);
    } catch (err) {
      if (!args.asJson) console.error(`模型列表暂不可用，思考等级使用内置配置: ${err.message}`);
    }
  }

  const sessionId = stored?.id || args.sessionId || createSessionId();
  const messages = [...(stored?.messages || [])];
  if (args.systemExplicit) {
    const rest = messages.filter(message => message.role !== 'system');
    messages.length = 0;
    if (args.systemPrompt) messages.push({ role: 'system', content: args.systemPrompt });
    messages.push(...rest);
  }
  messages.push({ role: 'user', content: userPrompt });
  const model = args.modelExplicit
    ? args.model
    : (stored?.model || accountDefaultModel(catalog?.models) || args.model);
  let effort;
  if (args.effortExplicit) {
    effort = parseEffort(args.effort);
    if (effort == null) {
      const message = '思考等级只能是 minimal、low、medium、high、xhigh、max 或 off';
      if (args.asJson) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
      else console.error(`Error: ${message}`);
      process.exit(1);
    }
  } else if (stored && Object.prototype.hasOwnProperty.call(stored, 'effort')) {
    effort = stored.effort;
  }
  const resolvedEffort = resolveEffort(model, effort);
  if (resolvedEffort.error) {
    if (args.asJson) console.error(JSON.stringify({ ok: false, error: resolvedEffort.error }, null, 2));
    else console.error(`Error: ${resolvedEffort.error}`);
    process.exit(1);
  }

  try {
    let streamed = false;
    let reasoningStarted = false;
    const showReasoning = !args.asJson && process.env.WORKBUDDY_SHOW_REASONING === '1';
    const result = await callWorkBuddy(userPrompt, {
      model,
      messages,
      systemPrompt: args.systemPrompt,
      effort: resolvedEffort.effort,
      sessionId,
      onDelta: args.asJson ? undefined : chunk => {
        streamed = true;
        process.stdout.write(chunk);
      },
      onReasoning: showReasoning ? chunk => {
        if (!reasoningStarted) {
          process.stderr.write('[思考过程]\n');
          reasoningStarted = true;
        }
        process.stderr.write(chunk);
      } : undefined
    });
    const assistant = { role: 'assistant', content: result.text || '' };
    if (result.reasoning) assistant.reasoning = result.reasoning;
    const saved = saveSession({
      id: sessionId,
      cwd: stored?.cwd || process.cwd(),
      model,
      effort: resolvedEffort.effort,
      title: stored?.title || userPrompt.slice(0, 48),
      mode: stored?.mode || 'default',
      createdAt: stored?.createdAt || Date.now(),
      updatedAt: Date.now(),
      messages: [
        ...messages,
        assistant
      ]
    });

    if (args.asJson) {
      console.log(JSON.stringify({ ok: true, data: { ...result, sessionId: saved.id, effort: saved.effort } }, null, 2));
    } else {
      if (reasoningStarted) process.stderr.write('\n\n');
      if (streamed) process.stdout.write('\n');
      else console.log(result.text);
      if (process.stderr.isTTY) {
        console.error(`会话 ${saved.id} 已保存。继续：workbuddy -c`);
      }
    }
  } catch (err) {
    if (args.asJson) {
      console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

main();

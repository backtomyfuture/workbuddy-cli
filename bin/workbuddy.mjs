#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = 1;

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
  console.log(`Usage: workbuddy [options] [prompt]

Interact with your local WorkBuddy desktop app via WBIPC.

Arguments:
  prompt                  Your prompt / question

Options:
  -p, --print             Print response and exit (default behavior)
  -m, --model <model>     Model name or alias (e.g. hy4, deepseek, glm, default: deepseek-v3-2-volc)
  -l, --models            List available models and aliases
  --json                  Output response as JSON
  -s, --system <prompt>   System prompt
  -h, --help              Show this help message

Examples:
  workbuddy "用Python写一个快速排序"
  workbuddy -m hy4 "帮我写一封商务邮件"
  cat document.txt | workbuddy -p "总结主要内容"
  workbuddy --model glm "写一首五言绝句"
`);
}

function parseArgs(args) {
  let prompt = '';
  let model = 'deepseek-v3-2-volc';
  let asJson = false;
  let systemPrompt = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-l' || arg === '--models') {
      showModels();
      process.exit(0);
    } else if (arg === '-p' || arg === '--print') {
      // default
    } else if (arg === '--json') {
      asJson = true;
    } else if (arg === '-m' || arg === '--model') {
      model = args[++i];
    } else if (arg.startsWith('--model=')) {
      model = arg.slice(8);
    } else if (arg === '-s' || arg === '--system') {
      systemPrompt = args[++i];
    } else if (arg.startsWith('--system=')) {
      systemPrompt = arg.slice(9);
    } else if (!arg.startsWith('-')) {
      prompt = prompt ? `${prompt} ${arg}` : arg;
    }
  }

  // Resolve alias
  if (model && MODEL_ALIASES[model.toLowerCase()]) {
    model = MODEL_ALIASES[model.toLowerCase()];
  }

  return { prompt, model, asJson, systemPrompt };
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

async function callWorkBuddy(userPrompt, options = {}) {
  const discoveryFile = path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json');
  if (!fs.existsSync(discoveryFile)) {
    throw new Error('WorkBuddy 桌面端未运行，未找到 WBIPC 端点。请先启动 WorkBuddy (open -a WorkBuddy)。');
  }

  let discovery;
  try {
    discovery = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
  } catch (err) {
    throw new Error(`读取 WBIPC endpoint.json 失败: ${err.message}`);
  }

  const { model = 'deepseek-v3-2-volc', systemPrompt } = options;

  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: discovery.endpoint });
    let buffer = Buffer.alloc(0);
    const clientNonce = crypto.randomBytes(16).toString('base64url');
    const send = frame => socket.write(JSON.stringify(frame) + '\n');

    let timeoutTimer = setTimeout(() => {
      socket.destroy();
      reject(new Error('请求超时 (60s)'));
    }, 60000);

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
            clearTimeout(timeoutTimer);
            socket.end();
            return reject(new Error(`GetPipe 错误: ${f.error.message}`));
          }
          const channel = f.result?.channel;
          const messages = [];
          if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
          }
          messages.push({ role: 'user', content: userPrompt });

          const payload = {
            model,
            messages,
            stream: true
          };

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
          clearTimeout(timeoutTimer);
          socket.end();

          if (f.error) {
            return reject(new Error(f.error.message));
          }

          if (f.result?.status && f.result.status >= 400) {
            let errorText = `HTTP ${f.result.status}`;
            if (f.result.body_b64) {
              try {
                const bodyStr = Buffer.from(f.result.body_b64, 'base64').toString('utf8');
                const errJson = JSON.parse(bodyStr);
                errorText += `: ${errJson.msg || errJson.message || bodyStr}`;
              } catch {}
            }
            return reject(new Error(errorText));
          }

          if (!f.result || !f.result.body_b64) {
            return resolve({ text: '', reasoning: '' });
          }

          const raw = Buffer.from(f.result.body_b64, 'base64').toString('utf8');
          let fullText = '';
          let reasoning = '';

          for (const line of raw.split('\n')) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) fullText += delta.content;
                if (delta?.reasoning_content) reasoning += delta.reasoning_content;
              } catch {}
            }
          }

          resolve({ text: fullText, reasoning });
        }
      }
    });

    socket.on('error', err => {
      clearTimeout(timeoutTimer);
      reject(new Error(`连接 WorkBuddy 套接字失败: ${err.message}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

  try {
    const result = await callWorkBuddy(userPrompt, {
      model: args.model,
      systemPrompt: args.systemPrompt
    });

    if (args.asJson) {
      console.log(JSON.stringify({ ok: true, data: result }, null, 2));
    } else {
      if (result.reasoning && process.env.WORKBUDDY_SHOW_REASONING === '1') {
        console.error(`[思考过程]\n${result.reasoning}\n`);
      }
      console.log(result.text);
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

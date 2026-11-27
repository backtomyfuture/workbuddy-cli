import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSessionId,
  listSessions,
  loadSession,
  saveSession
} from './sessions.mjs';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file in the working directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the working directory.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path. Defaults to the working directory.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command in the working directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command']
      }
    }
  }
];

const TOOL_KIND = {
  read_file: 'read',
  list_dir: 'search',
  write_file: 'edit',
  bash: 'execute'
};

function debug(message) {
  if (process.env.WORKBUDDY_ACP_DEBUG === '1') {
    process.stderr.write(`[acp] ${message}\n`);
  }
}

function promptToText(blocks) {
  const parts = [];
  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) parts.push(String(block.text));
    else if (block.type === 'resource' && block.resource?.text) {
      const uri = block.resource.uri || '';
      parts.push(`<resource uri="${uri}">\n${block.resource.text}\n</resource>`);
    } else if (block.type === 'resource_link') {
      parts.push(`[resource] ${block.uri || block.name || ''}`);
    } else if (block.type === 'image') {
      parts.push('[image omitted: this agent accepts text only]');
    }
  }
  return parts.join('\n').trim();
}

function withinCwd(cwd, target) {
  const root = path.resolve(cwd);
  const resolved = path.resolve(cwd, target || '.');
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function windowMessages(messages) {
  const systems = messages.filter(message => message.role === 'system');
  const rest = messages.filter(message => message.role !== 'system');
  const tail = rest.slice(-40);
  while (tail.length && tail[0].role === 'tool') tail.shift();
  return [...systems, ...tail];
}

function publicMessages(messages) {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : ''
    }))
    .filter(message => message.content);
}

export async function runAcpServer(deps) {
  const active = new Map();
  const aborters = new Map();
  const pending = new Map();
  const chains = new Map();
  let nextId = 1;
  let clientCapabilities = {};
  const defaultModel = deps.defaultModel;

  const send = obj => {
    process.stdout.write(JSON.stringify(obj) + '\n');
  };

  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  function rpcCall(method, params, signal) {
    const id = `wbcli-${nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ACP 客户端超时: ${method}`));
      }, 120000);
      const onAbort = () => {
        clearTimeout(timer);
        pending.delete(id);
        const err = new Error('cancelled');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: err => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        }
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  function notify(sessionId, update) {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  function modelCatalog(current) {
    const models = deps.models.map(model => ({ ...model }));
    if (current && !models.some(model => model.modelId === current)) {
      models.unshift({ modelId: current, name: current });
    }
    return models;
  }

  function sessionPayload(session) {
    const availableModels = modelCatalog(session.model);
    return {
      sessionId: session.id,
      models: {
        currentModelId: session.model,
        availableModels
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: session.model,
          options: availableModels.map(model => ({ value: model.modelId, name: model.name }))
        }
      ]
    };
  }

  function systemPrompt(cwd) {
    return `You are WorkBuddy, a coding assistant connected through the Agent Client Protocol. The working directory is ${cwd}. Use read_file, list_dir, write_file, and bash to inspect and change the project. Do not invent file contents. Reply in the user's language.`;
  }

  function activate(session) {
    active.set(session.id, session);
    return session;
  }

  function requireSession(id) {
    const cached = active.get(id);
    if (cached) return cached;
    const loaded = loadSession(id);
    if (!loaded) return null;
    return activate(loaded);
  }

  async function requestPermission(sessionId, toolCall, signal) {
    try {
      const result = await rpcCall('session/request_permission', {
        sessionId,
        toolCall,
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
        ]
      }, signal);
      const outcome = result?.outcome;
      if (outcome?.outcome === 'selected') {
        return outcome.optionId === 'allow-once' || outcome.optionId === 'allow-always';
      }
      return false;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const code = err?.code;
      if (code === -32601) return true;
      throw err;
    }
  }

  async function readFile(session, filePath, signal) {
    const absolute = path.resolve(session.cwd, filePath);
    if (clientCapabilities.fs?.readTextFile) {
      const result = await rpcCall('fs/read_text_file', {
        sessionId: session.id,
        path: absolute,
        line: 1,
        limit: 400
      }, signal);
      return result?.content ?? '';
    }
    const local = withinCwd(session.cwd, filePath);
    if (!local) return `拒绝读取工作区之外的文件: ${filePath}`;
    return fs.readFileSync(local, 'utf8');
  }

  function listDir(session, dirPath) {
    const local = withinCwd(session.cwd, dirPath || '.');
    if (!local) return `拒绝列出工作区之外的目录: ${dirPath || '.'}`;
    const entries = fs.readdirSync(local, { withFileTypes: true });
    return entries
      .slice(0, 200)
      .map(entry => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`)
      .join('\n');
  }

  async function writeFile(session, filePath, content, signal) {
    const absolute = path.resolve(session.cwd, filePath);
    if (clientCapabilities.fs?.writeTextFile) {
      await rpcCall('fs/write_text_file', {
        sessionId: session.id,
        path: absolute,
        content: String(content ?? '')
      }, signal);
      return `已写入 ${absolute}`;
    }
    const local = withinCwd(session.cwd, filePath);
    if (!local) return `拒绝写入工作区之外的文件: ${filePath}`;
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, String(content ?? ''));
    return `已写入 ${local}`;
  }

  async function runBash(session, command, signal) {
    if (clientCapabilities.terminal) {
      try {
        const created = await rpcCall('terminal/create', {
          sessionId: session.id,
          command: 'bash',
          args: ['-lc', command],
          cwd: session.cwd,
          outputByteLimit: 20000
        }, signal);
        const terminalId = created?.terminalId;
        if (!terminalId) throw new Error('terminal/create 没有返回 terminalId');
        const exit = await rpcCall('terminal/wait_for_exit', { sessionId: session.id, terminalId }, signal);
        const output = await rpcCall('terminal/output', { sessionId: session.id, terminalId }, signal);
        await rpcCall('terminal/release', { sessionId: session.id, terminalId }).catch(() => {});
        const text = output?.output || '';
        const exitCode = exit?.exitCode ?? output?.exitStatus?.exitCode ?? 0;
        return `${text}${text.endsWith('\n') || !text ? '' : '\n'}exit ${exitCode}`;
      } catch (err) {
        if (err?.name === 'AbortError' || err?.code !== -32601) throw err;
      }
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error('cancelled');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      const child = spawn('bash', ['-lc', command], {
        cwd: session.cwd,
        env: process.env
      });
      let output = '';
      const append = chunk => {
        output += chunk.toString('utf8');
        if (output.length > 20000) output = output.slice(0, 20000) + '\n[truncated]';
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
      const onAbort = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', err => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          const err = new Error('cancelled');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        resolve(`${output}${output.endsWith('\n') || !output ? '' : '\n'}exit ${code ?? 0}`);
      });
    });
  }

  async function executeTool(session, call, signal) {
    const args = JSON.parse(call.arguments || '{}');
    const toolCallId = call.id;
    const title = `${call.name} ${args.path || args.command || ''}`.trim();
    const kind = TOOL_KIND[call.name] || 'other';
    const rawInput = args;
    notify(session.id, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      kind,
      status: 'pending',
      rawInput
    });

    const needsPermission = call.name === 'write_file' || call.name === 'bash' || call.name === 'read_file';
    if (needsPermission) {
      const allowed = await requestPermission(session.id, {
        toolCallId,
        title,
        kind,
        status: 'pending',
        rawInput
      }, signal);
      if (!allowed) {
        notify(session.id, {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: '用户拒绝了这次工具调用。' } }]
        });
        return '用户拒绝了这次工具调用。';
      }
    }

    notify(session.id, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });
    let text = '';
    if (call.name === 'read_file') text = await readFile(session, args.path, signal);
    else if (call.name === 'list_dir') text = listDir(session, args.path);
    else if (call.name === 'write_file') text = await writeFile(session, args.path, args.content, signal);
    else if (call.name === 'bash') text = await runBash(session, String(args.command || ''), signal);
    else text = `未知工具: ${call.name}`;

    const shown = text.length > 8000 ? `${text.slice(0, 8000)}\n[truncated]` : text;
    notify(session.id, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput: shown,
      content: [{ type: 'content', content: { type: 'text', text: shown } }]
    });
    return shown;
  }

  async function runTurn(session, signal) {
    const planNote = session.mode === 'plan'
      ? [{ role: 'system', content: 'Plan mode is active. Do not modify files or run commands. Read the project and answer with a plan.' }]
      : [];
    for (let round = 0; round < 12; round += 1) {
      if (signal.aborted) {
        const err = new Error('cancelled');
        err.name = 'AbortError';
        throw err;
      }
      const messages = windowMessages([...planNote, ...session.messages]);
      let streamed = '';
      const result = await deps.completeChat({
        messages,
        model: session.model || defaultModel,
        tools: session.mode === 'plan' ? TOOLS.filter(tool => tool.function.name === 'read_file' || tool.function.name === 'list_dir') : TOOLS,
        signal,
        timeoutMs: 180000,
        onDelta: delta => {
          streamed += delta;
          notify(session.id, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: delta }
          });
        },
        onReasoning: delta => {
          notify(session.id, {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: delta }
          });
        }
      });
      const toolCalls = result.toolCalls || [];
      if (!toolCalls.length) {
        const text = result.text || streamed;
        if (text && !streamed) {
          notify(session.id, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text }
          });
        }
        session.messages.push({ role: 'assistant', content: text });
        session.updatedAt = Date.now();
        saveSession(session);
        return;
      }

      session.messages.push({
        role: 'assistant',
        content: result.text || '',
        tool_calls: toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments }
        }))
      });
      for (const call of toolCalls) {
        let toolText = '';
        try {
          toolText = await executeTool(session, call, signal);
        } catch (err) {
          if (err?.name === 'AbortError' || signal.aborted) throw err;
          toolText = `工具执行失败: ${err.message}`;
          notify(session.id, {
            sessionUpdate: 'tool_call_update',
            toolCallId: call.id,
            status: 'failed',
            content: [{ type: 'content', content: { type: 'text', text: toolText } }]
          });
        }
        session.messages.push({ role: 'tool', tool_call_id: call.id, content: toolText });
      }
      session.updatedAt = Date.now();
      saveSession(session);
    }
    const text = '已达到单轮工具调用上限，停在这里。';
    notify(session.id, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text }
    });
    session.messages.push({ role: 'assistant', content: text });
    session.updatedAt = Date.now();
    saveSession(session);
  }

  function replay(session) {
    for (const message of publicMessages(session.messages)) {
      notify(session.id, {
        sessionUpdate: message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
        content: { type: 'text', text: message.content }
      });
    }
  }

  async function handlePrompt(msg) {
    const sessionId = msg.params?.sessionId;
    const session = sessionId ? requireSession(sessionId) : null;
    if (!session) {
      fail(msg.id, -32002, `Session not found: ${sessionId || ''}`);
      return;
    }
    if (!deps.isLoggedIn()) {
      fail(msg.id, -32000, 'Authentication required. Run `workbuddy login` first.');
      return;
    }
    const text = promptToText(msg.params?.prompt);
    if (!text) {
      fail(msg.id, -32602, 'session/prompt requires a text prompt');
      return;
    }
    const controller = new AbortController();
    aborters.set(session.id, controller);
    try {
      if (!session.title) session.title = text.slice(0, 48);
      session.messages.push({ role: 'user', content: text });
      session.updatedAt = Date.now();
      saveSession(session);
      await runTurn(session, controller.signal);
      reply(msg.id, { stopReason: controller.signal.aborted ? 'cancelled' : 'end_turn' });
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        reply(msg.id, { stopReason: 'cancelled' });
      } else {
        fail(msg.id, -32603, err.message || 'prompt failed');
      }
    } finally {
      aborters.delete(session.id);
    }
  }

  function enqueuePrompt(msg) {
    const sessionId = msg.params?.sessionId || '_';
    const prev = chains.get(sessionId) || Promise.resolve();
    const next = prev.then(() => handlePrompt(msg), () => handlePrompt(msg));
    chains.set(sessionId, next);
  }

  function loggedInMethods() {
    if (deps.isLoggedIn()) return [];
    return [
      {
        id: 'workbuddy-login',
        name: '浏览器登录 WorkBuddy',
        description: '在终端运行 workbuddy login，完成后 T3 Code 会重新连接。',
        type: 'terminal',
        args: ['login'],
        env: []
      }
    ];
  }

  function onRequest(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      const requested = Number(params?.protocolVersion || 1);
      if (!Number.isFinite(requested) || requested < 1) {
        fail(id, -32022, 'Unsupported protocol version');
        return;
      }
      clientCapabilities = params?.clientCapabilities || params?.capabilities || {};
      reply(id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: true
          }
        },
        agentInfo: {
          name: 'workbuddy-cli',
          title: 'WorkBuddy CLI',
          version: deps.version
        },
        authMethods: loggedInMethods()
      });
      return;
    }
    if (method === 'authenticate') {
      fail(id, -32602, 'Use the terminal login method: workbuddy login');
      return;
    }
    if (method === 'auth/logout' || method === 'logout') {
      Promise.resolve(deps.logout()).then(
        () => reply(id, {}),
        err => fail(id, -32603, err.message || 'logout failed')
      );
      return;
    }
    if (method === 'session/new') {
      const cwd = params?.cwd || process.cwd();
      const model = params?.model || params?._meta?.model || defaultModel;
      const session = activate(saveSession({
        id: createSessionId(),
        cwd,
        model,
        title: '',
        mode: 'default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ role: 'system', content: systemPrompt(cwd) }]
      }));
      reply(id, sessionPayload(session));
      return;
    }
    if (method === 'session/load' || method === 'session/resume') {
      const session = requireSession(params?.sessionId);
      if (!session) {
        fail(id, -32002, `Session not found: ${params?.sessionId || ''}`);
        return;
      }
      if (params?.cwd) session.cwd = params.cwd;
      replay(session);
      reply(id, sessionPayload(session));
      return;
    }
    if (method === 'session/list') {
      const sessions = listSessions().slice(0, 100).map(session => ({
        sessionId: session.id,
        cwd: session.cwd,
        title: session.title || '',
        updatedAt: new Date(session.updatedAt || session.createdAt || Date.now()).toISOString()
      }));
      reply(id, { sessions });
      return;
    }
    if (method === 'session/close') {
      active.delete(params?.sessionId);
      reply(id, {});
      return;
    }
    if (method === 'session/cancel') {
      aborters.get(params?.sessionId)?.abort();
      if (id !== undefined) reply(id, {});
      return;
    }
    if (method === 'session/prompt') {
      enqueuePrompt(msg);
      return;
    }
    if (method === 'session/set_model') {
      const session = requireSession(params?.sessionId);
      if (!session) {
        fail(id, -32002, `Session not found: ${params?.sessionId || ''}`);
        return;
      }
      session.model = params?.modelId || session.model;
      session.updatedAt = Date.now();
      saveSession(session);
      reply(id, sessionPayload(session));
      return;
    }
    if (method === 'session/set_config_option') {
      const session = requireSession(params?.sessionId);
      if (!session) {
        fail(id, -32002, `Session not found: ${params?.sessionId || ''}`);
        return;
      }
      if (params?.configId === 'model' && params?.value) session.model = String(params.value);
      session.updatedAt = Date.now();
      saveSession(session);
      reply(id, {
        configOptions: sessionPayload(session).configOptions
      });
      return;
    }
    if (method === 'session/set_mode') {
      const session = requireSession(params?.sessionId);
      if (!session) {
        fail(id, -32002, `Session not found: ${params?.sessionId || ''}`);
        return;
      }
      session.mode = params?.modeId || 'default';
      session.updatedAt = Date.now();
      saveSession(session);
      reply(id, {});
      return;
    }
    fail(id, -32601, `Method not found: ${method}`);
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.method && msg.id !== undefined) {
      onRequest(msg);
      return;
    }
    if (msg.id !== undefined && (Object.prototype.hasOwnProperty.call(msg, 'result') || msg.error)) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message || 'ACP client error');
        err.code = msg.error.code;
        waiter.reject(err);
      } else {
        waiter.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'session/cancel') {
      aborters.get(msg.params?.sessionId)?.abort();
    }
  }

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (err) {
        debug(err.message);
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
    }
  });

  await new Promise(resolve => {
    process.stdin.on('end', resolve);
    process.stdin.resume();
  });
}

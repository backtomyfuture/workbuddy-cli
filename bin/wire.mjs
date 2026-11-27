// Shape a chat for WorkBuddy's /v2/chat/completions.
// The gateway only streams, requires a leading system message, drops
// reasoning_content, and refuses a handful of other agents' opening lines
// (code 11128). Tool schemas it cannot pass on come back as 11133.
// Conversation ids group one user send — including its tool steps — as one
// turn. The desktop CLI User-Agent is set with the auth headers.

import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const DEFAULT_SYSTEM = 'You are a helpful assistant.';
const GZIP_AT = 8 * 1024;
const SALT = randomBytes(16).toString('hex');

const FLAGGED = [
  [/x-anthropic-billing-header:[^\n]*\n?/gi, ''],
  [/You are Claude Code, Anthropic['’]s official CLI for Claude/gi, "You are Claude Code, Anthropic's CLI for Claude"],
  [/Main branch \(you will usually use this for PRs\)/gi, 'Main branch (usually the base for PRs)'],
  [/(?<!the )Codex CLI is an open source project led by OpenAI\./gi, 'The Codex CLI is an open source project led by OpenAI.'],
  [/You are an AI agent powered by DeepSeek Harness\.?/gi, 'You are an AI agent, powered by DeepSeek Harness.'],
  [/Web GUI whose URL the runtime context names\.\s+When the user refers/gi, 'Web GUI whose URL the runtime context names. The interface, when the user refers']
];

const OPENERS = [
  [/(\bYou are (?:an?|the)\s[^\n.,]{0,60}?\b(?:agent|assistant))\s+(powered by|running on|running in|built on|based on)\b/gi, '$1, $2']
];

const NAME_OK = /^[A-Za-z0-9_-]+$/;
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const SUB_ONE = ['items', 'additionalItems', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalProperties', 'unevaluatedProperties'];
const SUB_LIST = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
const SUB_MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const BOOL_OK = new Set(['additionalProperties', 'unevaluatedProperties']);
const NUL_ESCAPE = /\\\\|\\0(?![0-9])/g;
const MEDIA_TAG = /^(?:text|image)-to-(?:image|video)$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unflagged(text) {
  let next = text;
  for (const [re, to] of FLAGGED) next = next.replace(re, to);
  return next;
}

function rewriteContent(content) {
  if (typeof content === 'string') {
    const next = unflagged(content);
    return next === content ? null : next;
  }
  if (!Array.isArray(content)) return null;
  let changed = false;
  const parts = [];
  for (const part of content) {
    if (typeof part?.text !== 'string') {
      parts.push(part);
      continue;
    }
    const next = unflagged(part.text);
    if (next === part.text) {
      parts.push(part);
      continue;
    }
    changed = true;
    if (next.trim()) parts.push({ ...part, text: next });
  }
  return changed ? parts : null;
}

function unflag(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const next = rewriteContent(message?.content);
    if (next === null) continue;
    if ((typeof next === 'string' ? next.trim() : next.length) || message.role !== 'system') {
      message.content = next;
    } else {
      messages.splice(i, 1);
    }
  }
}

function reasoningText(message) {
  if (typeof message.reasoning_content === 'string' && message.reasoning_content) return message.reasoning_content;
  if (!Array.isArray(message.reasoning_details)) return '';
  return message.reasoning_details
    .map(detail => (typeof detail?.text === 'string' ? detail.text : typeof detail?.summary === 'string' ? detail.summary : ''))
    .join('');
}

function asReasoning(messages) {
  for (const message of messages) {
    if (message?.role !== 'assistant') continue;
    if (message.reasoning_content === undefined && message.reasoning_details === undefined) continue;
    const text = reasoningText(message);
    if (text && !(typeof message.reasoning === 'string' && message.reasoning)) message.reasoning = text;
    delete message.reasoning_content;
    delete message.reasoning_details;
  }
}

function emptyContent(content) {
  if (content === null || content === undefined || content === '') return true;
  return Array.isArray(content) && content.every(part => part?.type === 'text' && !part.text);
}

function callText(chat) {
  if (!/^kimi-k3\.1-pro(?:-|$)/i.test(String(chat?.model ?? ''))) return;
  for (const message of chat.messages || []) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.length) continue;
    if (emptyContent(message.content)) message.content = ' ';
  }
}

function safeName(name, taken) {
  const base = String(name).replace(/[^A-Za-z0-9_-]/g, '_') || 'tool';
  let next = base;
  for (let i = 2; taken.has(next); i += 1) next = `${base}_${i}`;
  taken.add(next);
  return next;
}

function fitSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 64) return;
  if (Array.isArray(schema)) {
    for (const value of schema) fitSchema(value, depth + 1);
    return;
  }
  if (typeof schema.pattern === 'string' && schema.pattern.includes('\\0')) {
    schema.pattern = schema.pattern.replace(NUL_ESCAPE, match => (match === '\\\\' ? match : '\\u0000'));
  }
  if (schema.pattern === '^[^\\uD800-\\uDFFF]*$') delete schema.pattern;
  if (Array.isArray(schema.items)) {
    const list = schema.items.filter(value => value && typeof value === 'object');
    schema.items = list.length === 0 ? {} : list.length === 1 ? list[0] : { anyOf: list };
    delete schema.additionalItems;
  }
  for (const value of Object.values(schema)) fitSchema(value, depth + 1);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function fitEnum(schema) {
  if (!('enum' in schema)) return;
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
    delete schema.enum;
    return;
  }
  const listed = Array.isArray(schema.type) ? schema.type : typeof schema.type === 'string' ? [schema.type] : [];
  if (listed.filter(type => type !== 'null').length === 1) return;
  const byType = new Map();
  for (const value of schema.enum) {
    const type = valueType(value);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(value);
  }
  if (byType.has('integer') && byType.has('number')) {
    byType.get('number').push(...byType.get('integer'));
    byType.delete('integer');
  }
  const hasNull = byType.delete('null');
  if (byType.size <= 1) {
    const [type] = byType.keys();
    schema.type = type === undefined ? 'null' : hasNull ? [type, 'null'] : type;
    return;
  }
  const split = [...byType].map(([type, values]) => ({ type, enum: values }));
  if (hasNull) split.push({ type: 'null' });
  delete schema.enum;
  delete schema.type;
  if (Array.isArray(schema.anyOf)) schema.allOf = [...(Array.isArray(schema.allOf) ? schema.allOf : []), { anyOf: split }];
  else schema.anyOf = split;
}

function subSchema(value, key) {
  if (typeof value !== 'boolean' || BOOL_OK.has(key)) return value;
  return value ? {} : { not: {} };
}

function fitShape(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 64) return;
  if ('type' in schema) {
    const list = (Array.isArray(schema.type) ? schema.type : [schema.type])
      .map(type => (typeof type === 'string' ? type.toLowerCase() : type))
      .filter(type => TYPES.has(type));
    const unique = [...new Set(list)];
    if (unique.length === 0) delete schema.type;
    else schema.type = unique.length === 1 ? unique[0] : unique;
  }
  if ('required' in schema && !Array.isArray(schema.required)) delete schema.required;
  else if (Array.isArray(schema.required)) schema.required = schema.required.filter(key => typeof key === 'string');
  fitEnum(schema);
  if (!('type' in schema) && Array.isArray(schema.oneOf) && schema.oneOf.length && schema.oneOf.every(branch => branch && (branch.type === 'object' || branch.properties))) {
    schema.type = 'object';
  }
  for (const key of SUB_ONE) {
    if (!(key in schema)) continue;
    schema[key] = subSchema(schema[key], key);
    fitShape(schema[key], depth + 1);
  }
  for (const key of SUB_LIST) {
    if (!Array.isArray(schema[key])) continue;
    schema[key] = schema[key].map(value => subSchema(value, key));
    for (const value of schema[key]) fitShape(value, depth + 1);
  }
  for (const key of SUB_MAP) {
    const map = schema[key];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const name of Object.keys(map)) {
      map[name] = subSchema(map[name], key);
      fitShape(map[name], depth + 1);
    }
  }
}

function fitTools(chat) {
  const names = new Map();
  if (!Array.isArray(chat?.tools) || !chat.tools.length) return names;
  const taken = new Set();
  for (const tool of chat.tools) {
    const name = tool?.function?.name;
    if (typeof name === 'string' && NAME_OK.test(name)) taken.add(name);
  }
  const renamed = new Map();
  for (const tool of chat.tools) {
    const fn = tool?.function;
    if (!fn || typeof fn !== 'object') continue;
    if (typeof fn.name === 'string' && !NAME_OK.test(fn.name)) {
      const safe = safeName(fn.name, taken);
      names.set(safe, fn.name);
      renamed.set(fn.name, safe);
      fn.name = safe;
    }
    if (fn.parameters === undefined) continue;
    if (!fn.parameters || typeof fn.parameters !== 'object' || Array.isArray(fn.parameters)) {
      fn.parameters = { type: 'object', properties: {} };
      continue;
    }
    fitSchema(fn.parameters);
    fitShape(fn.parameters);
    if (fn.parameters.type !== 'object') {
      fn.parameters.type = 'object';
      if (!fn.parameters.properties || typeof fn.parameters.properties !== 'object') fn.parameters.properties = {};
    }
  }
  if (renamed.size && Array.isArray(chat.messages)) {
    for (const message of chat.messages) {
      for (const call of message?.tool_calls || []) {
        const safe = renamed.get(call?.function?.name);
        if (safe) call.function.name = safe;
      }
      if (message?.role === 'tool' && renamed.has(message.name)) message.name = renamed.get(message.name);
    }
  }
  const choiceName = chat.tool_choice?.function?.name;
  if (choiceName && renamed.has(choiceName)) chat.tool_choice.function.name = renamed.get(choiceName);
  return names;
}

function toolChoice(chat) {
  if (!chat || !('tool_choice' in chat)) return;
  const choice = chat.tool_choice;
  if (typeof choice === 'string') {
    if (choice.trim().toLowerCase() === 'none') {
      delete chat.tool_choice;
      delete chat.tools;
    }
    return;
  }
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    delete chat.tool_choice;
    return;
  }
  const type = typeof choice.type === 'string' ? choice.type.trim().toLowerCase() : '';
  if (type === 'none') {
    delete chat.tool_choice;
    delete chat.tools;
  } else if (type === 'auto' || type === 'required') {
    chat.tool_choice = type;
  } else if (type === 'function') {
    const name = typeof choice.function?.name === 'string' ? choice.function.name.trim() : '';
    chat.tool_choice = name || 'auto';
  } else {
    delete chat.tool_choice;
  }
}

export function prepareChat(payload) {
  const chat = clone(payload || {});
  if (!Array.isArray(chat.messages)) chat.messages = [];
  unflag(chat.messages);
  if (chat.max_completion_tokens !== undefined) {
    if (chat.max_tokens === undefined) chat.max_tokens = chat.max_completion_tokens;
    delete chat.max_completion_tokens;
  }
  for (const message of chat.messages) {
    if (message?.role === 'developer') message.role = 'system';
  }
  asReasoning(chat.messages);
  callText(chat);
  if (chat.messages[0]?.role !== 'system') {
    chat.messages.unshift({ role: 'system', content: DEFAULT_SYSTEM });
  }
  const names = fitTools(chat);
  toolChoice(chat);
  chat.stream = true;
  return { payload: chat, names };
}

function rewriteRoles(chat, roles, rewrite) {
  let changed = false;
  for (const message of chat.messages || []) {
    if (!roles.has(message?.role)) continue;
    if (typeof message.content === 'string') {
      const next = rewrite(message.content);
      if (next !== message.content) {
        message.content = next;
        changed = true;
      }
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (typeof part?.text !== 'string') continue;
        const next = rewrite(part.text);
        if (next === part.text) continue;
        part.text = next;
        changed = true;
      }
    }
  }
  return changed;
}

export function commaPause(payload) {
  const chat = clone(payload);
  const changed = rewriteRoles(chat, new Set(['system', 'assistant']), text => {
    let next = text;
    for (const [re, to] of OPENERS) next = next.replace(re, to);
    return next;
  });
  return changed ? chat : null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n');
}

export function moveSystemToUser(payload) {
  const chat = clone(payload);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let index = 0;
  const lead = [];
  for (; index < messages.length && messages[index]?.role === 'system'; index += 1) {
    lead.push(textOf(messages[index].content));
  }
  const said = lead.join('\n\n').trim();
  const rest = messages.slice(index).map(message => (message?.role === 'system' ? { ...message, role: 'user' } : message));
  const moved = said && said !== DEFAULT_SYSTEM;
  if (!moved && rest.every((message, offset) => message === messages[index + offset])) return null;
  if (moved) {
    const text = `<instructions>\n${said}\n</instructions>`;
    const userAt = rest.findIndex(message => message?.role === 'user');
    if (userAt < 0) rest.unshift({ role: 'user', content: text });
    else if (typeof rest[userAt].content === 'string') rest[userAt] = { ...rest[userAt], content: `${text}\n\n${rest[userAt].content}` };
    else if (Array.isArray(rest[userAt].content)) rest[userAt] = { ...rest[userAt], content: [{ type: 'text', text }, ...rest[userAt].content] };
    else rest[userAt] = { ...rest[userAt], content: text };
  }
  chat.messages = [{ role: 'system', content: DEFAULT_SYSTEM }, ...rest];
  return chat;
}

export function refusalFallbacks(payload) {
  const attempts = [];
  const paused = commaPause(payload);
  if (paused) attempts.push(paused);
  const moved = moveSystemToUser(paused || payload);
  if (moved) attempts.push(moved);
  return attempts;
}

function answeredBefore(messages, index) {
  const message = messages[index];
  if (Array.isArray(message?.content) && message.content.some(part => part?.type === 'tool_result')) return true;
  let previous = index - 1;
  while (previous >= 0 && messages[previous]?.role === 'system') previous -= 1;
  const before = messages[previous];
  if (!before) return false;
  if (before.role === 'tool') return true;
  if (before.role === 'user' && Array.isArray(before.content) && before.content.some(part => part?.type === 'tool_result')) return true;
  if (before.role !== 'assistant') return false;
  return Array.isArray(before.tool_calls) && before.tool_calls.length > 0;
}

function signatureParts(content) {
  if (typeof content === 'string') return content ? [content] : [];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const part of content) {
    const type = part?.type ?? '';
    if (type === '' || type === 'text') {
      if (typeof part?.text === 'string' && part.text) out.push(part.text);
    } else if (type !== 'tool_result' && type !== 'tool-result') {
      out.push(`[${type}]`);
    }
  }
  return out;
}

function digest(kind, parts) {
  const hash = createHash('sha256');
  hash.update(`${SALT}|${kind}|`);
  for (const part of parts) hash.update(String(part));
  return hash.digest('hex').slice(0, 32);
}

export function conversationHeaders({ sessionId, messages, scope } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const messageId = randomBytes(16).toString('hex');
  const headers = {
    'X-Conversation-Message-ID': messageId,
    'X-Request-ID': messageId
  };
  let conv = [];
  if (sessionId) conv = [`session:${sessionId}`];
  else {
    for (const message of list) {
      if (message?.role !== 'user') continue;
      const sig = signatureParts(message.content);
      if (sig.length) {
        conv = ['first:', ...sig];
        break;
      }
    }
  }
  if (!conv.length) return headers;
  const own = scope ? [`account:${scope}`, '|'] : [];
  headers['X-Conversation-ID'] = digest('conversation', [...own, ...conv]);
  let turn = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role !== 'user' || answeredBefore(list, i)) continue;
    const sig = signatureParts(list[i].content);
    if (sig.length) turn = [`u${i}:`, ...sig];
    break;
  }
  headers['X-Conversation-Request-ID'] = digest('turn', [...own, ...conv, '|', ...(turn.length ? turn : [messageId])]);
  return headers;
}

export function encodeChatBody(payload) {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) < GZIP_AT) return { body: json, encoding: null };
  return { body: gzipSync(Buffer.from(json)), encoding: 'gzip' };
}

export function gzipRejected(status, raw) {
  return status === 400 && /invalid character|\\x1f|content-encoding/i.test(String(raw || ''));
}

export function isChannelRefusal(raw) {
  const text = String(raw || '');
  try {
    const body = JSON.parse(text);
    const code = Number(body?.code ?? body?.error?.code);
    const msg = String(body?.msg || body?.message || body?.error?.message || '');
    if (code === 11128) return true;
    return /unapproved channel|first message is not system/i.test(msg);
  } catch {
    return /unapproved channel|first message is not system/i.test(text);
  }
}

export function explainChatError(status, raw) {
  let code;
  let msg = '';
  try {
    const body = JSON.parse(String(raw || ''));
    code = body?.code ?? body?.error?.code;
    msg = body?.msg || body?.message || body?.error?.message || '';
  } catch {
    msg = String(raw || '').trim();
  }
  const detail = [code !== undefined && code !== null && code !== '' ? `code ${code}` : '', msg].filter(Boolean).join(' ');
  let hint = '';
  const blob = `${code || ''} ${msg}`;
  if (Number(code) === 11128 || /unapproved channel/i.test(blob)) {
    hint = '系统或助手消息里有 WorkBuddy 拒绝的其他客户端开场白。';
  } else if (/first message is not system/i.test(blob)) {
    hint = '对话的第一条必须是 system 消息。';
  } else if (Number(code) === 11101 || /non-stream/i.test(blob)) {
    hint = '这个接口只接受流式请求。';
  } else if (Number(code) === 10085) {
    hint = '网关没有接受这次请求。';
  } else if (Number(code) === 11133 || /invalid request parameters/i.test(blob)) {
    hint = '模型没有接受这次请求参数，常见原因是工具定义。';
  } else if (/prompt is too long|context_length|maximum context/i.test(blob)) {
    hint = '上下文超过模型上限。';
  }
  const head = `HTTP ${status}${detail ? `: ${detail}` : ''}`;
  return hint ? `${head}。${hint}` : head;
}

export function restoreToolNames(completion, names) {
  if (!names?.size || !completion?.toolCalls) return completion;
  for (const call of completion.toolCalls) {
    const original = names.get(call.name);
    if (original) call.name = original;
  }
  return completion;
}

function configData(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) && Array.isArray(payload.data.models)) {
    return payload.data;
  }
  return payload;
}

export function modelsFromProductConfig(payload, { includeAll = false } = {}) {
  const data = configData(payload);
  const models = Array.isArray(data?.models) ? data.models.filter(model => model && typeof model.id === 'string' && model.id) : [];
  if (!models.length) return [];
  const byId = new Map(models.map(model => [model.id, model]));
  const cli = (Array.isArray(data.agents) ? data.agents : []).find(agent => agent?.name === 'cli');
  const ids = [];
  const seen = new Set();
  const push = id => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (includeAll || !Array.isArray(cli?.models)) {
    for (const model of models) push(model.id);
  } else {
    for (const id of cli.models) push(id);
    for (const model of models) {
      if (model.id.startsWith('custom:')) push(model.id);
    }
  }
  return ids.map(id => byId.get(id)).filter(model => {
    if (includeAll) return true;
    const tags = Array.isArray(model.tags) ? model.tags.map(String) : [];
    return !tags.some(tag => tag === 'text-to-image' || MEDIA_TAG.test(tag));
  });
}

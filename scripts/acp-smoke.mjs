import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountDefaultModel, acpModelsFromCatalog } from '../bin/catalog.mjs';
import { defaultEffort, effortChoices, installModelProfiles, modelMeta } from '../bin/effort.mjs';
import { collectRoots, pathWithinRoots, requestedWorkspace, workspaceBrief, workspaceInfo } from '../bin/workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'workbuddy.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-cli-'));
const env = {
  ...process.env,
  WORKBUDDY_CLI_HOME: home,
  WORKBUDDY_ACP_MOCK: '1'
};

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function testCliSessions() {
  const first = await run(['--json', 'hello one']);
  assert(first.code === 0, `first chat failed: ${first.stderr}`);
  const firstJson = JSON.parse(first.stdout);
  assert(firstJson.data.text === 'mock:hello one', first.stdout);
  const sessionId = firstJson.data.sessionId;
  assert(sessionId, 'missing sessionId');

  const second = await run(['-c', '--json', 'hello two']);
  assert(second.code === 0, second.stderr);
  const secondJson = JSON.parse(second.stdout);
  assert(secondJson.data.sessionId === sessionId, 'continue opened a new session');
  assert(secondJson.data.text === 'mock:hello two', second.stdout);

  const listed = await run(['sessions', '--json']);
  const sessions = JSON.parse(listed.stdout).sessions;
  assert(sessions.length === 1, `expected 1 session, got ${sessions.length}`);
  assert(sessions[0].messages === 4, `expected 4 messages, got ${sessions[0].messages}`);

  const resumed = await run(['resume', sessionId.slice(0, 8), '--json', 'hello three']);
  assert(resumed.code === 0, resumed.stderr);
  assert(JSON.parse(resumed.stdout).data.text === 'mock:hello three', resumed.stdout);

  const missing = await run(['-c', '--json', 'nope'], undefined);
  // a session exists, so this must succeed
  assert(missing.code === 0, missing.stderr);

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-cwd-'));
  const elsewhere = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '-c', '--json', 'outside'], { cwd: other, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
  assert(elsewhere.code === 1, 'continue in an empty directory should fail');
  assert(elsewhere.stderr.includes('没有可继续的会话'), elsewhere.stderr);
}

function startAcp() {
  const child = spawn(process.execPath, [cli, 'acp'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const waiters = [];
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else child.emit('acp', msg);
    }
  });
  const pending = [];
  child.on('acp', msg => pending.push(msg));
  const next = () => new Promise(resolve => {
    if (pending.length) resolve(pending.shift());
    else waiters.push(resolve);
  });
  const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
  return { child, next, send };
}

async function testAcp() {
  const { child, next, send } = startAcp();
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(chunk.toString('utf8')));
  let sessionId = '';
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 2,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: { name: 'smoke', version: '0' }
      }
    });
    const init = await next();
    assert(init.id === 1 && init.result.protocolVersion === 1, JSON.stringify(init));
    assert(init.result.agentCapabilities.loadSession === true, 'loadSession missing');
    assert(init.result.agentCapabilities.sessionCapabilities?.additionalDirectories, 'additionalDirectories missing');

    send({ jsonrpc: '2.0', id: 2, method: 'nope', params: {} });
    const missing = await next();
    assert(missing.error?.code === -32601, JSON.stringify(missing));

    send({ jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: root, mcpServers: [] } });
    const created = await next();
    sessionId = created.result.sessionId;
    assert(sessionId, JSON.stringify(created));
    assert(created.result.models.availableModels.length > 0, 'models missing');
    assert(created.result._meta?.workspace && created.result._meta.isGitWorkspace === true, JSON.stringify(created.result._meta));
    const thought = created.result.configOptions.find(option => option.id === 'thought_level');
    assert(thought?.category === 'thought_level' && thought.currentValue === 'medium', JSON.stringify(thought));
    const deepseek = created.result.models.availableModels.find(model => model.modelId === 'deepseek-v3-2-volc');
    assert(deepseek?._meta?.supportsReasoningEffort === true && deepseek._meta.reasoningEfforts?.length > 0, 'reasoning meta missing');
    const auto = created.result.models.availableModels.find(model => model.modelId === 'auto');
    assert(auto?._meta?.supportsReasoningEffort === false, 'auto should not advertise reasoning');
    send({
      jsonrpc: '2.0',
      id: 31,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'thought_level', value: 'high' }
    });
    const effortSet = await next();
    const updated = effortSet.result?.configOptions?.find(option => option.id === 'thought_level');
    assert(updated?.currentValue === 'high', JSON.stringify(effortSet));
    send({
      jsonrpc: '2.0',
      id: 32,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'thought_level', value: 'off' }
    });
    const rejected = await next();
    assert(rejected.error?.code === -32602, JSON.stringify(rejected));

    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read TOOL please' }] }
    });
    const updates = [];
    let promptResult = null;
    while (!promptResult) {
      const msg = await next();
      if (msg.id === 4) {
        promptResult = msg;
        break;
      }
      if (msg.method === 'session/request_permission') {
        send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
        continue;
      }
      if (msg.method === 'fs/read_text_file') {
        send({ jsonrpc: '2.0', id: msg.id, result: { content: 'file-body' } });
        continue;
      }
      updates.push(msg);
    }
    assert(promptResult.result?.stopReason === 'end_turn', JSON.stringify(promptResult));
    const texts = updates
      .filter(msg => msg.method === 'session/update')
      .map(msg => msg.params.update)
      .filter(update => update.sessionUpdate === 'agent_message_chunk')
      .map(update => update.content.text)
      .join('');
    assert(texts.includes('mock-after-tool'), `missing tool follow-up: ${texts}`);
    assert(updates.some(msg => msg.params?.update?.sessionUpdate === 'tool_call'), 'missing tool_call');

    send({ jsonrpc: '2.0', id: 5, method: 'session/list', params: {} });
    const list = await next();
    assert(list.result.sessions.some(session => session.sessionId === sessionId), JSON.stringify(list));

    send({ jsonrpc: '2.0', id: 6, method: 'session/close', params: { sessionId } });
    const closed = await next();
    assert(closed.result && !closed.error, JSON.stringify(closed));

    send({ jsonrpc: '2.0', id: 7, method: 'session/load', params: { sessionId, cwd: root } });
    let loaded = null;
    let replayed = false;
    while (!loaded) {
      const msg = await next();
      if (msg.id === 7) loaded = msg;
      else if (msg.method === 'session/update') replayed = true;
    }
    assert(loaded.result.sessionId === sessionId, JSON.stringify(loaded));
    assert(replayed, 'load did not replay history');

    send({
      jsonrpc: '2.0',
      id: 8,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'SLOW please' }] }
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    const cancelled = await Promise.race([
      (async () => {
        for (;;) {
          const msg = await next();
          if (msg?.id === 8) return msg;
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`cancel timed out; stderr=${stderr.join('')}`)), 5000))
    ]);
    assert(cancelled.result?.stopReason === 'cancelled', JSON.stringify(cancelled));

    send({ jsonrpc: '2.0', id: 9, method: 'session/prompt', params: { sessionId: 'missing', prompt: [{ type: 'text', text: 'x' }] } });
    const absent = await next();
    assert(absent.error?.code === -32002, JSON.stringify(absent));
  } finally {
    child.stdin.end();
    await new Promise(resolve => child.on('close', resolve));
  }
}

function testWorkspace() {
  const roots = collectRoots(root, [os.homedir()]);
  assert(roots[0] === fs.realpathSync(root), roots[0]);
  assert(roots.includes(fs.realpathSync(os.homedir())), 'home root missing');
  const brief = workspaceBrief(roots);
  assert(brief.includes(`路径：${roots[0]}`), 'brief missing cwd');
  assert(brief.includes('不要主动说出工作空间路径'), 'brief should keep the path quiet');
  assert(!brief.includes('打招呼'), 'brief should not recite the path on greeting');
  assert(workspaceInfo(roots).isGitWorkspace === true, 'repo should be git');
  assert(requestedWorkspace({ workingDirectory: roots[0] }) === roots[0], 'workingDirectory');
  assert(brief.includes('package.json') || brief.includes('bin'), brief);
  assert(workspaceBrief([fs.realpathSync(os.homedir())]).includes('用户主目录'), 'home warning missing');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-'));
  const scratchRoot = path.join(scratch, '.t3', 'scratch', 'demo');
  fs.mkdirSync(scratchRoot, { recursive: true });
  assert(workspaceBrief([scratchRoot]).includes('临时草稿目录'), 'scratch warning missing');
  assert(pathWithinRoots(roots, 'bin/workbuddy.mjs'), 'repo file should be inside roots');
  assert(pathWithinRoots([roots[0]], path.join(os.homedir(), 'outside')) === null, 'outside path should be rejected');
  fs.rmSync(scratch, { recursive: true, force: true });
}

function testCatalog() {
  const sample = [
    { id: 'auto', name: 'Auto', isDefault: true, supportsToolCall: true, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: 'high', summary: 'auto' } },
    { id: 'hy4flash-free', name: 'Hy4 flash', isDefault: true, supportsToolCall: true, supportsReasoning: true, onlyReasoning: true, tags: ['badge:限时免费:#FF0000'], reasoning: { defaultEffort: 'high', supportedEfforts: ['high'], canDisableThinking: false } },
    { id: 'hy4flash', name: 'Hy4 flash', isDefault: true, supportsToolCall: true, supportsReasoning: true, onlyReasoning: true, credits: 'x0.03', reasoning: { defaultEffort: 'high', supportedEfforts: ['high'], canDisableThinking: false } },
    { id: 'deepseek-v3-2-volc', name: 'DeepSeek-V3.2', supportsToolCall: true, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: 'medium', summary: 'auto' } },
    { id: 'hunyuan-chat', name: 'Hunyuan-Turbos', supportsToolCall: true },
    { id: 'kling-video-v3', name: 'Kling-Video-V3', tags: ['text-to-video', 'image-to-video'] }
  ];
  installModelProfiles(sample);
  const listed = acpModelsFromCatalog(sample);
  assert(listed.map(model => model.modelId).join(',') === 'auto,hy4flash-free,hy4flash,deepseek-v3-2-volc,hunyuan-chat', listed.map(model => model.modelId).join(','));
  assert(listed.find(model => model.modelId === 'hy4flash-free').name === 'Hy4 flash（限时免费）', 'free flash name');
  assert(listed.find(model => model.modelId === 'hy4flash').name === 'Hy4 flash（x0.03）', 'paid flash name');
  assert(accountDefaultModel(sample) === 'auto', 'account default');
  assert(defaultEffort('auto') === 'high', 'auto effort');
  assert(effortChoices('hy4flash-free').map(choice => choice.value).join(',') === 'high', 'flash efforts');
  assert(!effortChoices('auto').some(choice => choice.value === 'off'), 'auto cannot turn off');
  assert(modelMeta('hunyuan-chat').supportsReasoningEffort === false, 'chat model has no effort');
  installModelProfiles([]);
}

try {
  testWorkspace();
  testCatalog();
  await testCliSessions();
  await testAcp();
  fs.rmSync(home, { recursive: true, force: true });
  console.log('acp smoke ok');
} catch (err) {
  console.error(err);
  console.error(`home left at ${home}`);
  process.exit(1);
}

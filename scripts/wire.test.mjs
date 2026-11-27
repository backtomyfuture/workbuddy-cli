import test from 'node:test';
import assert from 'node:assert/strict';
import { effortChoices } from '../bin/effort.mjs';
import {
  commaPause,
  conversationHeaders,
  encodeChatBody,
  explainChatError,
  isChannelRefusal,
  modelsFromProductConfig,
  moveSystemToUser,
  prepareChat,
  restoreToolNames
} from '../bin/wire.mjs';

test('a chat opens with system text and keeps prior reasoning', () => {
  const { payload } = prepareChat({
    model: 'glm-5.3',
    messages: [
      { role: 'developer', content: 'Stay brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok', reasoning_content: 'looked it up' }
    ]
  });
  assert.equal(payload.stream, true);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[0].content, 'Stay brief.');
  assert.equal(payload.messages[2].reasoning, 'looked it up');
  assert.equal(payload.messages[2].reasoning_content, undefined);
  const bare = prepareChat({ model: 'glm-5.3', messages: [{ role: 'user', content: 'hi' }] }).payload;
  assert.equal(bare.messages[0].content, 'You are a helpful assistant.');
});

test('known channel lines are reworded, and a refusal can move the system prompt', () => {
  const { payload } = prepareChat({
    model: 'deepseek-v4.1-flash',
    messages: [
      { role: 'system', content: 'You are an AI agent powered by DeepSeek Harness.' },
      { role: 'user', content: 'hi' }
    ]
  });
  assert.match(payload.messages[0].content, /You are an AI agent, powered by DeepSeek Harness\./);
  const paused = commaPause({
    messages: [
      { role: 'system', content: 'You are an agent powered by SomeHarness.' },
      { role: 'user', content: 'hi' }
    ]
  });
  assert.match(paused.messages[0].content, /agent, powered by/);
  const moved = moveSystemToUser(payload);
  assert.equal(moved.messages[0].content, 'You are a helpful assistant.');
  assert.match(moved.messages[1].content, /<instructions>/);
  assert.equal(isChannelRefusal('{"code":11128,"msg":"Illegal API invocation from an unapproved channel"}'), true);
  assert.match(explainChatError(400, '{"code":11128,"msg":"Illegal API invocation from an unapproved channel"}'), /未批准|开场白/);
});

test('kimi tool turns and unsafe tool names are repaired', () => {
  const { payload, names } = prepareChat({
    model: 'kimi-k3.1-pro',
    tool_choice: { type: 'function', function: { name: 'fs.read' } },
    tools: [{
      type: 'function',
      function: {
        name: 'fs.read',
        parameters: { type: 'object', properties: { mode: { enum: ['a', 'b'] } } }
      }
    }],
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'fs.read', arguments: '{}' } }] }
    ]
  });
  assert.equal(payload.messages[2].content, ' ');
  assert.equal(payload.tools[0].function.name, 'fs_read');
  assert.equal(payload.tools[0].function.parameters.properties.mode.type, 'string');
  assert.equal(payload.tool_choice, 'fs_read');
  const completion = restoreToolNames({ toolCalls: [{ name: 'fs_read' }] }, names);
  assert.equal(completion.toolCalls[0].name, 'fs.read');
});

test('one user send keeps a single turn id across tool steps', () => {
  const first = conversationHeaders({
    sessionId: 'wb_1',
    scope: 'user|ent|',
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'read the file' }
    ]
  });
  const second = conversationHeaders({
    sessionId: 'wb_1',
    scope: 'user|ent|',
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'read the file' },
      { role: 'assistant', tool_calls: [{ id: '1' }], content: ' ' },
      { role: 'tool', content: 'ok' }
    ]
  });
  assert.equal(first['X-Conversation-ID'], second['X-Conversation-ID']);
  assert.equal(first['X-Conversation-Request-ID'], second['X-Conversation-Request-ID']);
  assert.notEqual(first['X-Conversation-Message-ID'], second['X-Conversation-Message-ID']);
  const next = conversationHeaders({
    sessionId: 'wb_1',
    scope: 'user|ent|',
    messages: [
      { role: 'user', content: 'read the file' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'now write it' }
    ]
  });
  assert.equal(next['X-Conversation-ID'], first['X-Conversation-ID']);
  assert.notEqual(next['X-Conversation-Request-ID'], first['X-Conversation-Request-ID']);
});

test('product config prefers the cli agent and keeps custom models', () => {
  const models = modelsFromProductConfig({
    models: [
      { id: 'auto', name: 'Auto', supportsToolCall: true, isDefault: true },
      { id: 'picture', name: 'Picture', tags: ['text-to-image'] },
      { id: 'custom:team|private', name: 'Private' }
    ],
    agents: [{ name: 'cli', models: ['auto'] }]
  });
  assert.deepEqual(models.map(model => model.id), ['auto', 'custom:team|private']);
  const all = modelsFromProductConfig({
    models: [{ id: 'picture', tags: ['text-to-image'] }],
    agents: [{ name: 'cli', models: [] }]
  }, { includeAll: true });
  assert.equal(all.length, 1);
});

test('a long body is gzipped and flash can turn thinking off', () => {
  const packed = encodeChatBody({ messages: [{ role: 'user', content: 'x'.repeat(9000) }] });
  assert.equal(packed.encoding, 'gzip');
  assert.ok(Buffer.isBuffer(packed.body));
  assert.equal(encodeChatBody({ messages: [{ role: 'user', content: 'hi' }] }).encoding, null);
  assert.ok(effortChoices('deepseek-v4.1-flash').some(choice => choice.value === 'off'));
  assert.equal(effortChoices('glm-5.3').some(choice => choice.value === 'off'), false);
});

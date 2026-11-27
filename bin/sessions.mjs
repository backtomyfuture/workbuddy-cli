import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function cliHome() {
  return process.env.WORKBUDDY_CLI_HOME || path.join(os.homedir(), '.workbuddy-cli');
}

export function authFilePath() {
  return path.join(cliHome(), 'auth.json');
}

function sessionsDir() {
  return path.join(cliHome(), 'sessions');
}

export function createSessionId() {
  return `wb_${crypto.randomBytes(12).toString('hex')}`;
}

function assertSessionId(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/.test(id)) {
    throw new Error(`非法会话 id: ${id}`);
  }
}

function sessionPath(id) {
  assertSessionId(id);
  return path.join(sessionsDir(), `${id}.json`);
}

function sameCwd(a, b) {
  if (!a || !b) return false;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function readSessionFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data.id !== 'string' || !Array.isArray(data.messages)) return null;
    return data;
  } catch {
    return null;
  }
}

export function listSessions() {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return [];
  const sessions = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const session = readSessionFile(path.join(dir, name));
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return sessions;
}

export function loadSession(idOrPrefix) {
  const id = String(idOrPrefix || '').trim();
  if (!id) return null;
  const exact = sessionPath(id);
  if (fs.existsSync(exact)) return readSessionFile(exact);

  const matches = listSessions().filter(session => session.id.startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const sample = matches.slice(0, 5).map(session => session.id).join(', ');
    throw new Error(`会话前缀 "${id}" 匹配到 ${matches.length} 条（${sample}），请给出更长的 id`);
  }
  return null;
}

export function latestSession(cwd) {
  return listSessions().find(session => sameCwd(session.cwd, cwd)) || null;
}

export function saveSession(session) {
  const dir = sessionsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = sessionPath(session.id);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  return session;
}

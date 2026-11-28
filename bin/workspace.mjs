import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function normalizeDir(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function requestedWorkspace(params) {
  const meta = params?._meta && typeof params._meta === 'object' ? params._meta : {};
  return params?.cwd || params?.workingDirectory || meta.cwd || meta.workingDirectory || null;
}

export function collectRoots(cwd, additional) {
  const roots = [];
  const main = normalizeDir(cwd);
  if (main) roots.push(main);
  const extra = Array.isArray(additional) ? additional : [];
  for (const item of extra) {
    const raw = typeof item === 'string' ? item : item?.path || item?.cwd;
    const dir = normalizeDir(raw);
    if (dir && !roots.includes(dir)) roots.push(dir);
  }
  return roots;
}

export function pathWithinRoots(roots, target) {
  const list = (roots || []).filter(Boolean);
  if (!list.length) return null;
  const resolved = path.resolve(list[0], target || '.');
  for (const root of list) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return resolved;
  }
  return null;
}

function gitInfo(dir) {
  const gitPath = path.join(dir, '.git');
  if (!fs.existsSync(gitPath)) return null;
  try {
    const stat = fs.statSync(gitPath);
    const headPath = stat.isDirectory() ? path.join(gitPath, 'HEAD') : null;
    if (!headPath) return { branch: null };
    const head = fs.readFileSync(headPath, 'utf8').trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    return { branch: match ? match[1] : head.slice(0, 12) };
  } catch {
    return { branch: null };
  }
}

function projectNotes(dir) {
  for (const name of ['AGENTS.md', 'CODEBUDDY.md', 'WORKBUDDY.md']) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8').trim();
      if (!text) continue;
      return `${name}：\n${text.length > 2000 ? `${text.slice(0, 2000)}\n…` : text}`;
    } catch {}
  }
  return null;
}

function defaultShell() {
  return process.env.SHELL || (process.platform === 'win32' ? 'powershell' : 'bash');
}

function topLevel(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
      .slice(0, 40)
      .map(entry => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`);
  } catch (err) {
    return [`(无法读取: ${err.message})`];
  }
}

export function workspaceInfo(roots) {
  const list = (roots || []).filter(Boolean);
  const root = list[0] || null;
  const git = root ? gitInfo(root) : null;
  return {
    root,
    name: root ? path.basename(root) : '',
    os: os.platform(),
    shell: defaultShell(),
    isGitWorkspace: Boolean(git),
    branch: git?.branch || null,
    additionalDirectories: list.slice(1)
  };
}

export function workspaceBrief(roots) {
  const info = workspaceInfo(roots);
  const home = normalizeDir(os.homedir());
  const lines = [
    '工作空间与 WorkBuddy 桌面端相同：这次会话的目录就是项目目录。读文件、改文件、跑命令都在这里。',
    '引用文件时写绝对路径。位置已经在下面，不要再执行命令去找工作空间。',
    '你只能使用 read_file、list_dir、write_file、bash。用户消息里的 preview、delegate、html_preview 等名字不是你的工具。',
    `系统：${info.os}`,
    `Shell：${info.shell}`
  ];
  if (!info.root) {
    lines.push('这次没有收到工作空间路径。先向用户确认目录，不要扫描磁盘。');
    return lines.join('\n');
  }
  lines.push(`路径：${info.root}`);
  lines.push(`名称：${info.name}`);
  if (!fs.existsSync(info.root)) {
    lines.push('这个工作目录不存在或不可访问。先告诉用户，不要换到别的目录继续做。');
    return lines.join('\n');
  }
  if (info.root === home) {
    lines.push('这个目录是用户主目录，不是一个项目。先确认要处理的项目路径，不要遍历主目录。');
  } else if (info.root.includes(`${path.sep}.t3${path.sep}scratch${path.sep}`)) {
    lines.push('T3 把这次对话放在临时草稿目录。用户若要改已有项目，先问项目路径，不要把草稿目录当成那个项目。');
  }
  lines.push(info.isGitWorkspace ? `Git：是${info.branch ? `，分支 ${info.branch}` : ''}` : 'Git：否');
  if (info.root !== home) {
    lines.push('顶层：');
    lines.push(topLevel(info.root).join('\n') || '(空目录)');
    const notes = projectNotes(info.root);
    if (notes) lines.push(notes);
  }
  if (info.additionalDirectories.length) {
    lines.push('其他已放行目录：');
    for (const dir of info.additionalDirectories) lines.push(`- ${dir}`);
  }
  lines.push('路径只供你定位文件。不要主动说出工作空间路径，用户询问目录时再回答。');
  return lines.join('\n');
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { MemoryScope, RepoContext } from './types';

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function getHomeRoot(): string {
  return path.join(os.homedir(), '.llm-memory');
}

export function getGlobalRoot(): string {
  return path.join(getHomeRoot(), 'global');
}

export function getProjectsRoot(): string {
  return path.join(getHomeRoot(), 'projects');
}

export function detectProjectRoot(cwd: string = process.cwd()): string {
  // Prefer git root, else walk up until filesystem root
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (root) return root;
  } catch {}
  // fallback: look for package.json or .git
  let dir = cwd;
  while (true) {
    if (exists(path.join(dir, '.git')) || exists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return cwd; // give up
    dir = parent;
  }
}

export function computeRepoId(projectRoot: string): string {
  // Prefer git remote URL or git root path; hash to stable id
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (remote) return hash(remote);
  } catch {}
  return hash(projectRoot);
}

function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export function getCommittedRoot(projectRoot: string): string {
  return path.join(projectRoot, '.llm-memory');
}

export function getScopeRoot(scope: MemoryScope, ctx: RepoContext): string {
  switch (scope) {
    case 'global':
      return getGlobalRoot();
    case 'local':
      return path.join(getProjectsRoot(), ctx.repoId);
    case 'committed':
      return getCommittedRoot(ctx.projectRoot);
  }
}

export function ensureDirs(root: string) {
  // Create standard layout
  const dirs = [root, path.join(root, 'items'), path.join(root, 'index'), path.join(root, 'tmp'), path.join(root, 'locks')];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}

export function ensureCommittedGitignore(root: string) {
  const gi = path.join(root, '.gitignore');
  if (!exists(gi)) {
    const content = ['# llm-memory committed storage', 'tmp/', 'locks/', ''].join('\n');
    fs.writeFileSync(gi, content, 'utf8');
  }
}


import os from 'node:os';
import path from 'node:path';

export function getBaseDir(custom?: string): string {
  return custom || path.join(os.homedir(), '.llm-memory');
}

export function getGlobalDir(baseDir: string): string {
  return path.join(baseDir, 'global');
}

export function getProjectsDir(baseDir: string): string {
  return path.join(baseDir, 'projects');
}

export function getProjectLocalDir(baseDir: string, repoId: string): string {
  return path.join(getProjectsDir(baseDir), repoId);
}

export function getCommittedProjectDir(projectRoot: string): string {
  return path.join(projectRoot, '.llm-memory');
}

export const MEM_FILENAME = 'mem.jsonl';


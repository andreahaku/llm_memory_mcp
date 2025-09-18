import crypto from 'node:crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function detectRepoRoot(cwd?: string): string | undefined {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (!out) return undefined;
    return path.resolve(out);
  } catch {
    return undefined;
  }
}

export function getGitRemoteUrl(cwd?: string): string | undefined {
  try {
    const out = execSync('git config --get remote.origin.url', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function computeRepoId(projectRoot: string, remoteUrl?: string): string {
  // Prefer remote URL if present, else stable hash of absolute projectRoot
  const basis = remoteUrl || projectRoot;
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}


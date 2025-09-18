import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MemoryScope, ProjectInfo } from '../types/Memory.js';

export class ScopeResolver {
  private globalDir: string;
  private projectsDir: string;

  constructor() {
    const homeDir = os.homedir();
    const memoryDir = path.join(homeDir, '.llm-memory');
    this.globalDir = path.join(memoryDir, 'global');
    this.projectsDir = path.join(memoryDir, 'projects');
  }

  /**
   * Get storage directory for a given scope
   */
  getScopeDirectory(scope: MemoryScope, cwd?: string): string {
    switch (scope) {
      case 'global':
        this.ensureDirectory(this.globalDir);
        return this.globalDir;

      case 'local': {
        const projectInfo = this.detectProject(cwd);
        const localDir = path.join(this.projectsDir, projectInfo.repoId);
        this.ensureDirectory(localDir);
        return localDir;
      }

      case 'committed': {
        const projectInfo = this.detectProject(cwd);
        const committedDir = path.join(projectInfo.root, '.llm-memory');
        this.ensureDirectory(committedDir);
        return committedDir;
      }

      default:
        throw new Error(`Unknown scope: ${scope}`);
    }
  }

  /**
   * Detect current project information
   */
  detectProject(cwd?: string): ProjectInfo {
    const workingDir = cwd || process.cwd();

    try {
      // Try to get git root
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();

      // Try to get remote URL
      let remote: string | undefined;
      try {
        remote = execSync('git config --get remote.origin.url', {
          cwd: gitRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
      } catch {
        // No remote configured
      }

      // Try to get current branch
      let branch: string | undefined;
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: gitRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
      } catch {
        // Not on a branch (detached HEAD)
      }

      // Generate repo ID from git root + remote
      const repoId = this.generateRepoId(gitRoot, remote);
      const hasCommittedMemory = existsSync(path.join(gitRoot, '.llm-memory'));

      return {
        repoId,
        root: gitRoot,
        branch,
        remote,
        hasCommittedMemory
      };
    } catch {
      // Not a git repository, use directory-based fallback
      const repoId = this.generateRepoId(workingDir);
      const hasCommittedMemory = existsSync(path.join(workingDir, '.llm-memory'));

      return {
        repoId,
        root: workingDir,
        hasCommittedMemory
      };
    }
  }

  /**
   * Generate a consistent repo ID from path and optional remote
   */
  private generateRepoId(gitRoot: string, remote?: string): string {
    const input = remote ? `${gitRoot}|${this.normalizeRemote(remote)}` : gitRoot;
    return createHash('sha1').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Normalize git remote URL for consistent hashing
   */
  private normalizeRemote(remote: string): string {
    // Remove .git suffix
    let normalized = remote.replace(/\.git$/, '');

    // Convert SSH to HTTPS format for consistency
    if (normalized.startsWith('git@')) {
      normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');
    }

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    return normalized.toLowerCase();
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get all scope directories for a project (for merging queries)
   */
  getAllScopeDirectories(cwd?: string): Record<MemoryScope, string> {
    return {
      global: this.getScopeDirectory('global', cwd),
      local: this.getScopeDirectory('local', cwd),
      committed: this.getScopeDirectory('committed', cwd)
    };
  }

  /**
   * Initialize committed memory in current project
   */
  initCommittedMemory(cwd?: string): string {
    const projectInfo = this.detectProject(cwd);
    const committedDir = path.join(projectInfo.root, '.llm-memory');

    this.ensureDirectory(committedDir);

    // Create .gitignore to exclude temporary files but include core data
    const gitignorePath = path.join(committedDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      const gitignoreContent = [
        '# Exclude temporary and lock files',
        'tmp/',
        'locks/',
        '*.lock',
        '',
        '# Include core memory data',
        '!journal.ndjson',
        '!catalog.json',
        '!items/',
        '!index/',
        '!config.json'
      ].join('\n');

      require('fs').writeFileSync(gitignorePath, gitignoreContent);
    }

    return committedDir;
  }
}
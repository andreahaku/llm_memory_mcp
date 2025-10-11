/**
 * Claude Code Hooks Manager
 *
 * Manages installation and lifecycle of Claude Code hooks for auto-learning integration.
 * Supports both project-level (.claude/hooks/) and global (~/.claude/hooks/) installation.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

function log(message: string, ...args: any[]) {
  console.error(`[ClaudeCodeHooks] ${new Date().toISOString()} ${message}`, ...args);
}

export type HookScope = 'project' | 'global';

export interface HookInstallResult {
  scope: HookScope;
  hookName: string;
  installed: boolean;
  path?: string;
  error?: string;
}

export class ClaudeCodeHooksManager {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Check if hooks are installed
   */
  async checkHooksStatus(scope: HookScope = 'project'): Promise<HookInstallResult[]> {
    const hooksDir = this.getHooksDirectory(scope);
    const hookNames = [
      'session-start',
      'post-commit',
      'pre-response'
    ];

    const results: HookInstallResult[] = [];

    for (const hookName of hookNames) {
      const hookPath = path.join(hooksDir, `${hookName}.md`);
      const installed = existsSync(hookPath);

      results.push({
        scope,
        hookName,
        installed,
        path: installed ? hookPath : undefined
      });
    }

    return results;
  }

  /**
   * Install all auto-learning hooks
   */
  async installHooks(scope: HookScope = 'project'): Promise<HookInstallResult[]> {
    const hooksDir = this.getHooksDirectory(scope);

    // Create hooks directory if it doesn't exist
    if (!existsSync(hooksDir)) {
      try {
        mkdirSync(hooksDir, { recursive: true });
        log(`Created hooks directory: ${hooksDir}`);
      } catch (error) {
        log('Failed to create hooks directory:', error);
        return [];
      }
    }

    const results: HookInstallResult[] = [];

    // Install each hook
    results.push(await this.installSessionStartHook(scope));
    results.push(await this.installPostCommitHook(scope));
    results.push(await this.installPreResponseHook(scope));

    const installed = results.filter(r => r.installed).length;
    log(`Installed ${installed}/${results.length} Claude Code hooks at ${scope} level`);

    return results;
  }

  /**
   * Uninstall all auto-learning hooks
   */
  async uninstallHooks(scope: HookScope = 'project'): Promise<void> {
    const hooksDir = this.getHooksDirectory(scope);
    const hookNames = ['session-start', 'post-commit', 'pre-response'];

    for (const hookName of hookNames) {
      const hookPath = path.join(hooksDir, `${hookName}.md`);

      if (existsSync(hookPath)) {
        try {
          const content = readFileSync(hookPath, 'utf8');

          // Only remove if it's our hook (check for marker)
          if (content.includes('# LLM-MEMORY-AUTO-LEARNING')) {
            const fs = await import('fs/promises');
            await fs.unlink(hookPath);
            log(`Uninstalled ${hookName} hook from ${scope}`);
          }
        } catch (error) {
          log(`Failed to uninstall ${hookName} hook:`, error);
        }
      }
    }
  }

  /**
   * Get hooks directory based on scope
   */
  private getHooksDirectory(scope: HookScope): string {
    if (scope === 'global') {
      return path.join(os.homedir(), '.claude', 'hooks');
    } else {
      return path.join(this.projectRoot, '.claude', 'hooks');
    }
  }

  /**
   * Install session-start hook
   */
  private async installSessionStartHook(scope: HookScope): Promise<HookInstallResult> {
    const hookName = 'session-start';
    return await this.installHookFromSource(hookName, scope);
  }

  /**
   * Install post-commit hook
   */
  private async installPostCommitHook(scope: HookScope): Promise<HookInstallResult> {
    const hookName = 'post-commit';
    return await this.installHookFromSource(hookName, scope);
  }

  /**
   * Install pre-response hook
   */
  private async installPreResponseHook(scope: HookScope): Promise<HookInstallResult> {
    const hookName = 'pre-response';
    return await this.installHookFromSource(hookName, scope);
  }

  /**
   * Install a hook from the project's hooks/ directory or fallback
   */
  private async installHookFromSource(hookName: string, scope: HookScope): Promise<HookInstallResult> {
    const hookPath = path.join(this.getHooksDirectory(scope), `${hookName}.md`);

    try {
      // Check if we have the hook file in the project's hooks/ directory
      const sourceHookPath = path.join(this.projectRoot, 'hooks', `${hookName}.md`);

      let hookContent: string;

      if (existsSync(sourceHookPath)) {
        // Copy from project source
        hookContent = readFileSync(sourceHookPath, 'utf8');
        log(`Using ${hookName} hook from project source: ${sourceHookPath}`);
      } else {
        // If source doesn't exist, check if there's already one in global location
        const globalHookPath = path.join(os.homedir(), '.claude', 'hooks', `${hookName}.md`);

        if (existsSync(globalHookPath)) {
          // Copy from global
          hookContent = readFileSync(globalHookPath, 'utf8');
          log(`Using ${hookName} hook from global: ${globalHookPath}`);
        } else {
          throw new Error(`Hook source not found: ${hookName}`);
        }
      }

      writeFileSync(hookPath, hookContent);
      log(`Installed ${hookName} hook at ${scope} level: ${hookPath}`);

      return {
        scope,
        hookName,
        installed: true,
        path: hookPath
      };
    } catch (error) {
      log(`Failed to install ${hookName} hook:`, error);
      return {
        scope,
        hookName,
        installed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Auto-install hooks if not present
   */
  async ensureHooksInstalled(scope: HookScope = 'project'): Promise<boolean> {
    const status = await this.checkHooksStatus(scope);
    const allInstalled = status.every(s => s.installed);

    if (!allInstalled) {
      log(`Auto-installing missing Claude Code hooks at ${scope} level`);
      const results = await this.installHooks(scope);
      return results.every(r => r.installed);
    }

    return true;
  }

  /**
   * Create .claudeignore if needed
   */
  async ensureClaudeIgnore(): Promise<void> {
    const ignorePath = path.join(this.projectRoot, '.claudeignore');

    if (!existsSync(ignorePath)) {
      const ignoreContent = `# Auto-learning data
.llm-memory/autolearn-queue.ndjson
.git/llm-memory-autolearn.tmp
`;

      try {
        writeFileSync(ignorePath, ignoreContent);
        log('Created .claudeignore for auto-learning artifacts');
      } catch (error) {
        log('Failed to create .claudeignore:', error);
      }
    }
  }
}

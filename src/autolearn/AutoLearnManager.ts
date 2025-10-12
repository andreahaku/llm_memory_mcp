/**
 * Auto-Learning Manager
 *
 * Central coordinator for the auto-learning system.
 * Manages initialization, hook installation, event processing, and integration with MCP.
 */

import { AutoLearner } from './AutoLearner.js';
import { GitHooksManager } from './GitHooksManager.js';
import { ClaudeCodeHooksManager } from './ClaudeCodeHooks.js';
import { ClaudeCodeAgentsManager } from './ClaudeCodeAgents.js';
import type { MemoryManager } from '../MemoryManager.js';
import type { AutoLearnConfig } from '../types/AutoLearning.js';

function log(message: string, ...args: any[]) {
  console.error(`[AutoLearnManager] ${new Date().toISOString()} ${message}`, ...args);
}

export interface AutoLearnInitResult {
  success: boolean;
  gitHooksInstalled: boolean;
  claudeHooksInstalled: boolean;
  agentsInstalled: boolean;
  errors: string[];
}

export class AutoLearnManager {
  private memory: MemoryManager;
  private learner?: AutoLearner;
  private gitHooks?: GitHooksManager;
  private claudeHooks?: ClaudeCodeHooksManager;
  private agentsManager?: ClaudeCodeAgentsManager;
  private config: AutoLearnConfig;
  private initialized = false;

  constructor(memory: MemoryManager, config?: Partial<AutoLearnConfig>) {
    this.memory = memory;
    this.config = this.getDefaultConfig(config);
  }

  /**
   * Initialize auto-learning system for a project
   */
  async initialize(projectRoot: string, autoInstall = true): Promise<AutoLearnInitResult> {
    if (this.initialized) {
      log('Auto-learning already initialized');
      return {
        success: true,
        gitHooksInstalled: !!this.gitHooks,
        claudeHooksInstalled: !!this.claudeHooks,
        agentsInstalled: !!this.agentsManager,
        errors: []
      };
    }

    log(`Initializing auto-learning for project: ${projectRoot}`);

    const errors: string[] = [];

    // Initialize learner
    this.learner = new AutoLearner(this.memory, this.config);

    // Initialize git hooks
    if (this.config.gitHooks.enabled) {
      try {
        this.gitHooks = new GitHooksManager(projectRoot, this.config.gitHooks);
        await this.learner.initialize(projectRoot);
        log('Git hooks manager initialized');
      } catch (error) {
        const msg = `Failed to initialize git hooks: ${error instanceof Error ? error.message : String(error)}`;
        log(msg);
        errors.push(msg);
      }
    }

    // Initialize Claude Code hooks
    try {
      this.claudeHooks = new ClaudeCodeHooksManager(projectRoot);
      log('Claude Code hooks manager initialized');
    } catch (error) {
      const msg = `Failed to initialize Claude Code hooks: ${error instanceof Error ? error.message : String(error)}`;
      log(msg);
      errors.push(msg);
    }

    // Initialize agents manager
    try {
      this.agentsManager = new ClaudeCodeAgentsManager(projectRoot);
      log('Claude Code agents manager initialized');
    } catch (error) {
      const msg = `Failed to initialize agents manager: ${error instanceof Error ? error.message : String(error)}`;
      log(msg);
      errors.push(msg);
    }

    // Auto-install if requested
    let gitHooksInstalled = false;
    let claudeHooksInstalled = false;
    let agentsInstalled = false;

    if (autoInstall) {
      log('Auto-installing hooks and agents at project level...');

      // Install git hooks
      if (this.gitHooks) {
        try {
          const results = await this.gitHooks.installHooks();
          gitHooksInstalled = results.every(r => r.installed);
          log(`Git hooks installed: ${gitHooksInstalled}`);
        } catch (error) {
          const msg = `Failed to install git hooks: ${error instanceof Error ? error.message : String(error)}`;
          log(msg);
          errors.push(msg);
        }
      }

      // Install Claude Code hooks
      if (this.claudeHooks) {
        try {
          const results = await this.claudeHooks.installHooks('project');
          claudeHooksInstalled = results.every(r => r.installed);
          await this.claudeHooks.ensureClaudeIgnore();
          log(`Claude Code hooks installed: ${claudeHooksInstalled}`);
        } catch (error) {
          const msg = `Failed to install Claude Code hooks: ${error instanceof Error ? error.message : String(error)}`;
          log(msg);
          errors.push(msg);
        }
      }

      // Install agents
      if (this.agentsManager) {
        try {
          const results = await this.agentsManager.installAgents('project');
          agentsInstalled = results.every(r => r.installed);
          log(`Agents installed: ${agentsInstalled}`);
        } catch (error) {
          const msg = `Failed to install agents: ${error instanceof Error ? error.message : String(error)}`;
          log(msg);
          errors.push(msg);
        }
      }
    }

    this.initialized = true;

    const result = {
      success: errors.length === 0,
      gitHooksInstalled,
      claudeHooksInstalled,
      agentsInstalled,
      errors
    };

    log(`Auto-learning initialization ${result.success ? 'completed successfully' : 'completed with errors'}`);
    return result;
  }

  /**
   * Install hooks and agents globally
   */
  async installGlobally(): Promise<{
    hooksInstalled: boolean;
    agentsInstalled: boolean;
    errors: string[];
  }> {
    log('Installing hooks and agents globally...');

    const errors: string[] = [];
    let hooksInstalled = false;
    let agentsInstalled = false;

    // Install Claude Code hooks globally
    if (this.claudeHooks) {
      try {
        const results = await this.claudeHooks.installHooks('global');
        hooksInstalled = results.every(r => r.installed);
        log(`Global hooks installed: ${hooksInstalled}`);
      } catch (error) {
        const msg = `Failed to install global hooks: ${error instanceof Error ? error.message : String(error)}`;
        log(msg);
        errors.push(msg);
      }
    }

    // Install agents globally
    if (this.agentsManager) {
      try {
        const results = await this.agentsManager.installAgents('global');
        agentsInstalled = results.every(r => r.installed);
        log(`Global agents installed: ${agentsInstalled}`);
      } catch (error) {
        const msg = `Failed to install global agents: ${error instanceof Error ? error.message : String(error)}`;
        log(msg);
        errors.push(msg);
      }
    }

    return { hooksInstalled, agentsInstalled, errors };
  }

  /**
   * Get auto-learning status
   */
  async getStatus() {
    if (!this.learner) {
      return {
        initialized: false,
        enabled: false
      };
    }

    const learnerStatus = await this.learner.getStatus();

    const gitHooksStatus = this.gitHooks
      ? await this.gitHooks.checkHooksStatus()
      : [];

    const claudeHooksStatus = this.claudeHooks
      ? await this.claudeHooks.checkHooksStatus('project')
      : [];

    const agentsStatus = this.agentsManager
      ? await this.agentsManager.checkAgentsStatus('project')
      : [];

    return {
      initialized: this.initialized,
      enabled: this.config.enabled,
      learner: learnerStatus,
      hooks: {
        git: gitHooksStatus,
        claude: claudeHooksStatus
      },
      agents: agentsStatus
    };
  }

  /**
   * Process queued auto-learning events
   */
  async processQueue() {
    if (!this.learner) {
      throw new Error('Auto-learning not initialized');
    }

    return await this.learner.processQueue();
  }

  /**
   * Manually capture a commit
   */
  async captureCommit(commitHash?: string) {
    if (!this.learner) {
      throw new Error('Auto-learning not initialized');
    }

    return await this.learner.captureCommit(commitHash);
  }

  /**
   * Capture an event manually
   */
  async captureEvent(event: any) {
    if (!this.learner) {
      throw new Error('Auto-learning not initialized');
    }

    return await this.learner.captureEvent(event);
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(partial?: Partial<AutoLearnConfig>): AutoLearnConfig {
    return {
      enabled: partial?.enabled ?? true,
      captureTypes: partial?.captureTypes ?? ['commit', 'fix', 'refactor', 'pattern'],
      gitHooks: {
        enabled: partial?.gitHooks?.enabled ?? true,
        tagPattern: partial?.gitHooks?.tagPattern ?? '#kb',
        captureDiffs: partial?.gitHooks?.captureDiffs ?? true,
        maxDiffSize: partial?.gitHooks?.maxDiffSize ?? 10000
      },
      filters: {
        minLinesChanged: partial?.filters?.minLinesChanged ?? 5,
        includePatterns: partial?.filters?.includePatterns ?? ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'],
        excludePatterns: partial?.filters?.excludePatterns ?? ['**/node_modules/**', '**/dist/**', '**/*.test.*']
      },
      storage: {
        autoCommit: partial?.storage?.autoCommit ?? false,
        scope: partial?.storage?.scope ?? 'local',
        defaultType: partial?.storage?.defaultType ?? 'snippet'
      },
      insights: {
        enabled: partial?.insights?.enabled ?? true,
        minOccurrences: partial?.insights?.minOccurrences ?? 3
      }
    };
  }
}

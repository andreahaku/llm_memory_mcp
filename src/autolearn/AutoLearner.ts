/**
 * Auto-Learning System
 *
 * Captures developer knowledge from IDE events and git operations,
 * materializing them into searchable memories.
 */

import { MemoryManager } from '../MemoryManager.js';
import { GitHooksManager } from './GitHooksManager.js';
import type {
  AutoLearnEvent,
  AutoLearnContext,
  AutoLearnConfig,
  AutoLearnResult,
  DetectedPattern,
  GitCommitInfo
} from '../types/AutoLearning.js';
import type { MemoryItem, MemoryType } from '../types/Memory.js';
import { ulid } from '../util/ulid.js';
import { redactSecrets } from '../utils/secretFilter.js';
import * as path from 'path';

function log(message: string, ...args: any[]) {
  console.error(`[AutoLearner] ${new Date().toISOString()} ${message}`, ...args);
}

export class AutoLearner {
  private memory: MemoryManager;
  private config: AutoLearnConfig;
  private gitHooks?: GitHooksManager;
  private projectRoot?: string;
  private patternCache: Map<string, DetectedPattern> = new Map();

  constructor(memory: MemoryManager, config: AutoLearnConfig) {
    this.memory = memory;
    this.config = config;
  }

  /**
   * Initialize git hooks (if enabled)
   */
  async initialize(projectRoot: string): Promise<void> {
    this.projectRoot = projectRoot;

    if (this.config.gitHooks.enabled) {
      this.gitHooks = new GitHooksManager(projectRoot, this.config.gitHooks);

      try {
        const statuses = await this.gitHooks.installHooks();
        const installed = statuses.filter(s => s.installed).length;
        log(`Installed ${installed}/${statuses.length} git hooks for auto-learning`);
      } catch (error) {
        log('Failed to install git hooks:', error);
      }
    }
  }

  /**
   * Capture an auto-learning event
   */
  async captureEvent(event: AutoLearnEvent): Promise<AutoLearnResult> {
    if (!this.config.enabled) {
      return { success: false, skipped: 'Auto-learning is disabled' };
    }

    // Check if this event type should be captured
    if (!this.config.captureTypes.includes(event.type)) {
      return { success: false, skipped: `Event type '${event.type}' not enabled for capture` };
    }

    // Apply filters
    const filterResult = this.applyFilters(event.context);
    if (!filterResult.passed) {
      return { success: false, skipped: filterResult.reason };
    }

    // Materialize the event into a memory
    try {
      const memory = await this.materializeMemory(event);
      const memoryId = await this.memory.upsert(memory);

      log(`Captured ${event.type} event as ${memory.type} memory: ${memoryId}`);

      // Update pattern detection if enabled
      if (this.config.insights.enabled && event.type === 'pattern') {
        await this.updatePatternDetection(event.context);
      }

      return {
        success: true,
        memoryId,
        memoryType: memory.type
      };
    } catch (error) {
      log('Failed to capture event:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Process queued events from git hooks
   */
  async processQueue(): Promise<AutoLearnResult[]> {
    if (!this.gitHooks) {
      return [];
    }

    try {
      const entries = await this.gitHooks.readQueue();
      log(`Processing ${entries.length} queued auto-learn events`);

      const results: AutoLearnResult[] = [];

      for (const entry of entries) {
        // Convert queue entry to AutoLearnEvent
        const event = this.queueEntryToEvent(entry);
        if (event) {
          const result = await this.captureEvent(event);
          results.push(result);
        }
      }

      return results;
    } catch (error) {
      log('Failed to process queue:', error);
      return [];
    }
  }

  /**
   * Manually capture a commit by hash
   */
  async captureCommit(commitHash: string = 'HEAD'): Promise<AutoLearnResult> {
    if (!this.gitHooks) {
      return {
        success: false,
        error: 'Git hooks not initialized'
      };
    }

    const commitInfo = this.gitHooks.getCommitInfo(commitHash);
    if (!commitInfo) {
      return {
        success: false,
        error: `Failed to get commit info for ${commitHash}`
      };
    }

    // Convert commit to event
    const event: AutoLearnEvent = {
      type: 'commit',
      timestamp: commitInfo.timestamp,
      success: true,
      context: {
        files: commitInfo.files.map(f => f.path),
        symbols: this.extractSymbolsFromCommit(commitInfo),
        diff: commitInfo.diff,
        summary: commitInfo.message,
        tags: commitInfo.tags,
        metadata: {
          commitHash: commitInfo.hash,
          author: commitInfo.author,
          email: commitInfo.email
        }
      }
    };

    return await this.captureEvent(event);
  }

  /**
   * Get auto-learning status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    hooksInstalled: boolean;
    captureTypes: string[];
    queuedEvents: number;
    patterns: DetectedPattern[];
  }> {
    let hooksInstalled = false;
    let queuedEvents = 0;

    if (this.gitHooks) {
      const statuses = await this.gitHooks.checkHooksStatus();
      hooksInstalled = statuses.every(s => s.installed && s.executable);

      try {
        const queue = await this.gitHooks.readQueue();
        queuedEvents = queue.length;
        // Put queue back (readQueue clears it)
        // Note: This is a read-only operation, so we don't actually clear
      } catch {
        // Ignore
      }
    }

    return {
      enabled: this.config.enabled,
      hooksInstalled,
      captureTypes: this.config.captureTypes,
      queuedEvents,
      patterns: Array.from(this.patternCache.values())
    };
  }

  /**
   * Apply filters to determine if event should be captured
   */
  private applyFilters(context: AutoLearnContext): { passed: boolean; reason?: string } {
    const { filters } = this.config;

    // Check minimum lines changed
    if (context.diff) {
      const linesChanged = this.countLinesChanged(context.diff);
      if (linesChanged < filters.minLinesChanged) {
        return {
          passed: false,
          reason: `Only ${linesChanged} lines changed (minimum: ${filters.minLinesChanged})`
        };
      }
    }

    // Check file patterns
    const relevantFiles = context.files.filter(file => {
      // Check exclude patterns first
      if (filters.excludePatterns.length > 0) {
        for (const pattern of filters.excludePatterns) {
          if (this.matchesPattern(file, pattern)) {
            return false;
          }
        }
      }

      // Check include patterns (if specified)
      if (filters.includePatterns.length > 0) {
        for (const pattern of filters.includePatterns) {
          if (this.matchesPattern(file, pattern)) {
            return true;
          }
        }
        return false;
      }

      return true;
    });

    if (relevantFiles.length === 0) {
      return {
        passed: false,
        reason: 'No files match include/exclude patterns'
      };
    }

    return { passed: true };
  }

  /**
   * Materialize an event into a MemoryItem
   */
  private async materializeMemory(event: AutoLearnEvent): Promise<MemoryItem> {
    const { context, type, timestamp } = event;
    const { storage } = this.config;

    // Determine memory type based on event type
    let memoryType: MemoryType = storage.defaultType;
    if (type === 'fix') {
      memoryType = 'insight'; // Fixes become insights
    } else if (type === 'refactor') {
      memoryType = 'pattern'; // Refactorings become patterns
    } else if (type === 'pattern') {
      memoryType = 'pattern';
    } else if (type === 'test') {
      memoryType = 'snippet'; // Test code becomes snippets
    }

    // Generate title from context
    const title = this.generateTitle(event);

    // Redact secrets from content
    const { text: safeText } = redactSecrets(context.summary);
    const safeDiff = context.diff ? redactSecrets(context.diff).text : undefined;
    const safeCode = safeDiff;

    // Detect language from files
    const language = this.detectLanguage(context.files);

    // Build memory item
    const memory: MemoryItem = {
      id: ulid(),
      type: memoryType,
      scope: storage.scope,
      title,
      text: safeText,
      code: safeCode,
      language,
      facets: {
        tags: context.tags,
        files: context.files,
        symbols: context.symbols
      },
      context: {
        tool: 'autolearn',
        ...(context.metadata?.commitHash && { commit: context.metadata.commitHash })
      },
      quality: {
        confidence: 0.7, // Auto-learned memories start with moderate confidence
        reuseCount: 0,
        pinned: false
      },
      security: {
        sensitivity: 'team' // Auto-learned from commits should be team-visible
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1
    };

    return memory;
  }

  /**
   * Generate a descriptive title from the event
   */
  private generateTitle(event: AutoLearnEvent): string {
    const { type, context } = event;

    // For commits, use the first line of the message
    if (type === 'commit') {
      const firstLine = context.summary.split('\n')[0];
      return firstLine.replace(/#\w+/g, '').trim(); // Remove hashtags
    }

    // For other types, generate from context
    const action = type.charAt(0).toUpperCase() + type.slice(1);
    const mainFile = context.files[0] ? path.basename(context.files[0]) : 'code';
    const symbolHint = context.symbols.length > 0 ? ` (${context.symbols[0]})` : '';

    return `${action}: ${mainFile}${symbolHint}`;
  }

  /**
   * Detect programming language from file extensions
   */
  private detectLanguage(files: string[]): string | undefined {
    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala'
    };

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (extMap[ext]) {
        return extMap[ext];
      }
    }

    return undefined;
  }

  /**
   * Count lines changed in a diff
   */
  private countLinesChanged(diff: string): number {
    const lines = diff.split('\n');
    let count = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        count++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        count++;
      }
    }

    return count;
  }

  /**
   * Convert queue entry to AutoLearnEvent
   */
  private queueEntryToEvent(entry: any): AutoLearnEvent | null {
    try {
      return {
        type: entry.type || 'commit',
        timestamp: entry.timestamp || new Date().toISOString(),
        success: true,
        context: {
          files: [], // Would need to parse from diff
          symbols: [],
          diff: entry.diff,
          summary: entry.message || '',
          tags: this.extractTags(entry.message || ''),
          metadata: {
            commitHash: entry.hash
          }
        }
      };
    } catch (error) {
      log('Failed to parse queue entry:', error);
      return null;
    }
  }

  /**
   * Extract hashtags from text
   */
  private extractTags(text: string): string[] {
    const tagRegex = /#(\w+)/g;
    const tags: string[] = [];
    let match;

    while ((match = tagRegex.exec(text)) !== null) {
      tags.push(match[1].toLowerCase());
    }

    // Remove the trigger tag (#kb)
    const triggerTag = (this.config.gitHooks.tagPattern || '#kb').replace('#', '').toLowerCase();
    return tags.filter(tag => tag !== triggerTag);
  }

  /**
   * Extract symbols (function/class names) from commit
   */
  private extractSymbolsFromCommit(commit: GitCommitInfo): string[] {
    // Simple heuristic: extract capitalized words that might be symbols
    // In a production system, this would use AST parsing
    const symbols: string[] = [];
    const text = commit.message + '\n' + (commit.diff || '');

    // Look for common code patterns
    const patterns = [
      /(?:function|const|let|var)\s+(\w+)/g,  // JS/TS functions/vars
      /class\s+(\w+)/g,                        // Class names
      /interface\s+(\w+)/g,                    // Interface names
      /type\s+(\w+)/g,                         // Type names
      /def\s+(\w+)/g,                          // Python functions
      /pub\s+fn\s+(\w+)/g                      // Rust functions
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && !symbols.includes(match[1])) {
          symbols.push(match[1]);
        }
      }
    }

    return symbols.slice(0, 10); // Limit to top 10
  }

  /**
   * Update pattern detection based on captured events
   */
  private async updatePatternDetection(context: AutoLearnContext): Promise<void> {
    // Simple pattern detection: track recurring file/symbol combinations
    const signature = context.files.sort().join(',') + ':' + context.symbols.sort().join(',');

    if (this.patternCache.has(signature)) {
      const pattern = this.patternCache.get(signature)!;
      pattern.occurrences++;
      pattern.confidence = Math.min(1.0, pattern.occurrences / this.config.insights.minOccurrences);

      // Create insight memory if threshold reached
      if (pattern.occurrences === this.config.insights.minOccurrences) {
        log(`Pattern detected with ${pattern.occurrences} occurrences: ${pattern.description}`);

        const insightMemory: MemoryItem = {
          id: ulid(),
          type: 'insight',
          scope: this.config.storage.scope,
          title: `Pattern: ${pattern.description}`,
          text: `This pattern has been observed ${pattern.occurrences} times across:\n${pattern.files.map(f => `- ${f}`).join('\n')}`,
          facets: {
            tags: ['pattern', 'auto-detected', ...context.tags],
            files: pattern.files,
            symbols: context.symbols
          },
          context: {
            tool: 'autolearn-pattern'
          },
          quality: {
            confidence: pattern.confidence,
            reuseCount: 0
          },
          security: {
            sensitivity: 'team'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        };

        await this.memory.upsert(insightMemory);
      }
    } else {
      // First occurrence
      const pattern: DetectedPattern = {
        description: context.summary,
        files: [...context.files],
        examples: [context.diff || context.summary],
        occurrences: 1,
        confidence: 1 / this.config.insights.minOccurrences
      };
      this.patternCache.set(signature, pattern);
    }
  }

  /**
   * Simple glob-like pattern matching
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

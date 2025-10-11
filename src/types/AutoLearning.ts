/**
 * Auto-Learning Types
 *
 * Defines types for automatic knowledge capture from IDE events and git operations.
 */

import type { MemoryType, MemoryScope } from './Memory.js';

/**
 * Types of events that can trigger auto-learning
 */
export type AutoLearnEventType = 'fix' | 'refactor' | 'test' | 'commit' | 'pattern';

/**
 * Event captured from IDE or git operations
 */
export interface AutoLearnEvent {
  type: AutoLearnEventType;
  timestamp: string;
  context: AutoLearnContext;
  success: boolean;
  metadata?: Record<string, any>;
}

/**
 * Context information about the auto-learn event
 */
export interface AutoLearnContext {
  /** Files involved in the change */
  files: string[];

  /** Code symbols affected (functions, classes, etc.) */
  symbols: string[];

  /** Git diff or code change description */
  diff?: string;

  /** Brief summary of what changed */
  summary: string;

  /** Tags to apply to the generated memory */
  tags: string[];

  /** Additional context metadata */
  metadata?: {
    language?: string;
    framework?: string;
    errorMessage?: string;
    testResults?: any;
    [key: string]: any;
  };
}

/**
 * Configuration for auto-learning behavior
 */
export interface AutoLearnConfig {
  /** Enable/disable auto-learning */
  enabled: boolean;

  /** Which event types to capture */
  captureTypes: AutoLearnEventType[];

  /** Git hooks configuration */
  gitHooks: {
    /** Enable git hook installation */
    enabled: boolean;

    /** Pattern to detect in commit messages (default: '#kb') */
    tagPattern: string;

    /** Capture full commit diffs */
    captureDiffs: boolean;

    /** Maximum diff size in characters */
    maxDiffSize?: number;
  };

  /** Filters to apply before creating memories */
  filters: {
    /** Minimum lines changed to trigger capture */
    minLinesChanged: number;

    /** File patterns to include (glob) */
    includePatterns: string[];

    /** File patterns to exclude (glob) */
    excludePatterns: string[];
  };

  /** Storage configuration */
  storage: {
    /** Automatically commit auto-learned memories to .llm-memory/ */
    autoCommit: boolean;

    /** Default scope for auto-learned memories */
    scope: MemoryScope;

    /** Memory type for auto-learned items */
    defaultType: MemoryType;
  };

  /** Insight generation settings */
  insights: {
    /** Generate insights from patterns */
    enabled: boolean;

    /** Minimum occurrences before creating pattern */
    minOccurrences: number;
  };
}

/**
 * Result of auto-learning capture
 */
export interface AutoLearnResult {
  /** Whether capture was successful */
  success: boolean;

  /** ID of created memory (if successful) */
  memoryId?: string;

  /** Type of memory created */
  memoryType?: MemoryType;

  /** Error message (if failed) */
  error?: string;

  /** Reason for skipping (if filtered out) */
  skipped?: string;
}

/**
 * Git commit information
 */
export interface GitCommitInfo {
  /** Commit hash */
  hash: string;

  /** Commit message */
  message: string;

  /** Author name */
  author: string;

  /** Author email */
  email: string;

  /** Commit timestamp */
  timestamp: string;

  /** Files changed in this commit */
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }[];

  /** Full diff (optional) */
  diff?: string;

  /** Tags extracted from commit message */
  tags: string[];
}

/**
 * Pattern detection for auto-learning
 */
export interface DetectedPattern {
  /** Pattern description */
  description: string;

  /** Files where pattern was detected */
  files: string[];

  /** Code examples demonstrating the pattern */
  examples: string[];

  /** Number of times pattern occurred */
  occurrences: number;

  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Hook installation status
 */
export interface HookStatus {
  /** Hook name (e.g., 'commit-msg', 'post-commit') */
  name: string;

  /** Whether hook is installed */
  installed: boolean;

  /** Hook file path */
  path?: string;

  /** Whether hook is executable */
  executable?: boolean;

  /** Error message if installation failed */
  error?: string;
}

/**
 * Git Hooks Manager
 *
 * Handles installation and management of git hooks for auto-learning.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import * as path from 'path';
import type { GitCommitInfo, HookStatus, AutoLearnConfig } from '../types/AutoLearning.js';

function log(message: string, ...args: any[]) {
  console.error(`[GitHooksManager] ${new Date().toISOString()} ${message}`, ...args);
}

export class GitHooksManager {
  private projectRoot: string;
  private hooksDir: string;
  private config: AutoLearnConfig['gitHooks'];

  constructor(projectRoot: string, config: AutoLearnConfig['gitHooks']) {
    this.projectRoot = projectRoot;
    this.hooksDir = path.join(projectRoot, '.git', 'hooks');
    this.config = config;
  }

  /**
   * Install all auto-learning git hooks
   */
  async installHooks(): Promise<HookStatus[]> {
    const results: HookStatus[] = [];

    // Ensure .git/hooks directory exists
    if (!existsSync(this.hooksDir)) {
      try {
        mkdirSync(this.hooksDir, { recursive: true });
      } catch (error) {
        log('Failed to create hooks directory:', error);
        return [];
      }
    }

    // Install commit-msg hook (parse #kb tags)
    results.push(await this.installCommitMsgHook());

    // Install post-commit hook (capture diffs)
    if (this.config.captureDiffs) {
      results.push(await this.installPostCommitHook());
    }

    return results;
  }

  /**
   * Uninstall auto-learning git hooks
   */
  async uninstallHooks(): Promise<void> {
    const hooks = ['commit-msg', 'post-commit'];

    for (const hookName of hooks) {
      const hookPath = path.join(this.hooksDir, hookName);

      if (existsSync(hookPath)) {
        try {
          const content = readFileSync(hookPath, 'utf8');

          // Only remove if it's our hook (check for marker)
          if (content.includes('# LLM-MEMORY-MCP-AUTOLEARN')) {
            const fs = await import('fs/promises');
            await fs.unlink(hookPath);
            log(`Uninstalled ${hookName} hook`);
          }
        } catch (error) {
          log(`Failed to uninstall ${hookName} hook:`, error);
        }
      }
    }
  }

  /**
   * Check status of installed hooks
   */
  async checkHooksStatus(): Promise<HookStatus[]> {
    const hooks = ['commit-msg', 'post-commit'];
    const results: HookStatus[] = [];

    for (const hookName of hooks) {
      const hookPath = path.join(this.hooksDir, hookName);
      const installed = existsSync(hookPath);

      let executable = false;
      if (installed) {
        try {
          const stats = await (await import('fs/promises')).stat(hookPath);
          executable = !!(stats.mode & 0o111); // Check if any execute bit is set
        } catch (error) {
          // Ignore
        }
      }

      results.push({
        name: hookName,
        installed,
        path: hookPath,
        executable
      });
    }

    return results;
  }

  /**
   * Install commit-msg hook to parse #kb tags
   */
  private async installCommitMsgHook(): Promise<HookStatus> {
    const hookName = 'commit-msg';
    const hookPath = path.join(this.hooksDir, hookName);

    try {
      // Check if hook already exists
      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf8');

        // If it's not our hook, back it up
        if (!existing.includes('# LLM-MEMORY-MCP-AUTOLEARN')) {
          const backupPath = `${hookPath}.backup`;
          writeFileSync(backupPath, existing);
          log(`Backed up existing ${hookName} hook to ${backupPath}`);
        }
      }

      // Create the hook script
      const hookScript = this.generateCommitMsgHook();
      writeFileSync(hookPath, hookScript);

      // Make executable
      chmodSync(hookPath, 0o755);

      log(`Installed ${hookName} hook at ${hookPath}`);

      return {
        name: hookName,
        installed: true,
        path: hookPath,
        executable: true
      };
    } catch (error) {
      log(`Failed to install ${hookName} hook:`, error);
      return {
        name: hookName,
        installed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Install post-commit hook to capture diffs
   */
  private async installPostCommitHook(): Promise<HookStatus> {
    const hookName = 'post-commit';
    const hookPath = path.join(this.hooksDir, hookName);

    try {
      // Check if hook already exists
      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf8');

        // If it's not our hook, back it up
        if (!existing.includes('# LLM-MEMORY-MCP-AUTOLEARN')) {
          const backupPath = `${hookPath}.backup`;
          writeFileSync(backupPath, existing);
          log(`Backed up existing ${hookName} hook to ${backupPath}`);
        }
      }

      // Create the hook script
      const hookScript = this.generatePostCommitHook();
      writeFileSync(hookPath, hookScript);

      // Make executable
      chmodSync(hookPath, 0o755);

      log(`Installed ${hookName} hook at ${hookPath}`);

      return {
        name: hookName,
        installed: true,
        path: hookPath,
        executable: true
      };
    } catch (error) {
      log(`Failed to install ${hookName} hook:`, error);
      return {
        name: hookName,
        installed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate commit-msg hook script
   */
  private generateCommitMsgHook(): string {
    const tagPattern = this.config.tagPattern || '#kb';

    return `#!/bin/sh
# LLM-MEMORY-MCP-AUTOLEARN
# Auto-learning commit-msg hook
# Generated by llm-memory-mcp

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Check if commit message contains auto-learn tag (${tagPattern})
if echo "$COMMIT_MSG" | grep -q "${tagPattern}"; then
  echo "[llm-memory] Auto-learning tag detected: ${tagPattern}"

  # Create a marker file for post-commit hook
  echo "$COMMIT_MSG" > .git/llm-memory-autolearn.tmp
fi

exit 0
`;
  }

  /**
   * Generate post-commit hook script
   */
  private generatePostCommitHook(): string {
    const maxDiffSize = this.config.maxDiffSize || 10000;

    return `#!/bin/sh
# LLM-MEMORY-MCP-AUTOLEARN
# Auto-learning post-commit hook
# Generated by llm-memory-mcp

MARKER_FILE=".git/llm-memory-autolearn.tmp"

# Check if auto-learn was triggered
if [ -f "$MARKER_FILE" ]; then
  echo "[llm-memory] Capturing commit for auto-learning..."

  # Get commit info
  COMMIT_HASH=$(git rev-parse HEAD)
  COMMIT_MSG=$(cat "$MARKER_FILE")

  # Get diff (limited to ${maxDiffSize} characters)
  DIFF=$(git show --pretty=format: --unified=3 HEAD | head -c ${maxDiffSize})

  # Save to auto-learn queue file
  QUEUE_FILE=".llm-memory/autolearn-queue.ndjson"
  mkdir -p ".llm-memory"

  # Create JSON entry
  cat > "$MARKER_FILE.json" << EOF
{
  "type": "commit",
  "hash": "$COMMIT_HASH",
  "message": $(echo "$COMMIT_MSG" | jq -Rs .),
  "diff": $(echo "$DIFF" | jq -Rs .),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  # Append to queue
  cat "$MARKER_FILE.json" >> "$QUEUE_FILE"

  # Cleanup
  rm -f "$MARKER_FILE" "$MARKER_FILE.json"

  echo "[llm-memory] Commit queued for auto-learning processing"
fi

exit 0
`;
  }

  /**
   * Parse commit message for auto-learning tags and metadata
   */
  parseCommitMessage(message: string): {
    shouldCapture: boolean;
    tags: string[];
    cleanMessage: string;
  } {
    const tagPattern = this.config.tagPattern || '#kb';
    const shouldCapture = message.includes(tagPattern);

    if (!shouldCapture) {
      return {
        shouldCapture: false,
        tags: [],
        cleanMessage: message
      };
    }

    // Extract all hashtags
    const hashtagRegex = /#(\w+)/g;
    const tags: string[] = [];
    let match;

    while ((match = hashtagRegex.exec(message)) !== null) {
      tags.push(match[1].toLowerCase());
    }

    // Remove the trigger tag from tags list
    const triggerTag = tagPattern.replace('#', '').toLowerCase();
    const filteredTags = tags.filter(tag => tag !== triggerTag);

    // Clean message (remove hashtags)
    const cleanMessage = message.replace(hashtagRegex, '').trim();

    return {
      shouldCapture: true,
      tags: filteredTags,
      cleanMessage
    };
  }

  /**
   * Get commit information from git
   */
  getCommitInfo(commitHash: string = 'HEAD'): GitCommitInfo | null {
    try {
      // Get commit metadata
      const format = '%H%n%s%n%an%n%ae%n%aI';
      const output = execSync(`git show -s --format="${format}" ${commitHash}`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();

      const lines = output.split('\n');
      if (lines.length < 5) {
        return null;
      }

      const [hash, message, author, email, timestamp] = lines;

      // Parse commit message
      const parsed = this.parseCommitMessage(message);

      // Get file changes
      const statOutput = execSync(`git show --stat --format= ${commitHash}`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();

      const files: GitCommitInfo['files'] = [];
      const fileLines = statOutput.split('\n').filter(line => line.includes('|'));

      for (const line of fileLines) {
        const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*/);
        if (match) {
          const [, filePath, changes] = match;
          const changeCount = parseInt(changes, 10);

          // Determine status (simplified)
          let status: GitCommitInfo['files'][0]['status'] = 'modified';
          if (line.includes('(new)')) status = 'added';
          if (line.includes('(gone)')) status = 'deleted';

          files.push({
            path: filePath.trim(),
            status,
            additions: changeCount, // Simplified, would need more parsing for exact split
            deletions: 0
          });
        }
      }

      // Get diff if configured
      let diff: string | undefined;
      if (this.config.captureDiffs) {
        const maxSize = this.config.maxDiffSize || 10000;
        diff = execSync(`git show --pretty=format: ${commitHash}`, {
          cwd: this.projectRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          maxBuffer: maxSize * 2
        }).slice(0, maxSize);
      }

      return {
        hash,
        message: parsed.cleanMessage,
        author,
        email,
        timestamp,
        files,
        diff,
        tags: parsed.tags
      };
    } catch (error) {
      log('Failed to get commit info:', error);
      return null;
    }
  }

  /**
   * Read and clear the auto-learn queue
   */
  async readQueue(): Promise<any[]> {
    const queuePath = path.join(this.projectRoot, '.llm-memory', 'autolearn-queue.ndjson');

    if (!existsSync(queuePath)) {
      return [];
    }

    try {
      const content = readFileSync(queuePath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      const entries = lines.map(line => JSON.parse(line));

      // Clear the queue
      writeFileSync(queuePath, '');

      return entries;
    } catch (error) {
      log('Failed to read queue:', error);
      return [];
    }
  }
}

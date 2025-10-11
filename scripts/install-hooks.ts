#!/usr/bin/env ts-node

/**
 * Install Auto-Learning Hooks
 *
 * This script installs both git hooks and Claude Code hooks for auto-learning.
 * Usage: pnpm run install-hooks [--global]
 */

import { ClaudeCodeHooksManager } from '../src/autolearn/ClaudeCodeHooks.js';
import { GitHooksManager } from '../src/autolearn/GitHooksManager.js';
import type { AutoLearnConfig } from '../src/types/AutoLearning.js';
import * as path from 'path';

const projectRoot = path.resolve(process.cwd());
const installGlobal = process.argv.includes('--global');

// Default auto-learning configuration
const defaultConfig: AutoLearnConfig = {
  enabled: true,
  captureTypes: ['commit', 'fix', 'refactor', 'pattern'],
  gitHooks: {
    enabled: true,
    tagPattern: '#kb',
    captureDiffs: true,
    maxDiffSize: 10000
  },
  filters: {
    minLinesChanged: 5,
    includePatterns: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/*.test.*']
  },
  storage: {
    autoCommit: false,
    scope: 'local',
    defaultType: 'snippet'
  },
  insights: {
    enabled: true,
    minOccurrences: 3
  }
};

async function main() {
  console.log('🔧 Installing Auto-Learning Hooks...\n');

  // Install Git Hooks
  console.log('📦 Installing Git Hooks...');
  const gitHooks = new GitHooksManager(projectRoot, defaultConfig.gitHooks);

  try {
    const gitResults = await gitHooks.installHooks();
    for (const result of gitResults) {
      if (result.installed) {
        console.log(`  ✅ ${result.name} - installed at ${result.path}`);
      } else {
        console.log(`  ❌ ${result.name} - failed: ${result.error}`);
      }
    }
  } catch (error) {
    console.error('  ❌ Failed to install git hooks:', error);
  }

  // Install Claude Code Hooks
  console.log('\n🎯 Installing Claude Code Hooks...');
  const claudeHooks = new ClaudeCodeHooksManager(projectRoot);

  // Install at project level
  try {
    console.log(`  📍 Project-level hooks (.claude/hooks/)`);
    const projectResults = await claudeHooks.installHooks('project');
    for (const result of projectResults) {
      if (result.installed) {
        console.log(`    ✅ ${result.hookName} - installed`);
      } else {
        console.log(`    ❌ ${result.hookName} - failed: ${result.error}`);
      }
    }

    // Create .claudeignore
    await claudeHooks.ensureClaudeIgnore();
    console.log(`    ✅ .claudeignore - created/updated`);
  } catch (error) {
    console.error('  ❌ Failed to install project hooks:', error);
  }

  // Install at global level if requested
  if (installGlobal) {
    try {
      console.log(`\n  🌍 Global hooks (~/.claude/hooks/)`);
      const globalResults = await claudeHooks.installHooks('global');
      for (const result of globalResults) {
        if (result.installed) {
          console.log(`    ✅ ${result.hookName} - installed`);
        } else {
          console.log(`    ❌ ${result.hookName} - failed: ${result.error}`);
        }
      }
    } catch (error) {
      console.error('  ❌ Failed to install global hooks:', error);
    }
  }

  console.log('\n✨ Auto-Learning hooks installed successfully!');
  console.log('\n📝 Usage:');
  console.log('  • Tag commits with #kb to auto-capture knowledge');
  console.log('  • Example: git commit -m "Implement JWT auth #kb #security"');
  console.log('  • Captured knowledge will be queued in .llm-memory/autolearn-queue.ndjson');
  console.log('  • Use the dev-memory-manager agent to process the queue');
  console.log('\n🔗 Learn more: See docs/AUTO_LEARNING.md');
}

main().catch(console.error);

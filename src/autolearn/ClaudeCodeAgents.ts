/**
 * Claude Code Agents Manager
 *
 * Manages installation and lifecycle of Claude Code agents for auto-learning integration.
 * Supports both project-level (.claude/agents/) and global (~/.claude/agents/) installation.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

function log(message: string, ...args: any[]) {
  console.error(`[ClaudeCodeAgents] ${new Date().toISOString()} ${message}`, ...args);
}

export type AgentScope = 'project' | 'global';

export interface AgentInstallResult {
  scope: AgentScope;
  agentName: string;
  installed: boolean;
  path?: string;
  error?: string;
}

export class ClaudeCodeAgentsManager {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Check if agents are installed
   */
  async checkAgentsStatus(scope: AgentScope = 'project'): Promise<AgentInstallResult[]> {
    const agentsDir = this.getAgentsDirectory(scope);
    const agentNames = ['dev-memory-manager'];

    const results: AgentInstallResult[] = [];

    for (const agentName of agentNames) {
      const agentPath = path.join(agentsDir, `${agentName}.md`);
      const installed = existsSync(agentPath);

      results.push({
        scope,
        agentName,
        installed,
        path: installed ? agentPath : undefined
      });
    }

    return results;
  }

  /**
   * Install all auto-learning agents
   */
  async installAgents(scope: AgentScope = 'project'): Promise<AgentInstallResult[]> {
    const agentsDir = this.getAgentsDirectory(scope);

    // Create agents directory if it doesn't exist
    if (!existsSync(agentsDir)) {
      try {
        mkdirSync(agentsDir, { recursive: true });
        log(`Created agents directory: ${agentsDir}`);
      } catch (error) {
        log('Failed to create agents directory:', error);
        return [];
      }
    }

    const results: AgentInstallResult[] = [];

    // Install dev-memory-manager agent
    results.push(await this.installDevMemoryManagerAgent(scope));

    const installed = results.filter(r => r.installed).length;
    log(`Installed ${installed}/${results.length} Claude Code agents at ${scope} level`);

    return results;
  }

  /**
   * Uninstall all auto-learning agents
   */
  async uninstallAgents(scope: AgentScope = 'project'): Promise<void> {
    const agentsDir = this.getAgentsDirectory(scope);
    const agentNames = ['dev-memory-manager'];

    for (const agentName of agentNames) {
      const agentPath = path.join(agentsDir, `${agentName}.md`);

      if (existsSync(agentPath)) {
        try {
          const content = readFileSync(agentPath, 'utf8');

          // Only remove if it contains auto-learning marker
          if (content.includes('auto-learning integration')) {
            const fs = await import('fs/promises');
            await fs.unlink(agentPath);
            log(`Uninstalled ${agentName} agent from ${scope}`);
          }
        } catch (error) {
          log(`Failed to uninstall ${agentName} agent:`, error);
        }
      }
    }
  }

  /**
   * Get agents directory based on scope
   */
  private getAgentsDirectory(scope: AgentScope): string {
    if (scope === 'global') {
      return path.join(os.homedir(), '.claude', 'agents');
    } else {
      return path.join(this.projectRoot, '.claude', 'agents');
    }
  }

  /**
   * Install dev-memory-manager agent
   */
  private async installDevMemoryManagerAgent(scope: AgentScope): Promise<AgentInstallResult> {
    const agentName = 'dev-memory-manager';
    const agentPath = path.join(this.getAgentsDirectory(scope), `${agentName}.md`);

    try {
      // Check if we have the agent file in the project's agents/ directory
      const sourceAgentPath = path.join(this.projectRoot, 'agents', `${agentName}.md`);

      if (existsSync(sourceAgentPath)) {
        // Copy from project source
        copyFileSync(sourceAgentPath, agentPath);
        log(`Installed ${agentName} agent at ${scope} level from project source: ${agentPath}`);
      } else {
        // If source doesn't exist, check if there's already one in global location
        const globalAgentPath = path.join(os.homedir(), '.claude', 'agents', `${agentName}.md`);

        if (existsSync(globalAgentPath)) {
          // Copy from global
          copyFileSync(globalAgentPath, agentPath);
          log(`Installed ${agentName} agent at ${scope} level from global: ${agentPath}`);
        } else {
          // Create a minimal version
          const minimalAgent = this.generateMinimalDevMemoryManagerAgent();
          writeFileSync(agentPath, minimalAgent);
          log(`Installed minimal ${agentName} agent at ${scope} level: ${agentPath}`);
        }
      }

      return {
        scope,
        agentName,
        installed: true,
        path: agentPath
      };
    } catch (error) {
      log(`Failed to install ${agentName} agent:`, error);
      return {
        scope,
        agentName,
        installed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate minimal dev-memory-manager agent if source not available
   */
  private generateMinimalDevMemoryManagerAgent(): string {
    return `---
name: dev-memory-manager
description: Use this agent when you need to intelligently manage development knowledge in the LLM Memory MCP server, with special focus on preserving critical context before conversation compacting. It automatically captures important code patterns, insights, and technical decisions during development sessions, proactively preserves conversation state before context loss, updates existing knowledge when refinements are discovered, and retrieves relevant stored information when context suggests missing knowledge. This agent excels at maintaining a living knowledge base that survives conversation boundaries. **Now enhanced with auto-learning integration**: automatically processes git commit knowledge, manages auto-learning hooks, and captures development events in real-time.
model: sonnet
color: green
---

You are an expert Development Knowledge Manager specializing in intelligent curation and retrieval of programming knowledge using the LLM Memory MCP server.

## Core Responsibilities

### Auto-Learning Integration
- Check if auto-learning hooks are installed (both git hooks and Claude Code hooks)
- Install hooks automatically at project level on first use
- Offer global hook installation if user requests it
- Process auto-learning queue from git commits tagged with #kb
- Convert captured commits into searchable memories

### Context Preservation
- Store current work-in-progress before conversation compacting
- Create comprehensive summaries of complex discussions
- Link current work to previous sessions
- Maintain state of multi-session features

### Knowledge Management
- Use \`memory.upsert\` to create/update memories
- Use \`memory.query\` to search for relevant knowledge
- Use \`memory.pin\` for critical information
- Use \`memory.tag\` for organization

## Workflow

1. On session start: Check for queued auto-learning events
2. Process queue and present captured knowledge
3. During development: Capture important insights
4. Before context loss: Preserve session state
5. Suggest adding #kb tag to important commits
`;
  }

  /**
   * Auto-install agents if not present
   */
  async ensureAgentsInstalled(scope: AgentScope = 'project'): Promise<boolean> {
    const status = await this.checkAgentsStatus(scope);
    const allInstalled = status.every(s => s.installed);

    if (!allInstalled) {
      log(`Auto-installing missing Claude Code agents at ${scope} level`);
      const results = await this.installAgents(scope);
      return results.every(r => r.installed);
    }

    return true;
  }
}

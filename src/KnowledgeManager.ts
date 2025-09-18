import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeStore } from './storage/KnowledgeStore.js';
import type { Note, NoteType, Scope, SearchQuery, SearchResult, ProjectInfo } from './types/KnowledgeBase.js';

export class KnowledgeManager {
  private globalStore: KnowledgeStore;
  private projectStore: KnowledgeStore | null = null;
  private currentProjectInfo: ProjectInfo | null = null;

  constructor() {
    // Initialize global store
    const homeDir = os.homedir();
    const globalDir = path.join(homeDir, '.llm-memory', 'global');
    this.globalStore = new KnowledgeStore(globalDir);

    // Initialize project store if in a project
    this.initializeProject();
  }

  private initializeProject(): void {
    try {
      const projectInfo = this.detectProject();
      this.currentProjectInfo = projectInfo;

      if (projectInfo.hasKnowledgeBase) {
        const projectDir = path.join(projectInfo.path, '.llm-memory');
        this.projectStore = new KnowledgeStore(projectDir);
      }
    } catch (error) {
      // Not in a project or no git, use local project store
      const localDir = path.join(os.homedir(), '.llm-memory', 'projects', this.getDirectoryHash(process.cwd()));
      this.projectStore = new KnowledgeStore(localDir);

      this.currentProjectInfo = {
        id: this.getDirectoryHash(process.cwd()),
        name: path.basename(process.cwd()),
        path: process.cwd(),
        hasKnowledgeBase: false
      };
    }
  }

  private detectProject(): ProjectInfo {
    try {
      // Get git root
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();

      // Get remote URL for unique ID
      let remote: string | undefined;
      try {
        remote = execSync('git config --get remote.origin.url', {
          cwd: gitRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
      } catch {
        // No remote
      }

      const projectId = this.generateProjectId(gitRoot, remote);
      const hasKnowledgeBase = existsSync(path.join(gitRoot, '.llm-memory'));

      return {
        id: projectId,
        name: path.basename(gitRoot),
        path: gitRoot,
        hasKnowledgeBase
      };
    } catch {
      throw new Error('Not a git repository');
    }
  }

  private generateProjectId(gitRoot: string, remote?: string): string {
    const input = remote ? `${gitRoot}|${this.normalizeRemote(remote)}` : gitRoot;
    return createHash('sha1').update(input).digest('hex').substring(0, 16);
  }

  private normalizeRemote(remote: string): string {
    let normalized = remote.replace(/\.git$/, '');
    if (normalized.startsWith('git@')) {
      normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');
    }
    return normalized.replace(/\/$/, '').toLowerCase();
  }

  private getDirectoryHash(dir: string): string {
    return createHash('sha1').update(dir).digest('hex').substring(0, 16);
  }

  private getStore(scope: Scope): KnowledgeStore {
    return scope === 'global' ? this.globalStore : this.projectStore!;
  }

  /**
   * Create a new note
   */
  async create(
    type: NoteType,
    title: string,
    content: string,
    options: {
      scope?: Scope;
      tags?: string[];
      language?: string;
      file?: string;
    } = {}
  ): Promise<string> {
    const scope = options.scope || 'project';
    const store = this.getStore(scope);

    return await store.create(type, title, content, {
      tags: options.tags,
      scope,
      metadata: {
        language: options.language,
        file: options.file
      }
    });
  }

  /**
   * Read a note by ID
   */
  async read(id: string, scope?: Scope): Promise<Note | null> {
    if (scope) {
      const store = this.getStore(scope);
      return await store.read(id);
    }

    // Search in both scopes, project first
    if (this.projectStore) {
      const note = await this.projectStore.read(id);
      if (note) return note;
    }

    return await this.globalStore.read(id);
  }

  /**
   * Update a note
   */
  async update(
    id: string,
    updates: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'type'>>,
    scope?: Scope
  ): Promise<boolean> {
    if (scope) {
      const store = this.getStore(scope);
      return await store.update(id, updates);
    }

    // Try to update in both scopes
    if (this.projectStore) {
      const success = await this.projectStore.update(id, updates);
      if (success) return true;
    }

    return await this.globalStore.update(id, updates);
  }

  /**
   * Delete a note
   */
  async delete(id: string, scope?: Scope): Promise<boolean> {
    if (scope) {
      const store = this.getStore(scope);
      return await store.delete(id);
    }

    // Try to delete from both scopes
    if (this.projectStore) {
      const success = await this.projectStore.delete(id);
      if (success) return true;
    }

    return await this.globalStore.delete(id);
  }

  /**
   * List all notes
   */
  async list(scope?: Scope | 'all'): Promise<Note[]> {
    if (scope === 'global') {
      return await this.globalStore.list();
    }

    if (scope === 'project' && this.projectStore) {
      return await this.projectStore.list();
    }

    // List from both scopes
    const notes: Note[] = [];

    if (this.projectStore) {
      const projectNotes = await this.projectStore.list();
      notes.push(...projectNotes);
    }

    const globalNotes = await this.globalStore.list();
    notes.push(...globalNotes);

    // Sort by updated date
    return notes.sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt));
  }

  /**
   * Search notes
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    if (query.scope === 'global') {
      return await this.globalStore.search(query);
    }

    if (query.scope === 'project' && this.projectStore) {
      return await this.projectStore.search(query);
    }

    // Search across both scopes
    const results: Note[] = [];

    if (this.projectStore) {
      const projectResults = await this.projectStore.search({ ...query, scope: 'project' });
      results.push(...projectResults.notes);
    }

    const globalResults = await this.globalStore.search({ ...query, scope: 'global' });
    results.push(...globalResults.notes);

    // Sort by relevance (simple text matching score)
    if (query.q) {
      const searchTerm = query.q.toLowerCase();
      results.sort((a, b) => {
        const scoreA = this.calculateRelevanceScore(a, searchTerm);
        const scoreB = this.calculateRelevanceScore(b, searchTerm);
        return scoreB - scoreA;
      });
    } else {
      // Sort by updated date
      results.sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt));
    }

    const limit = query.limit || 50;
    return {
      notes: results.slice(0, limit),
      total: results.length,
      query
    };
  }

  private calculateRelevanceScore(note: Note, searchTerm: string): number {
    let score = 0;

    // Title match (highest weight)
    if (note.title.toLowerCase().includes(searchTerm)) {
      score += 10;
    }

    // Exact title match
    if (note.title.toLowerCase() === searchTerm) {
      score += 20;
    }

    // Content match
    if (note.content.toLowerCase().includes(searchTerm)) {
      score += 5;
    }

    // Tag match
    for (const tag of note.tags) {
      if (tag.toLowerCase().includes(searchTerm)) {
        score += 7;
      }
      if (tag.toLowerCase() === searchTerm) {
        score += 15;
      }
    }

    // Project scope boost
    if (note.scope === 'project') {
      score += 2;
    }

    return score;
  }

  /**
   * Initialize project knowledge base
   */
  initializeProjectKB(): string {
    if (!this.currentProjectInfo) {
      throw new Error('No project detected');
    }

    const kbDir = path.join(this.currentProjectInfo.path, '.llm-memory');
    this.projectStore = new KnowledgeStore(kbDir);

    // Create .gitignore if it doesn't exist
    const fs = require('fs');
    const gitignorePath = path.join(kbDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '# Nothing to ignore - include all knowledge base files\n');
    }

    this.currentProjectInfo.hasKnowledgeBase = true;

    return kbDir;
  }

  /**
   * Get project information
   */
  getProjectInfo(): ProjectInfo | null {
    return this.currentProjectInfo;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    global: any;
    project: any;
    total: {
      notes: number;
      types: Record<NoteType, number>;
    };
  }> {
    const globalStats = await this.globalStore.getStats();
    let projectStats = null;

    if (this.projectStore) {
      projectStats = await this.projectStore.getStats();
    }

    // Combine totals
    const totalNotes = globalStats.totalNotes + (projectStats?.totalNotes || 0);
    const totalTypes: Record<NoteType, number> = { ...globalStats.notesByType };

    if (projectStats) {
      for (const [type, count] of Object.entries(projectStats.notesByType)) {
        totalTypes[type as NoteType] += count;
      }
    }

    return {
      global: globalStats,
      project: projectStats,
      total: {
        notes: totalNotes,
        types: totalTypes
      }
    };
  }
}
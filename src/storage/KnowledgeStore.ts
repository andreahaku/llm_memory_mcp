import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { readdir } from 'fs/promises';
import * as path from 'path';
import { ulid } from '../utils/ULID.js';
import type { Note, NoteType, Scope, SearchQuery, SearchResult } from '../types/KnowledgeBase.js';

export class KnowledgeStore {
  private directory: string;

  constructor(directory: string) {
    this.directory = directory;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true });
    }
  }

  private getNotePath(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  private getIndexPath(): string {
    return path.join(this.directory, 'index.json');
  }

  /**
   * Create a new note
   */
  async create(
    type: NoteType,
    title: string,
    content: string,
    options: {
      tags?: string[];
      scope?: Scope;
      metadata?: { language?: string; file?: string };
    } = {}
  ): Promise<string> {
    const id = ulid();
    const now = new Date().toISOString();

    const note: Note = {
      id,
      type,
      title,
      content,
      tags: options.tags || [],
      scope: options.scope || 'project',
      metadata: {
        language: options.metadata?.language,
        file: options.metadata?.file,
        createdAt: now,
        updatedAt: now,
        createdBy: 'llm-memory-mcp'
      }
    };

    // Write note file
    const notePath = this.getNotePath(id);
    writeFileSync(notePath, JSON.stringify(note, null, 2));

    // Update index
    await this.updateIndex();

    return id;
  }

  /**
   * Read a note by ID
   */
  async read(id: string): Promise<Note | null> {
    const notePath = this.getNotePath(id);

    if (!existsSync(notePath)) {
      return null;
    }

    try {
      const data = readFileSync(notePath, 'utf8');
      return JSON.parse(data) as Note;
    } catch (error) {
      console.error(`Error reading note ${id}:`, error);
      return null;
    }
  }

  /**
   * Update an existing note
   */
  async update(
    id: string,
    updates: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'type' | 'metadata'>>
  ): Promise<boolean> {
    const note = await this.read(id);
    if (!note) {
      return false;
    }

    const updatedNote: Note = {
      ...note,
      ...updates,
      metadata: {
        ...note.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString()
      }
    };

    const notePath = this.getNotePath(id);
    writeFileSync(notePath, JSON.stringify(updatedNote, null, 2));

    // Update index
    await this.updateIndex();

    return true;
  }

  /**
   * Delete a note
   */
  async delete(id: string): Promise<boolean> {
    const notePath = this.getNotePath(id);

    if (!existsSync(notePath)) {
      return false;
    }

    try {
      const fs = await import('fs/promises');
      await fs.unlink(notePath);

      // Update index
      await this.updateIndex();

      return true;
    } catch (error) {
      console.error(`Error deleting note ${id}:`, error);
      return false;
    }
  }

  /**
   * List all notes
   */
  async list(): Promise<Note[]> {
    try {
      const files = await readdir(this.directory);
      const noteFiles = files.filter(file => file.endsWith('.json') && file !== 'index.json');

      const notes: Note[] = [];
      for (const file of noteFiles) {
        const id = file.replace('.json', '');
        const note = await this.read(id);
        if (note) {
          notes.push(note);
        }
      }

      return notes.sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt));
    } catch (error) {
      console.error('Error listing notes:', error);
      return [];
    }
  }

  /**
   * Search notes
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const allNotes = await this.list();
    let filteredNotes = allNotes;

    // Apply scope filter
    if (query.scope && query.scope !== 'all') {
      filteredNotes = filteredNotes.filter(note => note.scope === query.scope);
    }

    // Apply type filter
    if (query.type && query.type.length > 0) {
      filteredNotes = filteredNotes.filter(note => query.type!.includes(note.type));
    }

    // Apply tags filter
    if (query.tags && query.tags.length > 0) {
      filteredNotes = filteredNotes.filter(note =>
        query.tags!.some(tag => note.tags.includes(tag))
      );
    }

    // Apply text search
    if (query.q) {
      const searchTerm = query.q.toLowerCase();
      filteredNotes = filteredNotes.filter(note =>
        note.title.toLowerCase().includes(searchTerm) ||
        note.content.toLowerCase().includes(searchTerm) ||
        note.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      );
    }

    // Apply limit
    const limit = query.limit || 50;
    const limitedNotes = filteredNotes.slice(0, limit);

    return {
      notes: limitedNotes,
      total: filteredNotes.length,
      query
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalNotes: number;
    notesByType: Record<NoteType, number>;
    notesByScope: Record<Scope, number>;
    lastUpdated: string;
  }> {
    const notes = await this.list();

    const notesByType: Record<NoteType, number> = {
      note: 0,
      snippet: 0,
      pattern: 0,
      config: 0,
      fact: 0,
      insight: 0
    };

    const notesByScope: Record<Scope, number> = {
      global: 0,
      project: 0
    };

    let lastUpdated = '';

    for (const note of notes) {
      notesByType[note.type]++;
      notesByScope[note.scope]++;

      if (note.metadata.updatedAt > lastUpdated) {
        lastUpdated = note.metadata.updatedAt;
      }
    }

    return {
      totalNotes: notes.length,
      notesByType,
      notesByScope,
      lastUpdated: lastUpdated || new Date().toISOString()
    };
  }

  /**
   * Update search index
   */
  private async updateIndex(): Promise<void> {
    try {
      const notes = await this.list();
      const index = {
        lastUpdated: new Date().toISOString(),
        totalNotes: notes.length,
        notes: notes.map(note => ({
          id: note.id,
          type: note.type,
          title: note.title,
          tags: note.tags,
          scope: note.scope,
          updatedAt: note.metadata.updatedAt
        }))
      };

      const indexPath = this.getIndexPath();
      writeFileSync(indexPath, JSON.stringify(index, null, 2));
    } catch (error) {
      console.error('Error updating index:', error);
    }
  }
}
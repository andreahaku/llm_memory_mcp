/**
 * @deprecated Legacy types maintained for backward compatibility only.
 * Use types from '../types/Memory.ts' instead:
 * - Note → MemoryItem
 * - NoteType → MemoryType
 * - Scope → MemoryScope
 * - SearchQuery → MemoryQuery
 * - SearchResult → MemorySearchResult
 * - ProjectInfo → ProjectInfo (same name, see Memory.ts)
 *
 * All new code should use the modern Memory types.
 */

export type NoteType = 'note' | 'snippet' | 'pattern' | 'config' | 'fact' | 'insight';

export type Scope = 'global' | 'project';

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  content: string;
  tags: string[];
  scope: Scope;
  metadata: {
    language?: string;
    file?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };
}

export interface SearchQuery {
  q?: string;
  type?: NoteType[];
  tags?: string[];
  scope?: Scope | 'all';
  limit?: number;
}

export interface SearchResult {
  notes: Note[];
  total: number;
  query: SearchQuery;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  hasKnowledgeBase: boolean;
}
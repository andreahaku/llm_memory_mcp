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
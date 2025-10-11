// Frontmatter parser for markdown memory files
// Handles YAML frontmatter parsing and serialization

import * as yaml from 'js-yaml';
import type { MemoryItem, MemoryType, MemoryScope } from '../types/Memory.js';

export interface FrontmatterData {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  title: string;
  language?: string;
  tags?: string[];
  confidence?: number;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  // Additional optional fields for Obsidian compatibility
  aliases?: string[];
}

/**
 * Parse YAML frontmatter from markdown content
 * @param content - Full markdown content with frontmatter
 * @returns Parsed frontmatter data and remaining body
 */
export function parseFrontmatter(content: string): {
  frontmatter: Partial<FrontmatterData>;
  body: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // No frontmatter found
    return {
      frontmatter: {},
      body: content,
    };
  }

  const [, frontmatterStr, body] = match;

  try {
    const frontmatter = yaml.load(frontmatterStr) as Partial<FrontmatterData>;
    return {
      frontmatter: normalizeFrontmatter(frontmatter),
      body: body.trim(),
    };
  } catch (error) {
    throw new Error(`Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Serialize frontmatter data to YAML string
 * @param data - Frontmatter data object
 * @returns YAML string with delimiters
 */
export function serializeFrontmatter(data: Partial<FrontmatterData>): string {
  try {
    const yamlStr = yaml.dump(data, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true, // No anchors/aliases
      sortKeys: false, // Preserve order
    });
    return `---\n${yamlStr}---\n`;
  } catch (error) {
    throw new Error(`Failed to serialize frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract frontmatter from MemoryItem
 * @param item - Memory item to extract from
 * @returns Frontmatter data object
 */
export function extractFrontmatterFromItem(item: MemoryItem): FrontmatterData {
  return {
    id: item.id,
    type: item.type,
    scope: item.scope,
    title: item.title || '',
    language: item.language,
    tags: item.facets?.tags || [],
    confidence: item.quality?.confidence,
    pinned: item.quality?.pinned || false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version || 1,
  };
}

/**
 * Normalize frontmatter data (coerce types, set defaults)
 * @param data - Raw frontmatter data
 * @returns Normalized frontmatter data
 */
function normalizeFrontmatter(data: any): Partial<FrontmatterData> {
  const normalized: Partial<FrontmatterData> = {};

  // Required fields
  if (data.id) normalized.id = String(data.id);
  if (data.type) normalized.type = data.type as MemoryType;
  if (data.scope) normalized.scope = data.scope as MemoryScope;
  if (data.title) normalized.title = String(data.title);

  // Optional fields with type coercion
  if (data.language) normalized.language = String(data.language);
  if (Array.isArray(data.tags)) {
    normalized.tags = data.tags.map((t: any) => String(t));
  }
  if (typeof data.confidence === 'number') {
    normalized.confidence = Math.max(0, Math.min(1, data.confidence));
  }
  if (typeof data.pinned === 'boolean') {
    normalized.pinned = data.pinned;
  }

  // Timestamps
  if (data.createdAt) normalized.createdAt = String(data.createdAt);
  if (data.updatedAt) normalized.updatedAt = String(data.updatedAt);

  // Version
  if (typeof data.version === 'number') {
    normalized.version = Math.max(1, Math.floor(data.version));
  }

  // Obsidian compatibility
  if (Array.isArray(data.aliases)) {
    normalized.aliases = data.aliases.map((a: any) => String(a));
  }

  return normalized;
}

/**
 * Validate required frontmatter fields
 * @param frontmatter - Frontmatter data to validate
 * @throws Error if required fields are missing
 */
export function validateFrontmatter(frontmatter: Partial<FrontmatterData>): void {
  const requiredFields: (keyof FrontmatterData)[] = ['id', 'type', 'scope', 'title'];

  const missing = requiredFields.filter((field) => !frontmatter[field]);

  if (missing.length > 0) {
    throw new Error(`Missing required frontmatter fields: ${missing.join(', ')}`);
  }
}

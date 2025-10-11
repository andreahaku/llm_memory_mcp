// Markdown converter for MemoryItem ↔ Markdown transformation
// Handles conversion between MemoryItem objects and markdown files with frontmatter

import type { MemoryItem, MemoryType, MemoryScope } from '../types/Memory.js';
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractFrontmatterFromItem,
  validateFrontmatter,
  type FrontmatterData,
} from './FrontmatterParser.js';

/**
 * Generate filename for memory item
 * Format: <id>-<slug>.md
 * @param item - Memory item
 * @returns Filename string
 */
export function generateFilename(item: MemoryItem): string {
  const slug = slugify(item.title || item.type);
  return `${item.id}-${slug}.md`;
}

/**
 * Convert title to URL-safe slug
 * @param text - Text to slugify
 * @returns Slug string
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
    .replace(/^-+|-+$/g, '')      // Remove leading/trailing dashes
    .slice(0, 50);                 // Limit length
}

/**
 * Convert MemoryItem to Markdown string
 * @param item - Memory item to convert
 * @returns Markdown string with frontmatter
 */
export function itemToMarkdown(item: MemoryItem): string {
  const sections: string[] = [];

  // 1. Frontmatter
  const frontmatter = extractFrontmatterFromItem(item);
  sections.push(serializeFrontmatter(frontmatter));

  // 2. Title (as H1 if not in frontmatter or for emphasis)
  if (item.title) {
    sections.push(`# ${item.title}\n`);
  }

  // 3. Description/Text content
  if (item.text) {
    sections.push(item.text.trim() + '\n');
  }

  // 4. Code block (if present)
  if (item.code) {
    const lang = item.language || '';
    sections.push(`## Code\n\n\`\`\`${lang}\n${item.code.trim()}\n\`\`\`\n`);
  }

  // 5. Context section
  const contextSection = generateContextSection(item);
  if (contextSection) {
    sections.push(contextSection);
  }

  // 6. Related memories section (placeholder for Phase 2 - wikilinks)
  // Will be populated when WikilinkResolver is implemented
  sections.push('## Related Memories\n\n<!-- Wikilinks will be added in Phase 2 -->\n');

  // 7. Backlinks section (placeholder for Phase 2)
  // This section is auto-generated and not source-of-truth
  sections.push('## Backlinks\n\n<!-- Auto-generated backlinks will be added in Phase 2 -->\n');

  return sections.join('\n');
}

/**
 * Generate context section from MemoryItem.context
 * @param item - Memory item
 * @returns Context section markdown or empty string
 */
function generateContextSection(item: MemoryItem): string {
  const context = item.context;
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  const lines: string[] = ['## Context\n'];

  if (context.repoId) lines.push(`- **Repository**: ${context.repoId}`);
  if (context.branch) lines.push(`- **Branch**: ${context.branch}`);
  if (context.commit) lines.push(`- **Commit**: ${context.commit}`);
  if (context.file) {
    let fileLine = `- **File**: ${context.file}`;
    if (context.range) {
      fileLine += ` (lines ${context.range.start}-${context.range.end})`;
    }
    lines.push(fileLine);
  }
  if (context.function) lines.push(`- **Function**: ${context.function}`);
  if (context.tool) lines.push(`- **Tool**: ${context.tool}`);
  if (context.source) lines.push(`- **Source**: ${context.source}`);
  if (context.package) lines.push(`- **Package**: ${context.package}`);
  if (context.framework) lines.push(`- **Framework**: ${context.framework}`);

  return lines.join('\n') + '\n';
}

/**
 * Parse markdown string to MemoryItem
 * @param markdown - Markdown content with frontmatter
 * @param id - Optional ID override (for reading existing files)
 * @returns Parsed MemoryItem
 */
export function markdownToItem(markdown: string, id?: string): MemoryItem {
  const { frontmatter, body } = parseFrontmatter(markdown);

  // Validate required fields
  validateFrontmatter(frontmatter);

  // Extract sections from body
  const sections = parseBodySections(body);

  // Build MemoryItem
  const item: MemoryItem = {
    id: id || frontmatter.id!,
    type: frontmatter.type as MemoryType,
    scope: frontmatter.scope as MemoryScope,
    title: frontmatter.title,
    text: sections.description,
    code: sections.code,
    language: frontmatter.language || sections.codeLanguage,
    facets: {
      tags: frontmatter.tags || [],
      files: [], // Will be populated from context or facets in body
      symbols: [], // Will be populated from context or facets in body
    },
    context: sections.context || {},
    quality: {
      confidence: frontmatter.confidence || 0.5,
      reuseCount: 0,
      pinned: frontmatter.pinned || false,
    },
    security: {
      sensitivity: 'public', // Default, can be overridden
    },
    links: [], // Will be populated in Phase 2 from wikilinks
    createdAt: frontmatter.createdAt || new Date().toISOString(),
    updatedAt: frontmatter.updatedAt || new Date().toISOString(),
    version: frontmatter.version || 1,
  };

  return item;
}

/**
 * Parse body sections from markdown content
 * @param body - Markdown body without frontmatter
 * @returns Parsed sections
 */
interface BodySections {
  description: string;
  code?: string;
  codeLanguage?: string;
  context?: any;
  relatedMemories?: string[];
  backlinks?: string[];
}

function parseBodySections(body: string): BodySections {
  const sections: BodySections = {
    description: '',
  };

  // Split by headers
  const headerRegex = /^## (.+)$/gm;
  const parts: Array<{ title: string; content: string }> = [];
  let lastIndex = 0;
  let match;

  // Extract all sections
  while ((match = headerRegex.exec(body)) !== null) {
    if (lastIndex < match.index) {
      // Content before first header is description
      const content = body.slice(lastIndex, match.index).trim();
      if (content && parts.length === 0) {
        sections.description = content;
      }
    }
    lastIndex = match.index + match[0].length;
  }

  // Get content after last header
  if (lastIndex < body.length) {
    const remainingContent = body.slice(lastIndex).trim();
    // Find next header or end of content
    const nextHeaderMatch = body.slice(lastIndex).match(headerRegex);
    const sectionContent = nextHeaderMatch
      ? body.slice(lastIndex, lastIndex + nextHeaderMatch.index!).trim()
      : remainingContent;

    if (parts.length === 0 && !sections.description) {
      sections.description = sectionContent;
    }
  }

  // Parse sections
  const sectionMatches = Array.from(body.matchAll(/^## (.+?)\n([\s\S]*?)(?=\n## |$)/gm));

  for (const [, title, content] of sectionMatches) {
    const trimmedTitle = title.trim().toLowerCase();
    const trimmedContent = content.trim();

    if (trimmedTitle === 'code') {
      // Extract code block
      const codeBlockMatch = trimmedContent.match(/```(\w*)\n([\s\S]*?)```/);
      if (codeBlockMatch) {
        sections.codeLanguage = codeBlockMatch[1] || undefined;
        sections.code = codeBlockMatch[2].trim();
      }
    } else if (trimmedTitle === 'context') {
      // Parse context section
      sections.context = parseContextSection(trimmedContent);
    } else if (trimmedTitle === 'related memories') {
      // Will be implemented in Phase 2 with wikilink parsing
      sections.relatedMemories = [];
    } else if (trimmedTitle === 'backlinks') {
      // Ignore backlinks section (auto-generated, not source of truth)
      sections.backlinks = [];
    }
  }

  // If no description extracted yet, use content before first header
  if (!sections.description) {
    const firstHeaderIndex = body.search(/^## /m);
    if (firstHeaderIndex > 0) {
      sections.description = body.slice(0, firstHeaderIndex).trim();
    } else if (!sections.code) {
      // No headers at all, entire body is description
      sections.description = body.trim();
    }
  }

  return sections;
}

/**
 * Parse context section from markdown
 * @param content - Context section content
 * @returns Parsed context object
 */
function parseContextSection(content: string): any {
  const context: any = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^-\s*\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      const normalizedKey = key.toLowerCase();

      switch (normalizedKey) {
        case 'repository':
          context.repoId = value.trim();
          break;
        case 'branch':
          context.branch = value.trim();
          break;
        case 'commit':
          context.commit = value.trim();
          break;
        case 'file':
          // Check for line range in format: path/to/file.ts (lines 10-20)
          const fileMatch = value.match(/^(.+?)\s*(?:\(lines?\s+(\d+)-(\d+)\))?$/);
          if (fileMatch) {
            context.file = fileMatch[1].trim();
            if (fileMatch[2] && fileMatch[3]) {
              context.range = {
                start: parseInt(fileMatch[2], 10),
                end: parseInt(fileMatch[3], 10),
              };
            }
          }
          break;
        case 'function':
          context.function = value.trim();
          break;
        case 'tool':
          context.tool = value.trim();
          break;
        case 'source':
          context.source = value.trim();
          break;
        case 'package':
          context.package = value.trim();
          break;
        case 'framework':
          context.framework = value.trim();
          break;
      }
    }
  }

  return context;
}

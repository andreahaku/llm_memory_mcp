import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { VideoStorageAdapter } from '../src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from '../src/storage/FileStorageAdapter.js';
import type { MemoryItem, MemoryScope, MemoryItemSummary } from '../src/types/Memory.js';
import { ulid } from '../src/util/ulid.js';

/**
 * Search Functionality Parity Validation Test Suite
 *
 * This test suite validates that search operations return identical results
 * between VideoStorageAdapter and FileStorageAdapter implementations.
 */

interface SearchTestContext {
  videoAdapter: VideoStorageAdapter;
  fileAdapter: FileStorageAdapter;
  videoDir: string;
  fileDir: string;
  searchTestItems: MemoryItem[];
}

describe('Search Functionality Parity Validation', () => {
  let context: SearchTestContext;

  beforeEach(async () => {
    // Setup test directories
    const baseDir = path.join(process.cwd(), 'test-temp', `search-test-${Date.now()}`);
    const videoDir = path.join(baseDir, 'video');
    const fileDir = path.join(baseDir, 'file');

    await fs.ensureDir(videoDir);
    await fs.ensureDir(fileDir);

    // Initialize adapters
    const videoAdapter = new VideoStorageAdapter(videoDir, 'local' as MemoryScope);
    const fileAdapter = new FileStorageAdapter(fileDir);

    // Generate search-optimized test data
    const searchTestItems = generateSearchTestItems();

    context = {
      videoAdapter,
      fileAdapter,
      videoDir,
      fileDir,
      searchTestItems
    };

    // Populate both adapters with test data
    await context.videoAdapter.writeBatch(context.searchTestItems);
    await context.fileAdapter.writeBatch(context.searchTestItems);

    // Wait for video processing
    await waitForVideoProcessing(context.videoAdapter);
  });

  afterEach(async () => {
    try {
      if (context?.videoDir && await fs.pathExists(context.videoDir)) {
        await fs.remove(path.dirname(context.videoDir));
      }
    } catch (error) {
      console.warn('Search test cleanup warning:', error);
    }
  });

  describe('Catalog-Based Search Parity', () => {
    it('should return identical catalog structures', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      // Should have same number of items
      expect(Object.keys(videoCatalog).length).toBe(Object.keys(fileCatalog).length);
      expect(Object.keys(videoCatalog).length).toBe(context.searchTestItems.length);

      // Compare each catalog entry
      for (const [id, videoSummary] of Object.entries(videoCatalog)) {
        const fileSummary = fileCatalog[id];
        expect(fileSummary).toBeTruthy();

        // Normalize summaries for comparison (excluding video-specific fields)
        const normalizedVideo = normalizeSearchSummary(videoSummary);
        const normalizedFile = normalizeSearchSummary(fileSummary);

        expect(normalizedVideo).toEqual(normalizedFile);
      }
    });

    it('should support identical tag-based filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      // Test various tag filters
      const tagFilters = ['javascript', 'typescript', 'algorithm', 'database', 'api'];

      for (const tag of tagFilters) {
        const videoMatches = Object.entries(videoCatalog)
          .filter(([_, summary]) => summary.tags?.includes(tag))
          .map(([id, _]) => id)
          .sort();

        const fileMatches = Object.entries(fileCatalog)
          .filter(([_, summary]) => summary.tags?.includes(tag))
          .map(([id, _]) => id)
          .sort();

        expect(videoMatches).toEqual(fileMatches);
        expect(videoMatches.length).toBeGreaterThan(0); // Ensure test data has items with these tags
      }
    });

    it('should support identical file-based filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      // Test various file pattern filters
      const fileFilters = ['.js', '.ts', '.py', '.sql', 'utils'];

      for (const filePattern of fileFilters) {
        const videoMatches = Object.entries(videoCatalog)
          .filter(([_, summary]) =>
            summary.files?.some(file => file.includes(filePattern))
          )
          .map(([id, _]) => id)
          .sort();

        const fileMatches = Object.entries(fileCatalog)
          .filter(([_, summary]) =>
            summary.files?.some(file => file.includes(filePattern))
          )
          .map(([id, _]) => id)
          .sort();

        expect(videoMatches).toEqual(fileMatches);
      }
    });

    it('should support identical symbol-based filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      // Test various symbol filters
      const symbolFilters = ['function', 'class', 'interface', 'const', 'async'];

      for (const symbolPattern of symbolFilters) {
        const videoMatches = Object.entries(videoCatalog)
          .filter(([_, summary]) =>
            summary.symbols?.some(symbol => symbol.includes(symbolPattern))
          )
          .map(([id, _]) => id)
          .sort();

        const fileMatches = Object.entries(fileCatalog)
          .filter(([_, summary]) =>
            summary.symbols?.some(symbol => symbol.includes(symbolPattern))
          )
          .map(([id, _]) => id)
          .sort();

        expect(videoMatches).toEqual(fileMatches);
      }
    });

    it('should support identical type-based filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      const types = ['snippet', 'pattern', 'insight', 'fact', 'note'];

      for (const type of types) {
        const videoMatches = Object.entries(videoCatalog)
          .filter(([_, summary]) => summary.type === type)
          .map(([id, _]) => id)
          .sort();

        const fileMatches = Object.entries(fileCatalog)
          .filter(([_, summary]) => summary.type === type)
          .map(([id, _]) => id)
          .sort();

        expect(videoMatches).toEqual(fileMatches);
        expect(videoMatches.length).toBeGreaterThan(0);
      }
    });

    it('should support identical confidence-based filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      const confidenceThresholds = [0.3, 0.5, 0.7, 0.9];

      for (const threshold of confidenceThresholds) {
        const videoMatches = Object.entries(videoCatalog)
          .filter(([_, summary]) => summary.confidence >= threshold)
          .map(([id, _]) => id)
          .sort();

        const fileMatches = Object.entries(fileCatalog)
          .filter(([_, summary]) => summary.confidence >= threshold)
          .map(([id, _]) => id)
          .sort();

        expect(videoMatches).toEqual(fileMatches);
      }
    });

    it('should support identical pinned item filtering', async () => {
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      const videoPinned = Object.entries(videoCatalog)
        .filter(([_, summary]) => summary.pinned === true)
        .map(([id, _]) => id)
        .sort();

      const filePinned = Object.entries(fileCatalog)
        .filter(([_, summary]) => summary.pinned === true)
        .map(([id, _]) => id)
        .sort();

      expect(videoPinned).toEqual(filePinned);
      expect(videoPinned.length).toBeGreaterThan(0); // Ensure we have pinned items
    });
  });

  describe('Content-Based Search Parity', () => {
    it('should find identical items by title search', async () => {
      const searchTerms = ['Algorithm', 'Database', 'API', 'React', 'Node.js'];

      for (const term of searchTerms) {
        const videoResults = await searchItemsByTitle(context.videoAdapter, term);
        const fileResults = await searchItemsByTitle(context.fileAdapter, term);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
        expect(videoResults.length).toBeGreaterThan(0);
      }
    });

    it('should find identical items by text content search', async () => {
      const searchTerms = ['optimization', 'implementation', 'performance', 'database query', 'error handling'];

      for (const term of searchTerms) {
        const videoResults = await searchItemsByText(context.videoAdapter, term);
        const fileResults = await searchItemsByText(context.fileAdapter, term);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });

    it('should find identical items by code content search', async () => {
      const codeSearchTerms = ['async function', 'Promise', 'try catch', 'interface', 'class'];

      for (const term of codeSearchTerms) {
        const videoResults = await searchItemsByCode(context.videoAdapter, term);
        const fileResults = await searchItemsByCode(context.fileAdapter, term);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });

    it('should support identical combined search criteria', async () => {
      // Test complex search scenarios
      const searchScenarios = [
        {
          titlePattern: 'Algorithm',
          tags: ['javascript'],
          minConfidence: 0.7
        },
        {
          textPattern: 'database',
          type: 'snippet',
          pinned: true
        },
        {
          codePattern: 'async',
          filePattern: '.ts',
          symbols: ['function']
        }
      ];

      for (const scenario of searchScenarios) {
        const videoResults = await performComplexSearch(context.videoAdapter, scenario);
        const fileResults = await performComplexSearch(context.fileAdapter, scenario);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });
  });

  describe('Advanced Search Features Parity', () => {
    it('should support identical fuzzy search results', async () => {
      // Test fuzzy matching for common typos and variations
      const fuzzyTerms = [
        { exact: 'algorithm', fuzzy: 'algoritm' },
        { exact: 'database', fuzzy: 'databse' },
        { exact: 'function', fuzzy: 'funciton' }
      ];

      for (const { exact, fuzzy } of fuzzyTerms) {
        const videoExact = await searchItemsByTitle(context.videoAdapter, exact);
        const videoFuzzy = await searchItemsByTitle(context.videoAdapter, fuzzy, { fuzzy: true });

        const fileExact = await searchItemsByTitle(context.fileAdapter, exact);
        const fileFuzzy = await searchItemsByTitle(context.fileAdapter, fuzzy, { fuzzy: true });

        // Fuzzy search should return at least the exact matches
        expect(videoFuzzy.length).toBeGreaterThanOrEqual(videoExact.length);
        expect(fileFuzzy.length).toBeGreaterThanOrEqual(fileExact.length);

        // Results should be identical between adapters
        expect(normalizeSearchResults(videoFuzzy)).toEqual(normalizeSearchResults(fileFuzzy));
      }
    });

    it('should support identical search result ranking', async () => {
      const searchTerm = 'function';

      const videoResults = await searchItemsRanked(context.videoAdapter, searchTerm);
      const fileResults = await searchItemsRanked(context.fileAdapter, searchTerm);

      // Results should be in same order (same ranking)
      expect(videoResults.map(r => r.id)).toEqual(fileResults.map(r => r.id));

      // Confidence scores should be identical
      for (let i = 0; i < videoResults.length; i++) {
        expect(videoResults[i].confidence).toBeCloseTo(fileResults[i].confidence, 2);
      }
    });

    it('should support identical date range filtering', async () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const dateRanges = [
        { start: oneWeekAgo, end: now },
        { start: oneMonthAgo, end: oneWeekAgo },
        { start: oneMonthAgo, end: now }
      ];

      for (const range of dateRanges) {
        const videoResults = await searchItemsByDateRange(context.videoAdapter, range.start, range.end);
        const fileResults = await searchItemsByDateRange(context.fileAdapter, range.start, range.end);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });

    it('should support identical pagination', async () => {
      const searchTerm = 'test';
      const pageSize = 5;

      // Get total results
      const allVideoResults = await searchItemsByTitle(context.videoAdapter, searchTerm);
      const allFileResults = await searchItemsByTitle(context.fileAdapter, searchTerm);

      expect(allVideoResults.length).toBe(allFileResults.length);

      // Test pagination consistency
      const totalPages = Math.ceil(allVideoResults.length / pageSize);

      for (let page = 0; page < totalPages; page++) {
        const videoPage = await searchItemsPaginated(context.videoAdapter, searchTerm, page, pageSize);
        const filePage = await searchItemsPaginated(context.fileAdapter, searchTerm, page, pageSize);

        expect(normalizeSearchResults(videoPage)).toEqual(normalizeSearchResults(filePage));
      }
    });
  });

  describe('Search Performance Parity', () => {
    it('should have comparable search performance', async () => {
      const searchTerm = 'function';
      const iterations = 10;

      // Measure video search performance
      const videoTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await searchItemsByTitle(context.videoAdapter, searchTerm);
        videoTimes.push(performance.now() - start);
      }

      // Measure file search performance
      const fileTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await searchItemsByTitle(context.fileAdapter, searchTerm);
        fileTimes.push(performance.now() - start);
      }

      const videoAvg = videoTimes.reduce((a, b) => a + b) / videoTimes.length;
      const fileAvg = fileTimes.reduce((a, b) => a + b) / fileTimes.length;

      // Performance should be within reasonable bounds (video might be slower due to decoding)
      // But should not be more than 10x slower
      expect(videoAvg).toBeLessThan(fileAvg * 10);

      console.log(`Search performance - Video: ${videoAvg.toFixed(2)}ms, File: ${fileAvg.toFixed(2)}ms`);
    });

    it('should handle large result sets efficiently', async () => {
      // Search for a term that should match many items
      const broadSearchTerm = 'test';

      const videoStart = performance.now();
      const videoResults = await searchItemsByText(context.videoAdapter, broadSearchTerm);
      const videoTime = performance.now() - videoStart;

      const fileStart = performance.now();
      const fileResults = await searchItemsByText(context.fileAdapter, broadSearchTerm);
      const fileTime = performance.now() - fileStart;

      // Results should be identical
      expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));

      // Should handle large result sets within reasonable time (< 5 seconds)
      expect(videoTime).toBeLessThan(5000);
      expect(fileTime).toBeLessThan(5000);

      console.log(`Large result set - Video: ${videoTime.toFixed(2)}ms (${videoResults.length} results), File: ${fileTime.toFixed(2)}ms (${fileResults.length} results)`);
    });
  });

  describe('Search Edge Cases', () => {
    it('should handle empty search results consistently', async () => {
      const nonExistentTerm = 'xyznonexistentterm123';

      const videoResults = await searchItemsByTitle(context.videoAdapter, nonExistentTerm);
      const fileResults = await searchItemsByTitle(context.fileAdapter, nonExistentTerm);

      expect(videoResults).toEqual([]);
      expect(fileResults).toEqual([]);
    });

    it('should handle special characters in search consistently', async () => {
      const specialCharSearches = ['!@#$%', '()', '[]', '{}', '&&', '||', '"quotes"', "'single'"];

      for (const term of specialCharSearches) {
        const videoResults = await searchItemsByText(context.videoAdapter, term);
        const fileResults = await searchItemsByText(context.fileAdapter, term);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });

    it('should handle unicode search consistently', async () => {
      const unicodeTerms = ['测试', '🚀', 'café', 'naïve', 'résumé'];

      for (const term of unicodeTerms) {
        const videoResults = await searchItemsByText(context.videoAdapter, term);
        const fileResults = await searchItemsByText(context.fileAdapter, term);

        expect(normalizeSearchResults(videoResults)).toEqual(normalizeSearchResults(fileResults));
      }
    });

    it('should handle very long search terms consistently', async () => {
      const longTerm = 'a'.repeat(1000);

      const videoResults = await searchItemsByText(context.videoAdapter, longTerm);
      const fileResults = await searchItemsByText(context.fileAdapter, longTerm);

      expect(videoResults).toEqual([]);
      expect(fileResults).toEqual([]);
    });
  });
});

// Search utility functions

async function searchItemsByTitle(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  term: string,
  options: { fuzzy?: boolean } = {}
): Promise<MemoryItem[]> {
  const catalog = adapter.readCatalog();
  const matchingIds: string[] = [];

  for (const [id, summary] of Object.entries(catalog)) {
    const titleMatch = options.fuzzy
      ? fuzzyMatch(summary.title.toLowerCase(), term.toLowerCase())
      : summary.title.toLowerCase().includes(term.toLowerCase());

    if (titleMatch) {
      matchingIds.push(id);
    }
  }

  return await adapter.readItems(matchingIds);
}

async function searchItemsByText(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  term: string
): Promise<MemoryItem[]> {
  const catalog = adapter.readCatalog();
  const matchingIds: string[] = [];

  // First pass: check if we can determine matches from catalog
  // For full text search, we need to read the actual items
  for (const id of Object.keys(catalog)) {
    const item = await adapter.readItem(id);
    if (item && item.text && item.text.toLowerCase().includes(term.toLowerCase())) {
      matchingIds.push(id);
    }
  }

  return await adapter.readItems(matchingIds);
}

async function searchItemsByCode(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  term: string
): Promise<MemoryItem[]> {
  const catalog = adapter.readCatalog();
  const matchingIds: string[] = [];

  for (const id of Object.keys(catalog)) {
    const item = await adapter.readItem(id);
    if (item && item.code && item.code.toLowerCase().includes(term.toLowerCase())) {
      matchingIds.push(id);
    }
  }

  return await adapter.readItems(matchingIds);
}

async function performComplexSearch(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  criteria: {
    titlePattern?: string;
    textPattern?: string;
    codePattern?: string;
    tags?: string[];
    type?: string;
    filePattern?: string;
    symbols?: string[];
    minConfidence?: number;
    pinned?: boolean;
  }
): Promise<MemoryItem[]> {
  const catalog = adapter.readCatalog();
  const matchingIds: string[] = [];

  for (const [id, summary] of Object.entries(catalog)) {
    let matches = true;

    // Type filter
    if (criteria.type && summary.type !== criteria.type) {
      matches = false;
    }

    // Tags filter
    if (criteria.tags && !criteria.tags.every(tag => summary.tags?.includes(tag))) {
      matches = false;
    }

    // Confidence filter
    if (criteria.minConfidence && summary.confidence < criteria.minConfidence) {
      matches = false;
    }

    // Pinned filter
    if (criteria.pinned !== undefined && summary.pinned !== criteria.pinned) {
      matches = false;
    }

    // File pattern filter
    if (criteria.filePattern && !summary.files?.some(file => file.includes(criteria.filePattern!))) {
      matches = false;
    }

    // Symbols filter
    if (criteria.symbols && !criteria.symbols.every(symbol =>
      summary.symbols?.some(s => s.includes(symbol))
    )) {
      matches = false;
    }

    if (matches) {
      // For content-based filters, we need to read the actual item
      if (criteria.titlePattern || criteria.textPattern || criteria.codePattern) {
        const item = await adapter.readItem(id);
        if (!item) continue;

        if (criteria.titlePattern && !item.title.toLowerCase().includes(criteria.titlePattern.toLowerCase())) {
          continue;
        }

        if (criteria.textPattern && (!item.text || !item.text.toLowerCase().includes(criteria.textPattern.toLowerCase()))) {
          continue;
        }

        if (criteria.codePattern && (!item.code || !item.code.toLowerCase().includes(criteria.codePattern.toLowerCase()))) {
          continue;
        }
      }

      matchingIds.push(id);
    }
  }

  return await adapter.readItems(matchingIds);
}

async function searchItemsRanked(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  term: string
): Promise<Array<MemoryItem & { confidence: number }>> {
  const items = await searchItemsByTitle(adapter, term);

  // Simple ranking based on title match position and item confidence
  return items.map(item => ({
    ...item,
    confidence: calculateSearchRelevance(item, term)
  })).sort((a, b) => b.confidence - a.confidence);
}

async function searchItemsByDateRange(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  startDate: Date,
  endDate: Date
): Promise<MemoryItem[]> {
  const catalog = adapter.readCatalog();
  const matchingIds: string[] = [];

  for (const [id, summary] of Object.entries(catalog)) {
    const createdAt = new Date(summary.createdAt);
    if (createdAt >= startDate && createdAt <= endDate) {
      matchingIds.push(id);
    }
  }

  return await adapter.readItems(matchingIds);
}

async function searchItemsPaginated(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  term: string,
  page: number,
  pageSize: number
): Promise<MemoryItem[]> {
  const allResults = await searchItemsByTitle(adapter, term);
  const start = page * pageSize;
  const end = start + pageSize;

  return allResults.slice(start, end);
}

// Utility functions

function generateSearchTestItems(): MemoryItem[] {
  const items: MemoryItem[] = [];

  // Programming language items
  const languages = ['javascript', 'typescript', 'python', 'java', 'go'];
  languages.forEach((lang, index) => {
    items.push({
      id: ulid(),
      type: 'snippet',
      scope: 'local',
      title: `${lang.charAt(0).toUpperCase() + lang.slice(1)} Algorithm Implementation`,
      text: `This is a comprehensive guide to implementing algorithms in ${lang}. ` +
            `It covers performance optimization, error handling, and best practices.`,
      code: `// ${lang} implementation\n${generateCodeSnippet(lang, index)}`,
      facets: {
        tags: [lang, 'algorithm', 'optimization'],
        files: [`algorithm.${getFileExtension(lang)}`, `utils.${getFileExtension(lang)}`],
        symbols: [`${lang}Algorithm`, `optimize${lang}`, `handle${lang}Error`]
      },
      quality: {
        confidence: 0.8 + (index * 0.02),
        pinned: index % 3 === 0,
        reuseCount: index + 1
      },
      security: { sensitivity: 'public' },
      context: {
        language: lang,
        category: 'algorithm',
        difficulty: 'intermediate'
      },
      links: [],
      createdAt: new Date(Date.now() - index * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - index * 43200000).toISOString(),
      version: 1
    });
  });

  // Database items
  const databases = ['MySQL', 'PostgreSQL', 'MongoDB', 'Redis'];
  databases.forEach((db, index) => {
    items.push({
      id: ulid(),
      type: 'pattern',
      scope: 'local',
      title: `${db} Database Query Optimization`,
      text: `Database query optimization techniques for ${db}. ` +
            `Learn how to improve performance with proper indexing and query structure.`,
      code: generateDatabaseQuery(db, index),
      facets: {
        tags: ['database', db.toLowerCase(), 'optimization', 'performance'],
        files: [`${db.toLowerCase()}_queries.sql`, `${db.toLowerCase()}_config.conf`],
        symbols: [`${db}Query`, `optimize${db}`, `index${db}`]
      },
      quality: {
        confidence: 0.75 + (index * 0.05),
        pinned: index % 2 === 0,
        reuseCount: index * 2
      },
      security: { sensitivity: 'team' },
      context: {
        database: db,
        category: 'database',
        complexity: 'advanced'
      },
      links: [],
      createdAt: new Date(Date.now() - (index + 10) * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - (index + 5) * 43200000).toISOString(),
      version: 1
    });
  });

  // API items
  const apiTypes = ['REST', 'GraphQL', 'gRPC', 'WebSocket'];
  apiTypes.forEach((apiType, index) => {
    items.push({
      id: ulid(),
      type: 'insight',
      scope: 'local',
      title: `${apiType} API Design Best Practices`,
      text: `Best practices for designing ${apiType} APIs. ` +
            `Covers authentication, error handling, versioning, and performance optimization.`,
      code: generateApiExample(apiType, index),
      facets: {
        tags: ['api', apiType.toLowerCase(), 'design', 'best-practices'],
        files: [`${apiType.toLowerCase()}_api.${index % 2 === 0 ? 'js' : 'ts'}`, 'api_docs.md'],
        symbols: [`${apiType}API`, `handle${apiType}Request`, `validate${apiType}`]
      },
      quality: {
        confidence: 0.85 + (index * 0.03),
        pinned: index === 0,
        reuseCount: (index + 1) * 3
      },
      security: { sensitivity: 'public' },
      context: {
        apiType,
        category: 'api',
        maturity: 'production'
      },
      links: [],
      createdAt: new Date(Date.now() - (index + 20) * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - (index + 10) * 43200000).toISOString(),
      version: 1
    });
  });

  // Framework items
  const frameworks = ['React', 'Vue.js', 'Angular', 'Node.js', 'Express'];
  frameworks.forEach((framework, index) => {
    items.push({
      id: ulid(),
      type: 'fact',
      scope: 'local',
      title: `${framework} Testing Strategies`,
      text: `Comprehensive testing strategies for ${framework} applications. ` +
            `Includes unit testing, integration testing, and end-to-end testing approaches.`,
      code: generateTestExample(framework, index),
      facets: {
        tags: ['testing', framework.toLowerCase(), 'unit-test', 'integration-test'],
        files: [`${framework.toLowerCase()}.test.js`, `${framework.toLowerCase()}.spec.ts`],
        symbols: [`test${framework}`, `${framework}TestSuite`, `mock${framework}`]
      },
      quality: {
        confidence: 0.7 + (index * 0.04),
        pinned: false,
        reuseCount: index
      },
      security: { sensitivity: 'private' },
      context: {
        framework,
        category: 'testing',
        coverage: 'comprehensive'
      },
      links: [],
      createdAt: new Date(Date.now() - (index + 30) * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - (index + 15) * 43200000).toISOString(),
      version: 1
    });
  });

  // Add some items with special characters and unicode for edge case testing
  items.push({
    id: ulid(),
    type: 'note',
    scope: 'local',
    title: 'Unicode Testing: 测试 🚀 Café',
    text: 'This item contains unicode characters: 你好世界 🌍 and special symbols: !@#$%^&*()',
    code: '// Unicode comment: 测试代码\nconst café = "naïve résumé";',
    facets: {
      tags: ['unicode', 'testing', '测试'],
      files: ['unicode-测试.js', 'special-chars-!@#.ts'],
      symbols: ['unicode_function', 'test测试', 'special!@#']
    },
    quality: {
      confidence: 0.6,
      pinned: false,
      reuseCount: 0
    },
    security: { sensitivity: 'public' },
    context: {
      category: 'unicode-testing',
      special: '!@#$%^&*()',
      unicode: '你好世界🌍'
    },
    links: [],
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 20 * 43200000).toISOString(),
    version: 1
  });

  return items;
}

function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    java: 'java',
    go: 'go'
  };
  return extensions[language] || 'txt';
}

function generateCodeSnippet(language: string, index: number): string {
  const templates: Record<string, string> = {
    javascript: `function optimizeAlgorithm(data) {\n  return data.filter(item => item.value > ${index}).map(item => item.id);\n}`,
    typescript: `interface Algorithm {\n  data: number[];\n  optimize(): number[];\n}\n\nclass Algorithm${index} implements Algorithm {\n  constructor(public data: number[]) {}\n  optimize(): number[] { return this.data.sort(); }\n}`,
    python: `def optimize_algorithm(data):\n    \"\"\"Optimize algorithm implementation\"\"\"\n    return sorted([x for x in data if x > ${index}])`,
    java: `public class Algorithm${index} {\n    public static List<Integer> optimize(List<Integer> data) {\n        return data.stream().filter(x -> x > ${index}).collect(Collectors.toList());\n    }\n}`,
    go: `func OptimizeAlgorithm(data []int) []int {\n    var result []int\n    for _, v := range data {\n        if v > ${index} {\n            result = append(result, v)\n        }\n    }\n    return result\n}`
  };
  return templates[language] || `// ${language} code example ${index}`;
}

function generateDatabaseQuery(database: string, index: number): string {
  const templates: Record<string, string> = {
    MySQL: `SELECT * FROM users WHERE created_at > DATE_SUB(NOW(), INTERVAL ${index} DAY) ORDER BY id DESC LIMIT 100;`,
    PostgreSQL: `SELECT u.*, p.name as profile_name FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.active = true LIMIT ${index * 10};`,
    MongoDB: `db.users.find({ createdAt: { $gte: new Date(Date.now() - ${index} * 24 * 60 * 60 * 1000) } }).sort({ _id: -1 }).limit(100)`,
    Redis: `HGETALL user:${index}\nSETEX session:${index} 3600 "active"`
  };
  return templates[database] || `-- ${database} query example ${index}`;
}

function generateApiExample(apiType: string, index: number): string {
  const templates: Record<string, string> = {
    REST: `app.get('/api/users/:id', async (req, res) => {\n  try {\n    const user = await User.findById(req.params.id);\n    res.json(user);\n  } catch (error) {\n    res.status(${500 - index}).json({ error: error.message });\n  }\n});`,
    GraphQL: `type User {\n  id: ID!\n  name: String!\n  email: String!\n}\n\ntype Query {\n  user(id: ID!): User\n  users(limit: Int = ${index * 10}): [User!]!\n}`,
    gRPC: `service UserService {\n  rpc GetUser(GetUserRequest) returns (User);\n  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);\n}\n\nmessage User {\n  int32 id = 1;\n  string name = 2;\n}`,
    WebSocket: `const WebSocket = require('ws');\nconst wss = new WebSocket.Server({ port: ${8080 + index} });\n\nwss.on('connection', (ws) => {\n  ws.on('message', (message) => {\n    ws.send('Echo: ' + message);\n  });\n});`
  };
  return templates[apiType] || `// ${apiType} example ${index}`;
}

function generateTestExample(framework: string, index: number): string {
  const templates: Record<string, string> = {
    React: `import { render, screen } from '@testing-library/react';\nimport Component${index} from './Component${index}';\n\ntest('renders component', () => {\n  render(<Component${index} />);\n  expect(screen.getByText('Hello')).toBeInTheDocument();\n});`,
    'Vue.js': `import { mount } from '@vue/test-utils';\nimport Component${index} from './Component${index}.vue';\n\ndescribe('Component${index}', () => {\n  it('renders properly', () => {\n    const wrapper = mount(Component${index});\n    expect(wrapper.text()).toContain('Hello');\n  });\n});`,
    Angular: `import { ComponentFixture, TestBed } from '@angular/core/testing';\nimport { Component${index} } from './component${index}.component';\n\ndescribe('Component${index}', () => {\n  let component: Component${index};\n  beforeEach(() => {\n    TestBed.configureTestingModule({ declarations: [Component${index}] });\n  });\n});`,
    'Node.js': `const request = require('supertest');\nconst app = require('./app');\n\ndescribe('GET /api/test${index}', () => {\n  it('should return 200', async () => {\n    const response = await request(app).get('/api/test${index}');\n    expect(response.status).toBe(200);\n  });\n});`,
    Express: `const express = require('express');\nconst request = require('supertest');\nconst app = express();\n\napp.get('/test${index}', (req, res) => res.json({ message: 'test' }));\n\ndescribe('Express routes', () => {\n  it('should handle GET /test${index}', async () => {\n    await request(app).get('/test${index}').expect(200);\n  });\n});`
  };
  return templates[framework] || `// ${framework} test example ${index}`;
}

function fuzzyMatch(text: string, pattern: string, threshold: number = 0.7): boolean {
  // Simple fuzzy matching based on character overlap
  const textChars = new Set(text.toLowerCase().split(''));
  const patternChars = new Set(pattern.toLowerCase().split(''));

  const intersection = new Set([...textChars].filter(x => patternChars.has(x)));
  const union = new Set([...textChars, ...patternChars]);

  return intersection.size / union.size >= threshold;
}

function calculateSearchRelevance(item: MemoryItem, term: string): number {
  let relevance = item.quality?.confidence || 0.5;

  // Boost if term appears in title
  if (item.title.toLowerCase().includes(term.toLowerCase())) {
    relevance += 0.3;
  }

  // Boost if term appears early in title
  const titleIndex = item.title.toLowerCase().indexOf(term.toLowerCase());
  if (titleIndex === 0) {
    relevance += 0.2;
  } else if (titleIndex > 0 && titleIndex < 10) {
    relevance += 0.1;
  }

  // Boost for pinned items
  if (item.quality?.pinned) {
    relevance += 0.1;
  }

  return Math.min(relevance, 1.0);
}

function normalizeSearchResults(results: MemoryItem[]): MemoryItem[] {
  return results
    .map(item => normalizeItem(item))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeSearchSummary(summary: MemoryItemSummary): any {
  return {
    id: summary.id,
    type: summary.type,
    scope: summary.scope,
    title: summary.title,
    tags: summary.tags?.sort() || [],
    files: summary.files?.sort() || [],
    symbols: summary.symbols?.sort() || [],
    confidence: summary.confidence,
    pinned: summary.pinned,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };
}

function normalizeItem(item: MemoryItem): MemoryItem {
  return {
    ...item,
    facets: {
      tags: item.facets?.tags?.sort() || [],
      files: item.facets?.files?.sort() || [],
      symbols: item.facets?.symbols?.sort() || []
    },
    quality: {
      confidence: item.quality?.confidence ?? 0.5,
      pinned: item.quality?.pinned ?? false,
      reuseCount: item.quality?.reuseCount ?? 0,
      helpfulCount: item.quality?.helpfulCount ?? 0,
      notHelpfulCount: item.quality?.notHelpfulCount ?? 0,
      ...item.quality
    },
    security: item.security || { sensitivity: 'private' },
    context: item.context || {},
    links: item.links || []
  };
}

async function waitForVideoProcessing(adapter: VideoStorageAdapter): Promise<void> {
  const startTime = Date.now();
  const timeout = 60000; // 60 seconds for search tests

  while (Date.now() - startTime < timeout) {
    try {
      const metrics = await (adapter as any).getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
      }
    } catch (error) {
      // If metrics aren't available, wait longer
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.warn('Video processing did not complete within search test timeout');
}
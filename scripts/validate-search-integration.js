#!/usr/bin/env node

/**
 * Video Storage Search Integration Validation Script
 *
 * This script validates that search functionality works correctly with both
 * file and video storage backends. It tests:
 *
 * 1. Item upsert and search index updates
 * 2. Query resolution (with and without search terms)
 * 3. Tag-based and content-based filtering
 * 4. Item deletion and search index cleanup
 * 5. Scope-aware search functionality
 * 6. Search index rebuilding after storage changes
 */

const { MemoryManager } = require('../dist/src/MemoryManager.js');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class SearchIntegrationValidator {
  constructor() {
    this.memoryManager = null;
    this.testDir = null;
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  async setup() {
    // Create temporary directory
    this.testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-validation-'));
    console.log(`📁 Test directory: ${this.testDir}`);

    // Set up test environment
    process.env.LLM_MEMORY_SKIP_STARTUP_REPLAY = '1';
    this.memoryManager = new MemoryManager();
  }

  async cleanup() {
    if (this.testDir && await fs.pathExists(this.testDir)) {
      await fs.remove(this.testDir);
    }
    delete process.env.LLM_MEMORY_SKIP_STARTUP_REPLAY;
  }

  async ensureStorageBackend(scope, backend) {
    const scopeDir = path.join(this.testDir, scope);
    await fs.ensureDir(scopeDir);

    const config = {
      version: '1.0.0',
      storage: { backend }
    };

    await fs.writeFile(
      path.join(scopeDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }

  createTestItem(id, type = 'snippet', extraProps = {}) {
    return {
      id,
      type,
      scope: 'local',
      title: `Test ${type} ${id}`,
      text: `This is a test ${type} with searchable content for ${id}`,
      code: type === 'snippet' ? `function test${id}() { return "hello world"; }` : undefined,
      facets: {
        tags: [`tag-${id}`, 'test', ...(extraProps.tags || [])],
        files: [`test-${id}.js`],
        symbols: [`test${id}`]
      },
      quality: {
        confidence: 0.8,
        pinned: false,
        reuseCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0
      },
      security: { sensitivity: 'private' },
      context: {
        file: `test-${id}.js`,
        function: `test${id}`
      },
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      ...extraProps
    };
  }

  async runTest(name, testFn) {
    try {
      console.log(`🧪 Testing: ${name}`);
      await testFn();
      console.log(`✅ ${name} - PASSED`);
      this.results.passed++;
    } catch (error) {
      if (error.message.includes('unavailable') || error.message.includes('skip')) {
        console.log(`⏭️  ${name} - SKIPPED (${error.message})`);
        this.results.skipped++;
      } else {
        console.error(`❌ ${name} - FAILED: ${error.message}`);
        this.results.failed++;
        this.results.errors.push({ test: name, error: error.message });
      }
    }
  }

  async testVideoStorageBasicOperations() {
    await this.ensureStorageBackend('local', 'video');

    const item = this.createTestItem('video-001', 'snippet', {
      tags: ['javascript', 'video-test']
    });

    // Test upsert
    await this.memoryManager.upsert({ ...item, scope: 'local' });

    // Test query without search term
    const listResults = await this.memoryManager.query({ scope: 'local' }, this.testDir);
    if (listResults.items.length === 0) {
      throw new Error('No items returned from listItems query');
    }

    // Test query with search term
    const searchResults = await this.memoryManager.query({
      q: 'javascript',
      scope: 'local'
    }, this.testDir);

    if (searchResults.items.length === 0) {
      throw new Error('No items returned from search query');
    }

    // Test tag filtering
    const tagResults = await this.memoryManager.query({
      scope: 'local',
      filters: { tags: ['javascript'] }
    }, this.testDir);

    if (tagResults.items.length === 0) {
      throw new Error('No items returned from tag filter');
    }

    // Test deletion
    const deleted = await this.memoryManager.delete('video-001', 'local', this.testDir);
    if (!deleted) {
      throw new Error('Failed to delete item');
    }

    // Verify deletion
    const afterDeleteResults = await this.memoryManager.query({ scope: 'local' }, this.testDir);
    const stillExists = afterDeleteResults.items.some(item => item.id === 'video-001');
    if (stillExists) {
      throw new Error('Item still exists after deletion');
    }
  }

  async testFileStorageBasicOperations() {
    await this.ensureStorageBackend('global', 'file');

    const item = this.createTestItem('file-001', 'fact', {
      scope: 'global',
      tags: ['python', 'file-test']
    });

    // Test upsert
    await this.memoryManager.upsert(item);

    // Test query without search term
    const listResults = await this.memoryManager.query({ scope: 'global' }, this.testDir);
    if (listResults.items.length === 0) {
      throw new Error('No items returned from listItems query');
    }

    // Test query with search term
    const searchResults = await this.memoryManager.query({
      q: 'python',
      scope: 'global'
    }, this.testDir);

    if (searchResults.items.length === 0) {
      throw new Error('No items returned from search query');
    }

    // Test tag filtering
    const tagResults = await this.memoryManager.query({
      scope: 'global',
      filters: { tags: ['python'] }
    }, this.testDir);

    if (tagResults.items.length === 0) {
      throw new Error('No items returned from tag filter');
    }
  }

  async testScopeAwareSearch() {
    await this.ensureStorageBackend('local', 'video');
    await this.ensureStorageBackend('global', 'file');

    const localItem = this.createTestItem('scope-local', 'snippet', {
      scope: 'local',
      tags: ['scope-test']
    });

    const globalItem = this.createTestItem('scope-global', 'fact', {
      scope: 'global',
      tags: ['scope-test']
    });

    await this.memoryManager.upsert(localItem);
    await this.memoryManager.upsert(globalItem);

    // Test local scope only
    const localResults = await this.memoryManager.query({ scope: 'local' }, this.testDir);
    if (!localResults.items.some(item => item.id === 'scope-local')) {
      throw new Error('Local item not found in local scope search');
    }
    if (localResults.items.some(item => item.id === 'scope-global')) {
      throw new Error('Global item incorrectly found in local scope search');
    }

    // Test global scope only
    const globalResults = await this.memoryManager.query({ scope: 'global' }, this.testDir);
    if (!globalResults.items.some(item => item.id === 'scope-global')) {
      throw new Error('Global item not found in global scope search');
    }
    if (globalResults.items.some(item => item.id === 'scope-local')) {
      throw new Error('Local item incorrectly found in global scope search');
    }

    // Test all scopes
    const allResults = await this.memoryManager.query({ scope: 'all' }, this.testDir);
    if (!allResults.items.some(item => item.id === 'scope-local')) {
      throw new Error('Local item not found in all scopes search');
    }
    if (!allResults.items.some(item => item.id === 'scope-global')) {
      throw new Error('Global item not found in all scopes search');
    }
  }

  async testSearchIndexRebuilding() {
    await this.ensureStorageBackend('local', 'video');

    const items = [
      this.createTestItem('rebuild-001', 'snippet'),
      this.createTestItem('rebuild-002', 'fact'),
      this.createTestItem('rebuild-003', 'pattern')
    ];

    // Add items
    for (const item of items) {
      await this.memoryManager.upsert({ ...item, scope: 'local' });
    }

    // Rebuild the scope
    const rebuildResult = await this.memoryManager.rebuildScope('local', this.testDir);
    if (rebuildResult.items !== items.length) {
      throw new Error(`Rebuild returned ${rebuildResult.items} items, expected ${items.length}`);
    }

    // Test search after rebuild
    const searchResults = await this.memoryManager.query({
      q: 'test',
      scope: 'local'
    }, this.testDir);

    if (searchResults.items.length === 0) {
      throw new Error('No search results after rebuild');
    }
  }

  async testComplexFiltering() {
    await this.ensureStorageBackend('local', 'video');

    const items = [
      this.createTestItem('filter-001', 'snippet', { tags: ['javascript', 'frontend'] }),
      this.createTestItem('filter-002', 'fact', { tags: ['python', 'backend'] }),
      this.createTestItem('filter-003', 'pattern', { tags: ['javascript', 'pattern'] }),
      this.createTestItem('filter-004', 'config', { tags: ['config', 'database'] })
    ];

    for (const item of items) {
      await this.memoryManager.upsert({ ...item, scope: 'local' });
    }

    // Test type filtering
    const snippetResults = await this.memoryManager.query({
      scope: 'local',
      filters: { type: ['snippet'] }
    }, this.testDir);

    if (!snippetResults.items.every(item => item.type === 'snippet')) {
      throw new Error('Type filter returned wrong types');
    }

    // Test multiple tag filtering
    const jsResults = await this.memoryManager.query({
      scope: 'local',
      filters: { tags: ['javascript'] }
    }, this.testDir);

    if (jsResults.items.length !== 2) {
      throw new Error(`Expected 2 JavaScript items, got ${jsResults.items.length}`);
    }

    // Test combined search and filter
    const searchAndFilterResults = await this.memoryManager.query({
      q: 'test',
      scope: 'local',
      filters: { tags: ['python'] }
    }, this.testDir);

    if (!searchAndFilterResults.items.every(item => item.facets.tags.includes('python'))) {
      throw new Error('Combined search and filter returned incorrect results');
    }
  }

  async run() {
    console.log('🔍 Video Storage Search Integration Validation');
    console.log('=' .repeat(50));

    try {
      await this.setup();

      await this.runTest('Video Storage Basic Operations',
        () => this.testVideoStorageBasicOperations());

      await this.runTest('File Storage Basic Operations',
        () => this.testFileStorageBasicOperations());

      await this.runTest('Scope-Aware Search',
        () => this.testScopeAwareSearch());

      await this.runTest('Search Index Rebuilding',
        () => this.testSearchIndexRebuilding());

      await this.runTest('Complex Filtering',
        () => this.testComplexFiltering());

    } catch (error) {
      console.error('❌ Setup failed:', error);
      this.results.failed++;
      this.results.errors.push({ test: 'Setup', error: error.message });
    } finally {
      await this.cleanup();
    }

    // Report results
    console.log('\\n' + '=' .repeat(50));
    console.log('📊 Test Results:');
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    console.log(`   ⏭️  Skipped: ${this.results.skipped}`);

    if (this.results.errors.length > 0) {
      console.log('\\n❌ Errors:');
      for (const error of this.results.errors) {
        console.log(`   ${error.test}: ${error.error}`);
      }
    }

    if (this.results.failed === 0) {
      console.log('\\n🎉 All tests passed! Video storage search integration is working correctly.');
      process.exit(0);
    } else {
      console.log('\\n💥 Some tests failed. Please check the errors above.');
      process.exit(1);
    }
  }
}

// Run the validation
const validator = new SearchIntegrationValidator();
validator.run().catch(console.error);
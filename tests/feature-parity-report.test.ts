import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { VideoStorageAdapter } from '../src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from '../src/storage/FileStorageAdapter.js';
import type { MemoryItem, MemoryScope } from '../src/types/Memory.js';
import { ulid } from '../src/util/ulid.js';

/**
 * Feature Parity Validation Report Generator
 *
 * This test suite runs comprehensive validation tests and generates
 * a detailed report on feature parity between storage adapters.
 */

interface FeatureTestResult {
  category: string;
  testName: string;
  passed: boolean;
  duration: number;
  details: string;
  errors: string[];
}

interface ParityReport {
  timestamp: string;
  overallScore: number;
  categories: {
    [category: string]: {
      score: number;
      tests: FeatureTestResult[];
      summary: string;
    };
  };
  recommendations: string[];
  performanceMetrics: {
    videoBetter: string[];
    fileBetter: string[];
    equivalent: string[];
  };
  regressionRisks: string[];
}

describe('Feature Parity Validation Report', () => {
  let report: ParityReport;
  let testContext: {
    videoAdapter: VideoStorageAdapter;
    fileAdapter: FileStorageAdapter;
    testDir: string;
  };

  beforeAll(async () => {
    // Initialize test environment
    const testDir = path.join(process.cwd(), 'test-temp', `parity-report-${Date.now()}`);
    const videoDir = path.join(testDir, 'video');
    const fileDir = path.join(testDir, 'file');

    await fs.ensureDir(videoDir);
    await fs.ensureDir(fileDir);

    const videoAdapter = new VideoStorageAdapter(videoDir, 'local' as MemoryScope);
    const fileAdapter = new FileStorageAdapter(fileDir);

    testContext = { videoAdapter, fileAdapter, testDir };

    // Wait for video adapter initialization
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Initialize report
    report = {
      timestamp: new Date().toISOString(),
      overallScore: 0,
      categories: {},
      recommendations: [],
      performanceMetrics: { videoBetter: [], fileBetter: [], equivalent: [] },
      regressionRisks: []
    };
  });

  afterAll(async () => {
    try {
      // Generate and save final report
      await generateFinalReport(report);

      // Cleanup
      if (testContext?.testDir && await fs.pathExists(testContext.testDir)) {
        await fs.remove(testContext.testDir);
      }
    } catch (error) {
      console.warn('Report cleanup warning:', error);
    }
  });

  describe('Core CRUD Operations Parity', () => {
    it('should validate create operations', async () => {
      const result = await runFeatureTest(
        'CRUD Operations',
        'Create Operations Parity',
        async () => {
          const testItems = generateTestItems(20);

          // Test individual writes
          const videoWriteErrors: string[] = [];
          const fileWriteErrors: string[] = [];

          for (const item of testItems.slice(0, 5)) {
            try {
              await testContext.videoAdapter.writeItem(item);
            } catch (error) {
              videoWriteErrors.push(`Video write failed for ${item.id}: ${error}`);
            }

            try {
              await testContext.fileAdapter.writeItem(item);
            } catch (error) {
              fileWriteErrors.push(`File write failed for ${item.id}: ${error}`);
            }
          }

          await waitForVideoProcessing(testContext.videoAdapter);

          // Test batch writes
          try {
            await testContext.videoAdapter.writeBatch(testItems.slice(5, 15));
            await waitForVideoProcessing(testContext.videoAdapter);
          } catch (error) {
            videoWriteErrors.push(`Video batch write failed: ${error}`);
          }

          try {
            await testContext.fileAdapter.writeBatch(testItems.slice(5, 15));
          } catch (error) {
            fileWriteErrors.push(`File batch write failed: ${error}`);
          }

          // Verify all items exist
          const videoCatalog = testContext.videoAdapter.readCatalog();
          const fileCatalog = testContext.fileAdapter.readCatalog();

          const errors = [...videoWriteErrors, ...fileWriteErrors];

          if (Object.keys(videoCatalog).length !== Object.keys(fileCatalog).length) {
            errors.push(`Catalog size mismatch: Video ${Object.keys(videoCatalog).length}, File ${Object.keys(fileCatalog).length}`);
          }

          return {
            passed: errors.length === 0,
            details: `Tested ${testItems.length} items (5 individual + 10 batch). Video catalog: ${Object.keys(videoCatalog).length}, File catalog: ${Object.keys(fileCatalog).length}`,
            errors
          };
        }
      );

      addTestResult('CRUD Operations', result);
    }, 60000);

    it('should validate read operations', async () => {
      const result = await runFeatureTest(
        'CRUD Operations',
        'Read Operations Parity',
        async () => {
          const testItems = generateTestItems(15);

          // Setup data
          await testContext.videoAdapter.writeBatch(testItems);
          await testContext.fileAdapter.writeBatch(testItems);
          await waitForVideoProcessing(testContext.videoAdapter);

          const errors: string[] = [];

          // Test individual reads
          for (const originalItem of testItems.slice(0, 5)) {
            const videoItem = await testContext.videoAdapter.readItem(originalItem.id);
            const fileItem = await testContext.fileAdapter.readItem(originalItem.id);

            if (!videoItem) {
              errors.push(`Video adapter failed to read item ${originalItem.id}`);
            }
            if (!fileItem) {
              errors.push(`File adapter failed to read item ${originalItem.id}`);
            }

            if (videoItem && fileItem) {
              if (videoItem.title !== fileItem.title) {
                errors.push(`Title mismatch for ${originalItem.id}: "${videoItem.title}" vs "${fileItem.title}"`);
              }
              if (videoItem.text !== fileItem.text) {
                errors.push(`Text content mismatch for ${originalItem.id}`);
              }
            }
          }

          // Test batch reads
          const itemIds = testItems.slice(5, 10).map(item => item.id);
          const videoItems = await testContext.videoAdapter.readItems(itemIds);
          const fileItems = await testContext.fileAdapter.readItems(itemIds);

          if (videoItems.length !== fileItems.length) {
            errors.push(`Batch read length mismatch: Video ${videoItems.length}, File ${fileItems.length}`);
          }

          return {
            passed: errors.length === 0,
            details: `Tested ${testItems.length} items (5 individual + 5 batch reads). Success rate: ${((testItems.length - errors.length) / testItems.length * 100).toFixed(1)}%`,
            errors
          };
        }
      );

      addTestResult('CRUD Operations', result);
    }, 60000);

    it('should validate delete operations', async () => {
      const result = await runFeatureTest(
        'CRUD Operations',
        'Delete Operations Parity',
        async () => {
          const testItems = generateTestItems(10);

          // Setup data
          await testContext.videoAdapter.writeBatch(testItems);
          await testContext.fileAdapter.writeBatch(testItems);
          await waitForVideoProcessing(testContext.videoAdapter);

          const errors: string[] = [];

          // Test individual deletes
          const deleteIds = testItems.slice(0, 3).map(item => item.id);
          for (const id of deleteIds) {
            const videoDeleted = await testContext.videoAdapter.deleteItem(id);
            const fileDeleted = await testContext.fileAdapter.deleteItem(id);

            if (videoDeleted !== fileDeleted) {
              errors.push(`Delete result mismatch for ${id}: Video ${videoDeleted}, File ${fileDeleted}`);
            }
          }

          // Test batch deletes
          const batchDeleteIds = testItems.slice(3, 6).map(item => item.id);
          const videoResults = await testContext.videoAdapter.deleteBatch(batchDeleteIds);
          const fileResults = await testContext.fileAdapter.deleteBatch(batchDeleteIds);

          if (JSON.stringify(videoResults) !== JSON.stringify(fileResults)) {
            errors.push(`Batch delete results mismatch: Video [${videoResults.join(',')}], File [${fileResults.join(',')}]`);
          }

          // Verify deletions
          for (const id of [...deleteIds, ...batchDeleteIds]) {
            const videoItem = await testContext.videoAdapter.readItem(id);
            const fileItem = await testContext.fileAdapter.readItem(id);

            if (videoItem !== null || fileItem !== null) {
              errors.push(`Item ${id} not properly deleted: Video ${videoItem ? 'exists' : 'null'}, File ${fileItem ? 'exists' : 'null'}`);
            }
          }

          return {
            passed: errors.length === 0,
            details: `Tested deletion of ${deleteIds.length + batchDeleteIds.length} items (3 individual + 3 batch)`,
            errors
          };
        }
      );

      addTestResult('CRUD Operations', result);
    }, 60000);
  });

  describe('Data Integrity and Consistency', () => {
    it('should validate data preservation through operations', async () => {
      const result = await runFeatureTest(
        'Data Integrity',
        'Data Preservation Validation',
        async () => {
          const complexItem = createComplexTestItem();
          const errors: string[] = [];

          // Write complex item
          await testContext.videoAdapter.writeItem(complexItem);
          await testContext.fileAdapter.writeItem(complexItem);
          await waitForVideoProcessing(testContext.videoAdapter);

          // Read and verify
          const videoItem = await testContext.videoAdapter.readItem(complexItem.id);
          const fileItem = await testContext.fileAdapter.readItem(complexItem.id);

          if (!videoItem || !fileItem) {
            errors.push('Failed to read complex item from one or both adapters');
          } else {
            // Deep comparison of complex fields
            if (JSON.stringify(videoItem.facets) !== JSON.stringify(fileItem.facets)) {
              errors.push('Facets data mismatch');
            }
            if (JSON.stringify(videoItem.context) !== JSON.stringify(fileItem.context)) {
              errors.push('Context data mismatch');
            }
            if (JSON.stringify(videoItem.quality) !== JSON.stringify(fileItem.quality)) {
              errors.push('Quality data mismatch');
            }
            if (videoItem.code !== fileItem.code) {
              errors.push('Code content mismatch');
            }
          }

          // Test update operations
          const updatedItem = { ...complexItem, title: 'Updated: ' + complexItem.title, version: 2 };
          await testContext.videoAdapter.writeItem(updatedItem);
          await testContext.fileAdapter.writeItem(updatedItem);
          await waitForVideoProcessing(testContext.videoAdapter);

          const updatedVideoItem = await testContext.videoAdapter.readItem(complexItem.id);
          const updatedFileItem = await testContext.fileAdapter.readItem(complexItem.id);

          if (updatedVideoItem?.title !== updatedFileItem?.title) {
            errors.push('Update operation consistency failed');
          }

          return {
            passed: errors.length === 0,
            details: `Tested complex data structure with ${Object.keys(complexItem.facets?.tags || {}).length} tags, nested context objects, and update operations`,
            errors
          };
        }
      );

      addTestResult('Data Integrity', result);
    }, 60000);

    it('should validate unicode and special character handling', async () => {
      const result = await runFeatureTest(
        'Data Integrity',
        'Unicode and Special Characters',
        async () => {
          const unicodeItem: MemoryItem = {
            id: ulid(),
            type: 'note',
            scope: 'local',
            title: 'Unicode Test: 测试 🚀 Café naïve résumé',
            text: 'Content with unicode: 你好世界 🌍\nSpecial chars: !@#$%^&*()[]{}|;:,.<>?`~\nEmoji: 🚀💻⚡🎯📊',
            code: '// Unicode in code: 测试代码\nconst café = "naïve résumé";\nconst emoji = "🚀";\nconst special = "!@#$%^&*()";',
            facets: {
              tags: ['unicode', '测试', 'café'],
              files: ['unicode-测试.js', 'special-!@#.ts'],
              symbols: ['测试函数', 'unicode_var', 'special!@#']
            },
            quality: { confidence: 0.8, pinned: false, reuseCount: 0 },
            security: { sensitivity: 'public' },
            context: {
              unicode: '你好世界🌍',
              special: '!@#$%^&*()',
              nested: { deep: { unicode: '测试嵌套' } }
            },
            links: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1
          };

          const errors: string[] = [];

          await testContext.videoAdapter.writeItem(unicodeItem);
          await testContext.fileAdapter.writeItem(unicodeItem);
          await waitForVideoProcessing(testContext.videoAdapter);

          const videoItem = await testContext.videoAdapter.readItem(unicodeItem.id);
          const fileItem = await testContext.fileAdapter.readItem(unicodeItem.id);

          if (!videoItem || !fileItem) {
            errors.push('Failed to read unicode item');
          } else {
            // Check all unicode content preservation
            const fields = ['title', 'text', 'code'] as const;
            for (const field of fields) {
              if (videoItem[field] !== fileItem[field]) {
                errors.push(`Unicode mismatch in ${field}`);
              }
              if (videoItem[field] !== unicodeItem[field]) {
                errors.push(`Unicode corruption in ${field} (video)`);
              }
              if (fileItem[field] !== unicodeItem[field]) {
                errors.push(`Unicode corruption in ${field} (file)`);
              }
            }

            // Check arrays with unicode
            if (JSON.stringify(videoItem.facets?.tags) !== JSON.stringify(fileItem.facets?.tags)) {
              errors.push('Unicode tags mismatch');
            }
          }

          return {
            passed: errors.length === 0,
            details: 'Tested Chinese characters, emojis, accented characters, and special symbols',
            errors
          };
        }
      );

      addTestResult('Data Integrity', result);
    }, 60000);
  });

  describe('Search and Query Capabilities', () => {
    it('should validate catalog-based search parity', async () => {
      const result = await runFeatureTest(
        'Search Capabilities',
        'Catalog Search Parity',
        async () => {
          const searchItems = generateSearchTestItems(30);

          await testContext.videoAdapter.writeBatch(searchItems);
          await testContext.fileAdapter.writeBatch(searchItems);
          await waitForVideoProcessing(testContext.videoAdapter);

          const errors: string[] = [];

          const videoCatalog = testContext.videoAdapter.readCatalog();
          const fileCatalog = testContext.fileAdapter.readCatalog();

          // Test tag-based filtering
          const testTags = ['javascript', 'database', 'api'];
          for (const tag of testTags) {
            const videoTagResults = Object.entries(videoCatalog)
              .filter(([_, summary]) => summary.tags?.includes(tag))
              .map(([id, _]) => id)
              .sort();

            const fileTagResults = Object.entries(fileCatalog)
              .filter(([_, summary]) => summary.tags?.includes(tag))
              .map(([id, _]) => id)
              .sort();

            if (JSON.stringify(videoTagResults) !== JSON.stringify(fileTagResults)) {
              errors.push(`Tag search mismatch for "${tag}": Video found ${videoTagResults.length}, File found ${fileTagResults.length}`);
            }
          }

          // Test type-based filtering
          const testTypes = ['snippet', 'pattern', 'insight'];
          for (const type of testTypes) {
            const videoTypeResults = Object.entries(videoCatalog)
              .filter(([_, summary]) => summary.type === type)
              .length;

            const fileTypeResults = Object.entries(fileCatalog)
              .filter(([_, summary]) => summary.type === type)
              .length;

            if (videoTypeResults !== fileTypeResults) {
              errors.push(`Type search mismatch for "${type}": Video ${videoTypeResults}, File ${fileTypeResults}`);
            }
          }

          return {
            passed: errors.length === 0,
            details: `Tested catalog search across ${searchItems.length} items with tag and type filtering`,
            errors
          };
        }
      );

      addTestResult('Search Capabilities', result);
    }, 60000);
  });

  describe('Performance Characteristics', () => {
    it('should validate performance metrics', async () => {
      const result = await runFeatureTest(
        'Performance',
        'Comparative Performance Analysis',
        async () => {
          const perfItems = generateTestItems(50);
          const errors: string[] = [];

          // Benchmark write performance
          const videoWriteStart = performance.now();
          await testContext.videoAdapter.writeBatch(perfItems);
          await waitForVideoProcessing(testContext.videoAdapter);
          const videoWriteTime = performance.now() - videoWriteStart;

          const fileWriteStart = performance.now();
          await testContext.fileAdapter.writeBatch(perfItems);
          const fileWriteTime = performance.now() - fileWriteStart;

          // Benchmark read performance
          const itemIds = perfItems.slice(0, 20).map(item => item.id);

          const videoReadStart = performance.now();
          await testContext.videoAdapter.readItems(itemIds);
          const videoReadTime = performance.now() - videoReadStart;

          const fileReadStart = performance.now();
          await testContext.fileAdapter.readItems(itemIds);
          const fileReadTime = performance.now() - fileReadStart;

          // Get storage efficiency
          const videoStats = await testContext.videoAdapter.getStats();
          const fileStats = await testContext.fileAdapter.getStats();

          // Categorize performance results
          const writeRatio = videoWriteTime / fileWriteTime;
          const readRatio = videoReadTime / fileReadTime;
          const storageRatio = fileStats.sizeBytes / videoStats.sizeBytes;

          if (writeRatio < 0.8) {
            report.performanceMetrics.videoBetter.push('Write Performance');
          } else if (writeRatio > 2.0) {
            report.performanceMetrics.fileBetter.push('Write Performance');
          } else {
            report.performanceMetrics.equivalent.push('Write Performance');
          }

          if (readRatio < 0.8) {
            report.performanceMetrics.videoBetter.push('Read Performance');
          } else if (readRatio > 2.0) {
            report.performanceMetrics.fileBetter.push('Read Performance');
          } else {
            report.performanceMetrics.equivalent.push('Read Performance');
          }

          if (storageRatio > 1.5) {
            report.performanceMetrics.videoBetter.push('Storage Efficiency');
          } else if (storageRatio < 0.8) {
            report.performanceMetrics.fileBetter.push('Storage Efficiency');
          } else {
            report.performanceMetrics.equivalent.push('Storage Efficiency');
          }

          // Performance validation thresholds
          if (videoWriteTime > 120000) { // 2 minutes
            errors.push(`Video write performance too slow: ${videoWriteTime.toFixed(0)}ms for ${perfItems.length} items`);
          }

          if (videoReadTime > 30000) { // 30 seconds
            errors.push(`Video read performance too slow: ${videoReadTime.toFixed(0)}ms for ${itemIds.length} items`);
          }

          return {
            passed: errors.length === 0,
            details: `Write: Video ${videoWriteTime.toFixed(0)}ms vs File ${fileWriteTime.toFixed(0)}ms (${writeRatio.toFixed(2)}x). ` +
                    `Read: Video ${videoReadTime.toFixed(0)}ms vs File ${fileReadTime.toFixed(0)}ms (${readRatio.toFixed(2)}x). ` +
                    `Storage: ${storageRatio.toFixed(2)}x efficiency`,
            errors
          };
        }
      );

      addTestResult('Performance', result);
    }, 180000);
  });

  describe('Reliability and Error Handling', () => {
    it('should validate error handling consistency', async () => {
      const result = await runFeatureTest(
        'Reliability',
        'Error Handling Parity',
        async () => {
          const errors: string[] = [];

          // Test non-existent item reads
          const nonExistentId = ulid();
          const videoNonExistent = await testContext.videoAdapter.readItem(nonExistentId);
          const fileNonExistent = await testContext.fileAdapter.readItem(nonExistentId);

          if (videoNonExistent !== null || fileNonExistent !== null) {
            errors.push(`Non-existent item handling mismatch: Video ${videoNonExistent}, File ${fileNonExistent}`);
          }

          // Test non-existent item deletes
          const videoDeleteResult = await testContext.videoAdapter.deleteItem(nonExistentId);
          const fileDeleteResult = await testContext.fileAdapter.deleteItem(nonExistentId);

          if (videoDeleteResult !== fileDeleteResult) {
            errors.push(`Non-existent delete handling mismatch: Video ${videoDeleteResult}, File ${fileDeleteResult}`);
          }

          // Test empty operations
          const videoEmptyBatch = await testContext.videoAdapter.readItems([]);
          const fileEmptyBatch = await testContext.fileAdapter.readItems([]);

          if (videoEmptyBatch.length !== 0 || fileEmptyBatch.length !== 0) {
            errors.push(`Empty batch handling mismatch: Video ${videoEmptyBatch.length}, File ${fileEmptyBatch.length}`);
          }

          return {
            passed: errors.length === 0,
            details: 'Tested non-existent item reads/deletes and empty batch operations',
            errors
          };
        }
      );

      addTestResult('Reliability', result);
    }, 30000);
  });

  // Helper functions for test management
  function addTestResult(category: string, result: FeatureTestResult): void {
    if (!report.categories[category]) {
      report.categories[category] = {
        score: 0,
        tests: [],
        summary: ''
      };
    }

    report.categories[category].tests.push(result);

    // Calculate category score
    const passed = report.categories[category].tests.filter(t => t.passed).length;
    const total = report.categories[category].tests.length;
    report.categories[category].score = (passed / total) * 100;

    // Update overall score
    const allTests = Object.values(report.categories).flatMap(c => c.tests);
    const totalPassed = allTests.filter(t => t.passed).length;
    report.overallScore = (totalPassed / allTests.length) * 100;
  }

  async function runFeatureTest(
    category: string,
    testName: string,
    testFunction: () => Promise<{ passed: boolean; details: string; errors: string[] }>
  ): Promise<FeatureTestResult> {
    const startTime = performance.now();

    try {
      const result = await testFunction();
      const duration = performance.now() - startTime;

      return {
        category,
        testName,
        passed: result.passed,
        duration,
        details: result.details,
        errors: result.errors
      };
    } catch (error) {
      const duration = performance.now() - startTime;

      return {
        category,
        testName,
        passed: false,
        duration,
        details: 'Test execution failed',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
});

// Report generation and helper functions

async function generateFinalReport(report: ParityReport): Promise<void> {
  // Generate category summaries
  for (const [category, data] of Object.entries(report.categories)) {
    const passed = data.tests.filter(t => t.passed).length;
    const total = data.tests.length;
    const avgDuration = data.tests.reduce((sum, t) => sum + t.duration, 0) / total;

    data.summary = `${passed}/${total} tests passed (${data.score.toFixed(1)}%) - Avg duration: ${avgDuration.toFixed(0)}ms`;
  }

  // Generate recommendations
  report.recommendations = generateRecommendations(report);

  // Generate regression risks
  report.regressionRisks = generateRegressionRisks(report);

  // Create detailed report text
  const reportContent = generateReportContent(report);

  // Save reports
  const reportsDir = path.join(process.cwd(), 'test-reports');
  await fs.ensureDir(reportsDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `feature-parity-report-${timestamp}.md`);
  const jsonPath = path.join(reportsDir, `feature-parity-report-${timestamp}.json`);

  await fs.writeFile(reportPath, reportContent);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  console.log(`\n📋 Feature Parity Report Generated:`);
  console.log(`   Markdown: ${reportPath}`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Overall Score: ${report.overallScore.toFixed(1)}%`);
}

function generateRecommendations(report: ParityReport): string[] {
  const recommendations: string[] = [];

  // Score-based recommendations
  if (report.overallScore < 80) {
    recommendations.push('❌ CRITICAL: Feature parity below 80%. Significant compatibility issues detected.');
  } else if (report.overallScore < 95) {
    recommendations.push('⚠️ WARNING: Feature parity below 95%. Minor compatibility issues need attention.');
  } else {
    recommendations.push('✅ EXCELLENT: Feature parity above 95%. Systems are highly compatible.');
  }

  // Performance-based recommendations
  if (report.performanceMetrics.fileBetter.length > report.performanceMetrics.videoBetter.length) {
    recommendations.push('📈 PERFORMANCE: File storage shows better performance in most metrics. Consider optimization strategies for video storage.');
  } else if (report.performanceMetrics.videoBetter.length > 2) {
    recommendations.push('🚀 PERFORMANCE: Video storage shows competitive performance. Good foundation for production use.');
  }

  // Category-specific recommendations
  for (const [category, data] of Object.entries(report.categories)) {
    if (data.score < 80) {
      recommendations.push(`🔧 ${category.toUpperCase()}: Score ${data.score.toFixed(1)}% - Requires immediate attention.`);
    }
  }

  return recommendations;
}

function generateRegressionRisks(report: ParityReport): string[] {
  const risks: string[] = [];

  // Check for failed critical tests
  const criticalCategories = ['CRUD Operations', 'Data Integrity'];
  for (const category of criticalCategories) {
    const categoryData = report.categories[category];
    if (categoryData && categoryData.score < 100) {
      risks.push(`HIGH: ${category} not at 100% parity - potential data loss or corruption risks`);
    }
  }

  // Performance regression risks
  if (report.performanceMetrics.fileBetter.length > 3) {
    risks.push('MEDIUM: Video storage significantly slower than file storage - user experience impact');
  }

  // Search functionality risks
  const searchCategory = report.categories['Search Capabilities'];
  if (searchCategory && searchCategory.score < 95) {
    risks.push('MEDIUM: Search functionality parity issues - feature discrepancies for users');
  }

  if (risks.length === 0) {
    risks.push('LOW: No significant regression risks detected');
  }

  return risks;
}

function generateReportContent(report: ParityReport): string {
  let content = `# Storage Adapter Feature Parity Report

**Generated:** ${report.timestamp}
**Overall Score:** ${report.overallScore.toFixed(1)}%

## Executive Summary

This report validates feature parity between VideoStorageAdapter and FileStorageAdapter implementations. The analysis covers CRUD operations, data integrity, search capabilities, performance characteristics, and reliability testing.

## Test Results by Category

`;

  // Category results
  for (const [category, data] of Object.entries(report.categories)) {
    content += `### ${category}
**Score:** ${data.score.toFixed(1)}% (${data.tests.filter(t => t.passed).length}/${data.tests.length} tests passed)
**Summary:** ${data.summary}

`;

    for (const test of data.tests) {
      const status = test.passed ? '✅' : '❌';
      content += `- ${status} **${test.testName}** (${test.duration.toFixed(0)}ms)
  - ${test.details}`;

      if (test.errors.length > 0) {
        content += `
  - **Errors:** ${test.errors.join('; ')}`;
      }
      content += '\n\n';
    }
  }

  // Performance comparison
  content += `## Performance Analysis

### Areas where Video Storage performs better:
${report.performanceMetrics.videoBetter.length > 0
  ? report.performanceMetrics.videoBetter.map(m => `- ${m}`).join('\n')
  : '- None detected'}

### Areas where File Storage performs better:
${report.performanceMetrics.fileBetter.length > 0
  ? report.performanceMetrics.fileBetter.map(m => `- ${m}`).join('\n')
  : '- None detected'}

### Areas with equivalent performance:
${report.performanceMetrics.equivalent.length > 0
  ? report.performanceMetrics.equivalent.map(m => `- ${m}`).join('\n')
  : '- None detected'}

`;

  // Recommendations
  content += `## Recommendations

${report.recommendations.map(r => `- ${r}`).join('\n')}

## Regression Risk Assessment

${report.regressionRisks.map(r => `- ${r}`).join('\n')}

## Conclusion

`;

  if (report.overallScore >= 95) {
    content += `The video storage adapter demonstrates **excellent feature parity** with the file storage adapter. With a score of ${report.overallScore.toFixed(1)}%, the system is ready for production use with minimal compatibility concerns.`;
  } else if (report.overallScore >= 80) {
    content += `The video storage adapter shows **good feature parity** with the file storage adapter. With a score of ${report.overallScore.toFixed(1)}%, there are minor issues that should be addressed before production deployment.`;
  } else {
    content += `The video storage adapter has **significant parity issues** with the file storage adapter. With a score of ${report.overallScore.toFixed(1)}%, major compatibility problems must be resolved before considering production use.`;
  }

  content += `

## Detailed Test Data

For detailed test data and results, see the accompanying JSON report file.

---
*Report generated by Feature Parity Validation Test Suite*
`;

  return content;
}

// Test data generators and utilities (reused from other test files)

function generateTestItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];

  for (let i = 0; i < count; i++) {
    items.push({
      id: ulid(),
      type: ['snippet', 'pattern', 'insight', 'fact'][i % 4] as any,
      scope: 'local',
      title: `Test Item ${i + 1}: Feature Parity Validation`,
      text: `This is test content for item ${i + 1}. Testing feature parity between storage adapters.`,
      code: i % 3 === 0 ? `function testItem${i}() { return ${i}; }` : undefined,
      facets: {
        tags: [`test-${i % 5}`, 'parity-validation'],
        files: i % 4 === 0 ? [`test-${i}.js`] : [],
        symbols: i % 2 === 0 ? [`testItem${i}`] : []
      },
      quality: {
        confidence: 0.5 + (i % 5) * 0.1,
        pinned: i % 7 === 0,
        reuseCount: i % 3
      },
      security: { sensitivity: 'private' },
      context: { testIndex: i },
      links: [],
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      updatedAt: new Date(Date.now() - i * 500).toISOString(),
      version: 1
    });
  }

  return items;
}

function generateSearchTestItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];
  const languages = ['javascript', 'typescript', 'python'];
  const types = ['snippet', 'pattern', 'insight'];
  const categories = ['database', 'api', 'frontend'];

  for (let i = 0; i < count; i++) {
    const lang = languages[i % languages.length];
    const category = categories[i % categories.length];

    items.push({
      id: ulid(),
      type: types[i % types.length] as any,
      scope: 'local',
      title: `${lang} ${category} implementation`,
      text: `Implementation details for ${category} using ${lang}`,
      code: `// ${lang} ${category} code\nfunction ${category}Function() { return true; }`,
      facets: {
        tags: [lang, category, 'implementation'],
        files: [`${category}.${lang === 'python' ? 'py' : 'js'}`],
        symbols: [`${category}Function`]
      },
      quality: { confidence: 0.8, pinned: i % 10 === 0, reuseCount: 0 },
      security: { sensitivity: 'public' },
      context: { language: lang, category },
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    });
  }

  return items;
}

function createComplexTestItem(): MemoryItem {
  return {
    id: ulid(),
    type: 'pattern',
    scope: 'local',
    title: 'Complex Data Structure Test Pattern',
    text: 'This item contains complex nested structures, arrays, and various data types for comprehensive testing.',
    code: 'interface ComplexInterface {\n  nested: { deep: { value: any } };\n  arrays: string[];\n}',
    facets: {
      tags: ['complex', 'nested', 'testing', 'comprehensive'],
      files: ['complex.ts', 'nested.interface.ts', 'test.spec.ts'],
      symbols: ['ComplexInterface', 'NestedType', 'TestFunction']
    },
    quality: {
      confidence: 0.95,
      pinned: true,
      reuseCount: 10,
      helpfulCount: 5,
      notHelpfulCount: 0,
      lastAccessedAt: new Date().toISOString()
    },
    security: {
      sensitivity: 'team',
      accessLevel: 'developer'
    },
    context: {
      complexity: 'high',
      nested: {
        deep: {
          structure: {
            with: {
              multiple: {
                levels: 'test-value',
                array: [1, 2, 3, 'test'],
                boolean: true
              }
            }
          }
        }
      },
      arrays: ['item1', 'item2', 'item3'],
      metadata: { generated: true, purpose: 'comprehensive-testing' }
    },
    links: [
      { type: 'relates', targetId: 'related-test-item' }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

async function waitForVideoProcessing(adapter: VideoStorageAdapter): Promise<void> {
  const startTime = Date.now();
  const timeout = 120000; // 2 minutes

  while (Date.now() - startTime < timeout) {
    try {
      const metrics = await (adapter as any).getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return;
      }
    } catch (error) {
      // If metrics aren't available, wait longer
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.warn('Video processing did not complete within timeout');
}
#!/usr/bin/env node
/**
 * DIAGNOSTIC AGENT: Video Storage Pipeline Analysis
 *
 * Comprehensive test suite to analyze video storage system core pipeline issues:
 * 1. Scope Analysis - Check memory items across different scopes
 * 2. Video Pipeline Integrity - Test encoding→decoding fidelity
 * 3. Index Corruption Detection - Analyze VideoStorageAdapter integrity
 * 4. Search Integration Issues - Test search vs storage disconnect
 */

import { MemoryManager } from './src/MemoryManager.js';
import { VideoStorageAdapter } from './src/storage/VideoStorageAdapter.js';
import { createHash } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs-extra';

interface DiagnosticResult {
  test: string;
  success: boolean;
  findings: string[];
  evidence: any[];
  recommendations: string[];
}

class VideoStorageDiagnostic {
  private memoryManager: MemoryManager;
  private results: DiagnosticResult[] = [];

  constructor() {
    this.memoryManager = new MemoryManager();
  }

  async runFullDiagnostic(): Promise<void> {
    console.log('🔍 STARTING VIDEO STORAGE PIPELINE DIAGNOSTIC');
    console.log('===============================================');

    // Test 1: Scope Analysis
    await this.testScopeIsolation();

    // Test 2: Video Pipeline Integrity
    await this.testVideoPipelineIntegrity();

    // Test 3: Index Corruption Detection
    await this.testIndexCorruption();

    // Test 4: Search Integration
    await this.testSearchIntegration();

    // Generate comprehensive report
    this.generateReport();
  }

  /**
   * Test 1: Scope Analysis - Check if missing memory items exist in different scopes
   */
  private async testScopeIsolation(): Promise<void> {
    console.log('\n📋 TEST 1: Scope Isolation Analysis');
    console.log('----------------------------------');

    const result: DiagnosticResult = {
      test: 'Scope Isolation',
      success: true,
      findings: [],
      evidence: [],
      recommendations: []
    };

    try {
      // Get all memory items from each scope
      const globalItems = await this.memoryManager.list('global', undefined);
      const localItems = await this.memoryManager.list('local', undefined);
      const committedItems = await this.memoryManager.list('committed', undefined);
      const projectItems = await this.memoryManager.list('project', undefined);
      const allItems = await this.memoryManager.list('all', undefined);

      console.log(`📊 Memory count by scope:`);
      console.log(`   Global: ${globalItems.length}`);
      console.log(`   Local: ${localItems.length}`);
      console.log(`   Committed: ${committedItems.length}`);
      console.log(`   Project (committed+local): ${projectItems.length}`);
      console.log(`   All scopes: ${allItems.length}`);

      result.evidence.push({
        scopeCounts: {
          global: globalItems.length,
          local: localItems.length,
          committed: committedItems.length,
          project: projectItems.length,
          all: allItems.length
        }
      });

      // Test scope priority order (committed → local → global)
      for (const item of allItems) {
        const directRead = await this.memoryManager.get(item.id);
        if (!directRead) {
          result.success = false;
          result.findings.push(`❌ Item ${item.id} found in catalog but not retrievable directly`);
          result.evidence.push({
            missingItem: item,
            catalogScope: item.scope,
            directReadResult: null
          });
        } else if (directRead.scope !== item.scope) {
          result.findings.push(`⚠️  Scope mismatch: catalog shows ${item.scope}, but read returned ${directRead.scope}`);
          result.evidence.push({
            scopeMismatch: {
              itemId: item.id,
              catalogScope: item.scope,
              readScope: directRead.scope
            }
          });
        }
      }

      // Check for orphaned items (in index but not in video)
      const videoBackendDir = path.join(process.cwd(), '.llm-memory');
      if (await fs.pathExists(videoBackendDir)) {
        const catalogPath = path.join(videoBackendDir, 'catalog.json');
        const indexPath = path.join(videoBackendDir, 'segments', 'consolidated-index.json');

        if (await fs.pathExists(catalogPath) && await fs.pathExists(indexPath)) {
          const catalog = await fs.readJson(catalogPath);
          const index = await fs.readJson(indexPath);

          console.log(`📋 Checking catalog vs index consistency:`);
          console.log(`   Catalog items: ${Object.keys(catalog).length}`);
          console.log(`   Index items: ${Object.keys(index.items || {}).length}`);

          // Find items in catalog but not in index
          for (const [itemId, catalogEntry] of Object.entries(catalog)) {
            if (!index.items?.[itemId]) {
              result.findings.push(`🔍 Catalog item ${itemId} missing from video index`);
              result.evidence.push({
                orphanedCatalogItem: { itemId, catalogEntry }
              });
            }
          }

          // Find items in index but not in catalog
          for (const [itemId, indexEntry] of Object.entries(index.items || {})) {
            if (!catalog[itemId]) {
              result.findings.push(`🎬 Index item ${itemId} missing from catalog`);
              result.evidence.push({
                orphanedIndexItem: { itemId, indexEntry }
              });
            }
          }
        }
      }

    } catch (error) {
      result.success = false;
      result.findings.push(`❌ Scope analysis failed: ${error}`);
      result.evidence.push({ error: String(error) });
    }

    if (result.findings.length === 0) {
      result.findings.push('✅ All scope isolation checks passed');
    }

    this.results.push(result);
  }

  /**
   * Test 2: Video Pipeline Integrity - Test complete encoding→decoding pipeline
   */
  private async testVideoPipelineIntegrity(): Promise<void> {
    console.log('\n🎬 TEST 2: Video Pipeline Integrity');
    console.log('----------------------------------');

    const result: DiagnosticResult = {
      test: 'Video Pipeline Integrity',
      success: true,
      findings: [],
      evidence: [],
      recommendations: []
    };

    try {
      // Test existing video items
      const committedItems = await this.memoryManager.list('committed', undefined);

      console.log(`🎯 Testing ${committedItems.length} committed items for video integrity`);

      let successfulDecodes = 0;
      let failedDecodes = 0;

      for (const itemSummary of committedItems.slice(0, 3)) { // Test first 3 items
        console.log(`   Testing item: ${itemSummary.id} - ${itemSummary.title}`);

        try {
          const fullItem = await this.memoryManager.get(itemSummary.id, 'committed');

          if (!fullItem) {
            result.findings.push(`❌ Could not retrieve full item ${itemSummary.id} despite being in catalog`);
            failedDecodes++;
            continue;
          }

          // Verify content integrity by checking against summary
          const integrityChecks = {
            idMatch: fullItem.id === itemSummary.id,
            typeMatch: fullItem.type === itemSummary.type,
            titleMatch: fullItem.title === itemSummary.title,
            hasContent: !!(fullItem.text || fullItem.code),
            hasFacets: !!(fullItem.facets && Array.isArray(fullItem.facets.tags))
          };

          const passedChecks = Object.values(integrityChecks).filter(Boolean).length;
          const totalChecks = Object.keys(integrityChecks).length;

          console.log(`     Integrity: ${passedChecks}/${totalChecks} checks passed`);

          if (passedChecks === totalChecks) {
            successfulDecodes++;
            result.findings.push(`✅ Item ${itemSummary.id} passed all integrity checks`);
          } else {
            failedDecodes++;
            result.findings.push(`⚠️  Item ${itemSummary.id} failed ${totalChecks - passedChecks} integrity checks`);
            result.evidence.push({
              integrityFailure: {
                itemId: itemSummary.id,
                checks: integrityChecks,
                summary: itemSummary,
                fullItem: {
                  id: fullItem.id,
                  type: fullItem.type,
                  title: fullItem.title,
                  hasText: !!fullItem.text,
                  hasCode: !!fullItem.code,
                  facetsStructure: fullItem.facets
                }
              }
            });
          }

        } catch (error) {
          failedDecodes++;
          result.findings.push(`❌ Failed to decode item ${itemSummary.id}: ${error}`);
          result.evidence.push({
            decodeError: {
              itemId: itemSummary.id,
              error: String(error)
            }
          });
        }
      }

      const decodeSuccessRate = successfulDecodes / (successfulDecodes + failedDecodes);
      console.log(`📊 Pipeline integrity: ${successfulDecodes} successes, ${failedDecodes} failures (${(decodeSuccessRate * 100).toFixed(1)}%)`);

      result.evidence.push({
        pipelineStats: {
          successfulDecodes,
          failedDecodes,
          successRate: decodeSuccessRate,
          totalTested: successfulDecodes + failedDecodes
        }
      });

      if (decodeSuccessRate < 0.9) {
        result.success = false;
        result.recommendations.push('Video pipeline has < 90% success rate, requires investigation');
      }

    } catch (error) {
      result.success = false;
      result.findings.push(`❌ Video pipeline test failed: ${error}`);
      result.evidence.push({ error: String(error) });
    }

    this.results.push(result);
  }

  /**
   * Test 3: Index Corruption Detection - Check VideoStorageAdapter index integrity
   */
  private async testIndexCorruption(): Promise<void> {
    console.log('\n🔍 TEST 3: Index Corruption Detection');
    console.log('------------------------------------');

    const result: DiagnosticResult = {
      test: 'Index Corruption Detection',
      success: true,
      findings: [],
      evidence: [],
      recommendations: []
    };

    try {
      const videoDir = path.join(process.cwd(), '.llm-memory');

      if (!(await fs.pathExists(videoDir))) {
        result.findings.push('⚠️  No video storage directory found');
        this.results.push(result);
        return;
      }

      // Check consolidated index integrity
      const indexPath = path.join(videoDir, 'segments', 'consolidated-index.json');
      const videoPath = path.join(videoDir, 'segments', 'consolidated.mp4');
      const catalogPath = path.join(videoDir, 'catalog.json');

      if (await fs.pathExists(indexPath)) {
        const index = await fs.readJson(indexPath);
        const catalog = await fs.pathExists(catalogPath) ? await fs.readJson(catalogPath) : {};

        console.log(`📋 Analyzing consolidated index integrity:`);
        console.log(`   Total frames: ${index.totalFrames}`);
        console.log(`   Total items: ${index.totalItems}`);
        console.log(`   Index items: ${Object.keys(index.items || {}).length}`);
        console.log(`   Content hashes: ${Object.keys(index.contentHashes || {}).length}`);

        // Check for frame mapping consistency
        let frameMapping: Record<number, string> = {};
        let duplicateFrames: number[] = [];
        let orphanedFrames: number[] = [];

        for (const [itemId, itemEntry] of Object.entries(index.items || {})) {
          const entry = itemEntry as any;

          // Check frame range validity
          if (entry.frameStart > entry.frameEnd) {
            result.findings.push(`❌ Invalid frame range for ${itemId}: start(${entry.frameStart}) > end(${entry.frameEnd})`);
          }

          if (entry.frameEnd >= index.totalFrames) {
            result.findings.push(`❌ Frame end ${entry.frameEnd} exceeds total frames ${index.totalFrames} for ${itemId}`);
          }

          // Check for frame overlaps
          for (let frame = entry.frameStart; frame <= entry.frameEnd; frame++) {
            if (frameMapping[frame]) {
              duplicateFrames.push(frame);
              result.findings.push(`❌ Frame ${frame} mapped to multiple items: ${frameMapping[frame]} and ${itemId}`);
            } else {
              frameMapping[frame] = itemId;
            }
          }

          // Verify content hash consistency
          const catalogHash = (catalog[itemId] as any)?.contentHash;
          if (catalogHash && catalogHash !== entry.contentHash) {
            result.findings.push(`❌ Content hash mismatch for ${itemId}: catalog(${catalogHash}) vs index(${entry.contentHash})`);
          }

          // Check content hash mapping
          const hashMapping = index.contentHashes?.[entry.contentHash];
          if (!hashMapping) {
            result.findings.push(`❌ Content hash ${entry.contentHash} for ${itemId} not in contentHashes map`);
          } else if (hashMapping.itemId !== itemId) {
            result.findings.push(`❌ Content hash mapping inconsistency: hash points to ${hashMapping.itemId} but found in ${itemId}`);
          }
        }

        // Check for orphaned frames
        for (let frame = 0; frame < index.totalFrames; frame++) {
          if (!frameMapping[frame]) {
            orphanedFrames.push(frame);
          }
        }

        if (orphanedFrames.length > 0) {
          result.findings.push(`⚠️  Found ${orphanedFrames.length} orphaned frames: ${orphanedFrames.slice(0, 10).join(', ')}${orphanedFrames.length > 10 ? '...' : ''}`);
        }

        result.evidence.push({
          indexAnalysis: {
            totalFrames: index.totalFrames,
            mappedFrames: Object.keys(frameMapping).length,
            duplicateFrames: duplicateFrames.length,
            orphanedFrames: orphanedFrames.length,
            itemCount: Object.keys(index.items || {}).length,
            hashCount: Object.keys(index.contentHashes || {}).length
          }
        });

        // Check video file existence and size
        if (await fs.pathExists(videoPath)) {
          const videoStats = await fs.stat(videoPath);
          console.log(`🎬 Video file: ${(videoStats.size / 1024).toFixed(1)} KB`);

          if (videoStats.size === 0) {
            result.success = false;
            result.findings.push('❌ Video file exists but is empty');
          }
        } else {
          result.success = false;
          result.findings.push('❌ Video file missing despite index existing');
        }

      } else {
        result.findings.push('⚠️  No consolidated index found');
      }

    } catch (error) {
      result.success = false;
      result.findings.push(`❌ Index corruption test failed: ${error}`);
      result.evidence.push({ error: String(error) });
    }

    if (result.findings.length === 0) {
      result.findings.push('✅ No index corruption detected');
    }

    this.results.push(result);
  }

  /**
   * Test 4: Search Integration - Check disconnect between search and storage
   */
  private async testSearchIntegration(): Promise<void> {
    console.log('\n🔍 TEST 4: Search Integration');
    console.log('-----------------------------');

    const result: DiagnosticResult = {
      test: 'Search Integration',
      success: true,
      findings: [],
      evidence: [],
      recommendations: []
    };

    try {
      // Test search vs direct retrieval consistency
      const searchResults = await this.memoryManager.query({
        q: 'phase',
        scope: 'committed',
        k: 10
      });

      console.log(`🔍 Search returned ${searchResults.items.length} items for query 'phase'`);

      let searchConsistencyErrors = 0;

      for (const searchItem of searchResults.items) {
        // Try to retrieve the same item directly
        const directItem = await this.memoryManager.get(searchItem.id, 'committed');

        if (!directItem) {
          searchConsistencyErrors++;
          result.findings.push(`❌ Search returned item ${searchItem.id} but direct retrieval failed`);
          result.evidence.push({
            searchInconsistency: {
              itemId: searchItem.id,
              searchResult: searchItem,
              directResult: null
            }
          });
        } else {
          // Check for content consistency
          const consistencyChecks = {
            idMatch: searchItem.id === directItem.id,
            titleMatch: searchItem.title === directItem.title,
            typeMatch: searchItem.type === directItem.type,
            scopeMatch: searchItem.scope === directItem.scope
          };

          const failedChecks = Object.entries(consistencyChecks)
            .filter(([_, passed]) => !passed)
            .map(([check, _]) => check);

          if (failedChecks.length > 0) {
            searchConsistencyErrors++;
            result.findings.push(`⚠️  Search item ${searchItem.id} inconsistent with direct retrieval: ${failedChecks.join(', ')}`);
            result.evidence.push({
              consistencyMismatch: {
                itemId: searchItem.id,
                failedChecks,
                searchItem: {
                  id: searchItem.id,
                  title: searchItem.title,
                  type: searchItem.type,
                  scope: searchItem.scope
                },
                directItem: {
                  id: directItem.id,
                  title: directItem.title,
                  type: directItem.type,
                  scope: directItem.scope
                }
              }
            });
          }
        }
      }

      console.log(`📊 Search consistency: ${searchResults.items.length - searchConsistencyErrors}/${searchResults.items.length} items consistent`);

      result.evidence.push({
        searchStats: {
          totalSearchResults: searchResults.items.length,
          consistencyErrors: searchConsistencyErrors,
          consistencyRate: (searchResults.items.length - searchConsistencyErrors) / Math.max(1, searchResults.items.length)
        }
      });

      if (searchConsistencyErrors > 0) {
        result.success = false;
        result.recommendations.push('Search index may be out of sync with video storage');
      }

      // Test empty search (should return all items)
      const emptySearchResults = await this.memoryManager.query({
        scope: 'committed',
        k: 50
      });

      console.log(`📋 Empty search returned ${emptySearchResults.items.length} items`);

      const catalogItems = await this.memoryManager.list('committed');

      if (emptySearchResults.items.length !== catalogItems.length) {
        result.findings.push(`⚠️  Empty search returned ${emptySearchResults.items.length} items but catalog has ${catalogItems.length}`);
        result.evidence.push({
          countMismatch: {
            searchCount: emptySearchResults.items.length,
            catalogCount: catalogItems.length
          }
        });
      }

    } catch (error) {
      result.success = false;
      result.findings.push(`❌ Search integration test failed: ${error}`);
      result.evidence.push({ error: String(error) });
    }

    if (result.findings.length === 0) {
      result.findings.push('✅ Search integration working correctly');
    }

    this.results.push(result);
  }

  /**
   * Generate comprehensive diagnostic report
   */
  private generateReport(): void {
    console.log('\n📋 DIAGNOSTIC REPORT');
    console.log('===================');

    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    console.log(`📊 Overall Status: ${passedTests}/${totalTests} tests passed`);
    console.log(`${failedTests === 0 ? '✅' : '❌'} System Health: ${failedTests === 0 ? 'HEALTHY' : 'ISSUES DETECTED'}`);

    console.log('\n📝 DETAILED FINDINGS:');
    console.log('---------------------');

    for (const result of this.results) {
      console.log(`\n🔍 ${result.test} - ${result.success ? '✅ PASS' : '❌ FAIL'}`);

      for (const finding of result.findings) {
        console.log(`   ${finding}`);
      }

      if (result.recommendations.length > 0) {
        console.log('   💡 Recommendations:');
        for (const rec of result.recommendations) {
          console.log(`      - ${rec}`);
        }
      }
    }

    console.log('\n🎯 SUMMARY RECOMMENDATIONS:');
    console.log('---------------------------');

    const allRecommendations = this.results.flatMap(r => r.recommendations);
    if (allRecommendations.length === 0) {
      console.log('✅ No issues detected - system appears healthy');
    } else {
      for (const rec of [...new Set(allRecommendations)]) {
        console.log(`• ${rec}`);
      }
    }

    // Save detailed evidence to file
    const evidenceFile = path.join(process.cwd(), 'diagnostic_evidence.json');
    fs.writeJsonSync(evidenceFile, {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests,
        passedTests,
        failedTests,
        overallHealth: failedTests === 0 ? 'HEALTHY' : 'ISSUES_DETECTED'
      },
      results: this.results
    }, { spaces: 2 });

    console.log(`\n💾 Detailed evidence saved to: ${evidenceFile}`);
  }
}

// Run diagnostic if called directly
if (process.argv[1].endsWith('diagnostic_test.ts') || process.argv[1].endsWith('diagnostic_test.js')) {
  const diagnostic = new VideoStorageDiagnostic();
  diagnostic.runFullDiagnostic().catch(console.error);
}

export { VideoStorageDiagnostic };
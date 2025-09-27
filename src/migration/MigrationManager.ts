import type { MemoryItem, MemoryScope, MemoryType, MemoryConfig } from '../types/Memory.js';
import type { StorageAdapter, StorageAdapterFactory } from '../storage/StorageAdapter.js';
import { FileStorageAdapterFactory } from '../storage/FileStorageAdapter.js';
import { ScopeResolver } from '../scope/ScopeResolver.js';

function log(message: string, ...args: any[]) {
  console.error(`[MigrationManager] ${new Date().toISOString()} ${message}`, ...args);
}

// Dynamic import for video storage to avoid startup dependencies
let VideoStorageAdapterFactory: any = null;
async function loadVideoStorageAdapterFactory() {
  if (!VideoStorageAdapterFactory) {
    try {
      log('🔄 Loading VideoStorageAdapterFactory...');
      const videoModule = await import('../storage/VideoStorageAdapter.js');
      VideoStorageAdapterFactory = videoModule.VideoStorageAdapterFactory;
      log('✅ VideoStorageAdapterFactory loaded successfully');
      return VideoStorageAdapterFactory;
    } catch (error) {
      console.warn('[MigrationManager] ❌ Video storage adapter not available:', (error as Error).message);
      return null;
    }
  }
  log('✅ VideoStorageAdapterFactory already cached');
  return VideoStorageAdapterFactory;
}

export type StorageBackend = 'file' | 'video';

export interface MigrationProgress {
  phase: string;
  itemsProcessed: number;
  totalItems: number;
  currentItem?: string;
  errors: Array<{ id: string; error: string }>;
  startTime: Date;
  estimatedCompletion?: Date;
}

export interface StorageMigrationOptions {
  sourceBackend: StorageBackend;
  targetBackend: StorageBackend;
  scope: MemoryScope;
  dryRun?: boolean;
  validateAfterMigration?: boolean;
  backupBeforeMigration?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
}

export interface ScopeMigrationOptions {
  sourceScope: MemoryScope;
  targetScope: MemoryScope;
  contentFilter?: {
    query?: string;
    tags?: string[];
    types?: MemoryType[];
    titlePatterns?: string[];
    contentPatterns?: string[];
    files?: string[];
    dateRange?: { start: string; end: string };
  };
  storageBackend?: StorageBackend;
  dryRun?: boolean;
  validateAfterMigration?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
}

export interface MigrationValidationResult {
  success: boolean;
  sourceItems: number;
  targetItems: number;
  missingItems: string[];
  corruptedItems: string[];
  inconsistencies: Array<{ id: string; issue: string }>;
}

/**
 * MigrationManager handles both storage backend migrations (file ↔ video)
 * and scope migrations (global ↔ local ↔ committed) with intelligent filtering
 */
export class MigrationManager {
  private scopeResolver = new ScopeResolver();
  // Cache for optional video factory to avoid repeated import attempts
  private cachedVideoFactory: StorageAdapterFactory | null | undefined = undefined;

  /**
   * Resolve a storage factory for the requested backend.
   */
  private async getFactory(backend: StorageBackend): Promise<StorageAdapterFactory | null> {
    if (backend === 'file') {
      return new FileStorageAdapterFactory();
    }

    if (backend === 'video') {
      log('🎬 Requesting video storage factory...');
      const VideoFactory = await loadVideoStorageAdapterFactory();
      if (!VideoFactory) {
        throw new Error('Video storage backend is not available. FFmpeg dependencies may not be installed or failed to load.');
      }
      log('🏭 Creating VideoStorageAdapterFactory instance...');
      return new VideoFactory();
    }

    throw new Error(`Unknown storage backend: ${backend}`);
  }

  /**
   * Migrate storage backend (file ↔ video) within the same scope
   */
  async migrateStorageBackend(options: StorageMigrationOptions): Promise<MigrationValidationResult> {
    const {
      sourceBackend,
      targetBackend,
      scope,
      dryRun = false,
      validateAfterMigration = true,
      backupBeforeMigration = true,
      onProgress
    } = options;

    log(`Starting storage migration: ${sourceBackend} → ${targetBackend} for ${scope} scope`);

    // Get directories for source and target
    const sourceDir = this.scopeResolver.getScopeDirectory(scope);
    const targetDir = `${sourceDir}_migration_${Date.now()}`;

    // Initialize storage adapters
    const sourceFactory = await this.getFactory(sourceBackend);
    const targetFactory = await this.getFactory(targetBackend);

    if (!sourceFactory) {
      throw new Error(`${sourceBackend} storage backend is not available (missing dependencies)`);
    }
    if (!targetFactory) {
      throw new Error(`${targetBackend} storage backend is not available (missing dependencies)`);
    }

    log(`📁 Creating source adapter (${sourceBackend}) for: ${sourceDir}`);
    const sourceAdapter = sourceFactory.create(sourceDir, scope);

    log(`📁 Creating target adapter (${targetBackend}) for: ${targetDir}`);
    const targetAdapter = targetFactory.create(targetDir, scope);

    // Initialize adapters to trigger video encoder setup
    if (targetBackend === 'video') {
      log('🎯 Initializing video storage adapter...');
      if (targetAdapter.initialize) {
        await targetAdapter.initialize();
      }
      log('✅ Video storage adapter initialized');
    }

    const progress: MigrationProgress = {
      phase: 'initialization',
      itemsProcessed: 0,
      totalItems: 0,
      errors: [],
      startTime: new Date()
    };

    try {
      // Phase 1: Read source catalog and prepare
      progress.phase = 'reading_source';
      onProgress?.(progress);

      const sourceCatalog = sourceAdapter.readCatalog();
      const sourceItemIds = Object.keys(sourceCatalog);
      progress.totalItems = sourceItemIds.length;

      if (dryRun) {
        log(`DRY RUN: Would migrate ${progress.totalItems} items from ${sourceBackend} to ${targetBackend}`);
        return this.validateMigration(sourceAdapter, targetAdapter, sourceItemIds);
      }

      // Phase 2: Backup if requested
      if (backupBeforeMigration) {
        progress.phase = 'creating_backup';
        onProgress?.(progress);
        await this.createBackup(sourceAdapter, scope, sourceBackend);
      }

      // Phase 3: Migrate items with batching to prevent event loop blocking
      progress.phase = 'migrating_items';
      onProgress?.(progress);

      const batchSize = Number(process.env.LLM_MEMORY_MIGRATION_BATCH_SIZE) || 50;
      const maxProcessingTime = Number(process.env.LLM_MEMORY_MIGRATION_MAX_TIME_MS) || 30000;
      const startTime = Date.now();

      for (let i = 0; i < sourceItemIds.length; i += batchSize) {
        // Check for timeout to prevent long-running operations
        if (Date.now() - startTime > maxProcessingTime) {
          log(`⚠️ Migration timeout reached after ${maxProcessingTime}ms, deferring remaining items`);
          break;
        }

        const batch = sourceItemIds.slice(i, i + batchSize);
        log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sourceItemIds.length / batchSize)} (${batch.length} items)`);

        for (const itemId of batch) {
          progress.currentItem = itemId;
          onProgress?.(progress);

          try {
            const item = await sourceAdapter.readItem(itemId);
            if (item) {
              await targetAdapter.writeItem(item);
              progress.itemsProcessed++;
            } else {
              progress.errors.push({ id: itemId, error: 'Failed to read item from source' });
            }
          } catch (error) {
            progress.errors.push({
              id: itemId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        // Yield control to the event loop between batches
        if (i + batchSize < sourceItemIds.length) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      // Phase 4: Migrate configuration
      progress.phase = 'migrating_config';
      onProgress?.(progress);

      const sourceConfig = sourceAdapter.readConfig();
      const updatedConfig: MemoryConfig = sourceConfig
        ? { ...sourceConfig, storage: { ...(sourceConfig.storage || {}), backend: targetBackend } }
        : { version: '1.0.0', storage: { backend: targetBackend } };

      targetAdapter.writeConfig(updatedConfig);

      // Phase 5: Replace source with target (atomic operation)
      if (progress.errors.length === 0) {
        progress.phase = 'finalizing';
        onProgress?.(progress);

        await this.atomicReplace(sourceDir, targetDir);
      }

      // Phase 6: Validation
      let validationResult: MigrationValidationResult = {
        success: true,
        sourceItems: progress.totalItems,
        targetItems: progress.itemsProcessed,
        missingItems: [],
        corruptedItems: [],
        inconsistencies: []
      };

      if (validateAfterMigration) {
        progress.phase = 'validating';
        onProgress?.(progress);

        const finalFactory = await this.getFactory(targetBackend);
        const finalAdapter = finalFactory?.create(sourceDir, scope);
        if (!finalAdapter) {
          throw new Error(`${targetBackend} storage adapter not available for validation`);
        }
        validationResult = await this.validateMigration(
          null, // Source no longer available after replacement
          finalAdapter,
          sourceItemIds
        );
      }

      progress.phase = 'completed';
      progress.estimatedCompletion = new Date();
      onProgress?.(progress);

      log(`Migration completed: ${progress.itemsProcessed}/${progress.totalItems} items, ${progress.errors.length} errors`);

      return validationResult;

    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate items between scopes with intelligent content filtering
   */
  async migrateBetweenScopes(options: ScopeMigrationOptions): Promise<MigrationValidationResult> {
    const {
      sourceScope,
      targetScope,
      contentFilter,
      storageBackend = 'file',
      dryRun = false,
      validateAfterMigration = true,
      onProgress
    } = options;

    log(`Starting scope migration: ${sourceScope} → ${targetScope} with content filtering`);

    // Get directories and adapters for source and target scopes
    const sourceDir = this.scopeResolver.getScopeDirectory(sourceScope);
    const targetDir = this.scopeResolver.getScopeDirectory(targetScope);

    const factory = await this.getFactory(storageBackend);
    if (!factory) {
      throw new Error(`${storageBackend} storage backend is not available (missing dependencies)`);
    }

    const sourceAdapter = factory.create(sourceDir, sourceScope);
    const targetAdapter = factory.create(targetDir, targetScope);

    const progress: MigrationProgress = {
      phase: 'filtering_items',
      itemsProcessed: 0,
      totalItems: 0,
      errors: [],
      startTime: new Date()
    };

    try {
      // Phase 1: Filter items based on content criteria
      progress.phase = 'filtering_items';
      onProgress?.(progress);

      const sourceCatalog = sourceAdapter.readCatalog();
      const filteredItemIds = await this.filterItemsByContent(
        sourceAdapter,
        Object.keys(sourceCatalog),
        contentFilter
      );

      progress.totalItems = filteredItemIds.length;
      log(`Filtered ${progress.totalItems} items matching criteria from ${Object.keys(sourceCatalog).length} total items`);

      if (dryRun) {
        log(`DRY RUN: Would migrate ${progress.totalItems} filtered items from ${sourceScope} to ${targetScope}`);
        log('Filtered item IDs:', filteredItemIds.slice(0, 10), filteredItemIds.length > 10 ? `... and ${filteredItemIds.length - 10} more` : '');
        return {
          success: true,
          sourceItems: progress.totalItems,
          targetItems: progress.totalItems,
          missingItems: [],
          corruptedItems: [],
          inconsistencies: []
        };
      }

      // Phase 2: Migrate filtered items
      progress.phase = 'migrating_items';
      onProgress?.(progress);

      for (const itemId of filteredItemIds) {
        progress.currentItem = itemId;
        onProgress?.(progress);

        try {
          const item = await sourceAdapter.readItem(itemId);
          if (item) {
            // Update scope in the item
            const migratedItem: MemoryItem = {
              ...item,
              scope: targetScope,
              updatedAt: new Date().toISOString()
            };

            await targetAdapter.writeItem(migratedItem);
            progress.itemsProcessed++;
          } else {
            progress.errors.push({ id: itemId, error: 'Failed to read item from source scope' });
          }
        } catch (error) {
          progress.errors.push({
            id: itemId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Phase 3: Validation
      let validationResult: MigrationValidationResult = {
        success: progress.errors.length === 0,
        sourceItems: progress.totalItems,
        targetItems: progress.itemsProcessed,
        missingItems: [],
        corruptedItems: [],
        inconsistencies: progress.errors.map(e => ({ id: e.id, issue: e.error }))
      };

      if (validateAfterMigration) {
        progress.phase = 'validating';
        onProgress?.(progress);

        validationResult = await this.validateScopeMigration(
          targetAdapter,
          filteredItemIds,
          targetScope
        );
      }

      progress.phase = 'completed';
      progress.estimatedCompletion = new Date();
      onProgress?.(progress);

      log(`Scope migration completed: ${progress.itemsProcessed}/${progress.totalItems} items, ${progress.errors.length} errors`);

      return validationResult;

    } catch (error) {
      console.error('Scope migration failed:', error);
      throw error;
    }
  }

  /**
   * Filter items based on content criteria using intelligent matching
   */
  private async filterItemsByContent(
    adapter: StorageAdapter,
    itemIds: string[],
    filter?: ScopeMigrationOptions['contentFilter']
  ): Promise<string[]> {
    if (!filter) return itemIds;

    const matchingIds: string[] = [];

    for (const itemId of itemIds) {
      try {
        const item = await adapter.readItem(itemId);
        if (!item) continue;

        let matches = true;

        // Type filter
        if (filter.types && filter.types.length > 0) {
          matches &&= filter.types.includes(item.type);
        }

        // Tags filter
        if (filter.tags && filter.tags.length > 0) {
          const itemTags = item.facets?.tags || [];
          matches &&= filter.tags.some(tag => itemTags.includes(tag));
        }

        // Files filter
        if (filter.files && filter.files.length > 0) {
          const itemFiles = item.facets?.files || [];
          matches &&= filter.files.some(file => itemFiles.includes(file));
        }

        // Query filter (searches in title, text, code)
        if (filter.query) {
          const searchText = [
            item.title || '',
            item.text || '',
            item.code || ''
          ].join(' ').toLowerCase();
          matches &&= searchText.includes(filter.query.toLowerCase());
        }

        // Title patterns (regex support)
        if (filter.titlePatterns && filter.titlePatterns.length > 0) {
          const title = item.title || '';
          matches &&= filter.titlePatterns.some(pattern => {
            try {
              return new RegExp(pattern, 'i').test(title);
            } catch {
              return title.toLowerCase().includes(pattern.toLowerCase());
            }
          });
        }

        // Content patterns (regex support)
        if (filter.contentPatterns && filter.contentPatterns.length > 0) {
          const content = [item.text || '', item.code || ''].join(' ');
          matches &&= filter.contentPatterns.some(pattern => {
            try {
              return new RegExp(pattern, 'i').test(content);
            } catch {
              return content.toLowerCase().includes(pattern.toLowerCase());
            }
          });
        }

        // Date range filter
        if (filter.dateRange) {
          const itemDate = new Date(item.createdAt);
          const startDate = new Date(filter.dateRange.start);
          const endDate = new Date(filter.dateRange.end);
          matches &&= itemDate >= startDate && itemDate <= endDate;
        }

        if (matches) {
          matchingIds.push(itemId);
        }
      } catch (error) {
        console.warn(`Error filtering item ${itemId}:`, error);
      }
    }

    return matchingIds;
  }

  /**
   * Create backup of source storage before migration
   */
  private async createBackup(
    sourceAdapter: StorageAdapter,
    scope: MemoryScope,
    backend: StorageBackend
  ): Promise<string> {
    const backupDir = `${this.scopeResolver.getScopeDirectory(scope)}_backup_${Date.now()}_${backend}`;
    const backupFactory = await this.getFactory(backend);
    const backupAdapter = backupFactory?.create(backupDir, scope);
    if (!backupAdapter) {
      throw new Error(`${backend} storage adapter not available for backup`);
    }

    const catalog = sourceAdapter.readCatalog();
    const itemIds = Object.keys(catalog);

    for (const itemId of itemIds) {
      const item = await sourceAdapter.readItem(itemId);
      if (item) {
        await backupAdapter.writeItem(item);
      }
    }

    const config = sourceAdapter.readConfig();
    if (config) {
      backupAdapter.writeConfig(config);
    }

    log(`Backup created at: ${backupDir}`);
    return backupDir;
  }

  /**
   * Atomically replace source directory with target directory
   */
  private async atomicReplace(sourceDir: string, targetDir: string): Promise<void> {
    const tempDir = `${sourceDir}_old_${Date.now()}`;

    // Move source to temp location
    await this.moveDirectory(sourceDir, tempDir);

    try {
      // Move target to source location
      await this.moveDirectory(targetDir, sourceDir);

      // Remove old source
      await this.removeDirectory(tempDir);
    } catch (error) {
      // Rollback on failure
      await this.moveDirectory(tempDir, sourceDir).catch(console.error);
      throw error;
    }
  }

  /**
   * Validate migration results
   */
  private async validateMigration(
    sourceAdapter: StorageAdapter | null,
    targetAdapter: StorageAdapter,
    expectedItemIds: string[]
  ): Promise<MigrationValidationResult> {
    const result: MigrationValidationResult = {
      success: true,
      sourceItems: expectedItemIds.length,
      targetItems: 0,
      missingItems: [],
      corruptedItems: [],
      inconsistencies: []
    };

    try {
      const targetCatalog = targetAdapter.readCatalog();
      const targetItemIds = Object.keys(targetCatalog);
      result.targetItems = targetItemIds.length;

      // Check for missing items
      for (const expectedId of expectedItemIds) {
        if (!targetItemIds.includes(expectedId)) {
          result.missingItems.push(expectedId);
        }
      }

      // Validate item integrity
      for (const itemId of targetItemIds) {
        try {
          const item = await targetAdapter.readItem(itemId);
          if (!item) {
            result.corruptedItems.push(itemId);
          }
        } catch (error) {
          result.corruptedItems.push(itemId);
          result.inconsistencies.push({
            id: itemId,
            issue: `Failed to read: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }

      result.success = result.missingItems.length === 0 && result.corruptedItems.length === 0;

    } catch (error) {
      result.success = false;
      result.inconsistencies.push({
        id: 'validation',
        issue: error instanceof Error ? error.message : String(error)
      });
    }

    return result;
  }

  /**
   * Validate scope migration specifically
   */
  private async validateScopeMigration(
    targetAdapter: StorageAdapter,
    expectedItemIds: string[],
    expectedScope: MemoryScope
  ): Promise<MigrationValidationResult> {
    const result = await this.validateMigration(null, targetAdapter, expectedItemIds);

    // Additional validation: check that all items have correct scope
    for (const itemId of expectedItemIds) {
      try {
        const item = await targetAdapter.readItem(itemId);
        if (item && item.scope !== expectedScope) {
          result.inconsistencies.push({
            id: itemId,
            issue: `Scope mismatch: expected ${expectedScope}, got ${item.scope}`
          });
        }
      } catch (error) {
        result.inconsistencies.push({
          id: itemId,
          issue: `Scope validation failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    return result;
  }

  /**
   * Utility methods for directory operations
   */
  private async moveDirectory(source: string, target: string): Promise<void> {
    const fs = await import('fs-extra');
    await fs.move(source, target);
  }

  private async removeDirectory(dir: string): Promise<void> {
    const fs = await import('fs-extra');
    await fs.remove(dir);
  }

  /**
   * Get migration statistics and status
   */
  async getMigrationStatus(scope: MemoryScope, backend: StorageBackend): Promise<{
    itemCount: number;
    storageSize: number;
    lastMigration?: Date;
    backend: StorageBackend;
  }> {
    const dir = this.scopeResolver.getScopeDirectory(scope);
    const factory = await this.getFactory(backend);

    if (!factory) {
      throw new Error(`${backend} storage backend is not available (missing dependencies)`);
    }

    const adapter = factory.create(dir, scope);

    const stats = await adapter.getStats();
    const catalog = adapter.readCatalog();

    return {
      itemCount: Object.keys(catalog).length,
      storageSize: stats.sizeBytes,
      backend,
      // lastMigration could be stored in metadata
    };
  }
}

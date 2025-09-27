#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as os from 'os';
import { MigrationManager } from '../migration/MigrationManager.js';
import type { MemoryScope, MemoryType } from '../types/Memory.js';
import type {
  StorageBackend,
  StorageMigrationOptions,
  ScopeMigrationOptions,
  MigrationProgress
} from '../migration/MigrationManager.js';

interface CLIMigrationConfig {
  defaultStorageBackend?: StorageBackend;
  defaultScope?: MemoryScope;
  progressUpdateInterval?: number;
  validateByDefault?: boolean;
  backupByDefault?: boolean;
  outputFormat?: 'text' | 'json';
}

class MigrationCLI {
  private migrationManager = new MigrationManager();
  private config: CLIMigrationConfig = {
    defaultStorageBackend: 'file',
    defaultScope: 'local',
    progressUpdateInterval: 1000,
    validateByDefault: true,
    backupByDefault: true,
    outputFormat: 'text'
  };

  constructor() {
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPaths = [
      join(os.homedir(), '.llm-memory', 'migration-config.json'),
      join(process.cwd(), '.llm-memory', 'migration-config.json'),
      join(process.cwd(), 'migration-config.json')
    ];

    for (const configPath of configPaths) {
      if (existsSync(configPath)) {
        try {
          const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
          this.config = { ...this.config, ...fileConfig };
          this.log(`Loaded configuration from ${configPath}`);
          break;
        } catch (error) {
          this.logError(`Error loading config from ${configPath}:`, error);
        }
      }
    }
  }

  private log(message: string, data?: any): void {
    if (this.config.outputFormat === 'json') {
      console.log(JSON.stringify({ type: 'info', message, data, timestamp: new Date().toISOString() }));
    } else {
      console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }

  private logError(message: string, error?: any): void {
    if (this.config.outputFormat === 'json') {
      console.error(JSON.stringify({ type: 'error', message, error: error?.message || error, timestamp: new Date().toISOString() }));
    } else {
      console.error(`[ERROR] ${message}`, error);
    }
  }

  private logProgress(progress: MigrationProgress): void {
    const percentage = progress.totalItems > 0 ? Math.round((progress.itemsProcessed / progress.totalItems) * 100) : 0;
    const elapsed = Date.now() - progress.startTime.getTime();
    const itemsPerSecond = progress.itemsProcessed / (elapsed / 1000);

    if (this.config.outputFormat === 'json') {
      console.log(JSON.stringify({
        type: 'progress',
        phase: progress.phase,
        percentage,
        itemsProcessed: progress.itemsProcessed,
        totalItems: progress.totalItems,
        currentItem: progress.currentItem,
        errors: progress.errors.length,
        itemsPerSecond: Math.round(itemsPerSecond * 100) / 100,
        timestamp: new Date().toISOString()
      }));
    } else {
      const progressBar = this.createProgressBar(percentage);
      console.log(`\r[${progressBar}] ${percentage}% | ${progress.phase} | ${progress.itemsProcessed}/${progress.totalItems} items | ${Math.round(itemsPerSecond)} items/sec | ${progress.errors.length} errors`);
    }
  }

  private createProgressBar(percentage: number, width: number = 30): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private parseScope(scope: string): MemoryScope {
    if (!['global', 'local', 'committed'].includes(scope)) {
      throw new Error(`Invalid scope: ${scope}. Must be one of: global, local, committed`);
    }
    return scope as MemoryScope;
  }

  private parseStorageBackend(backend: string): StorageBackend {
    if (!['file', 'video'].includes(backend)) {
      throw new Error(`Invalid storage backend: ${backend}. Must be one of: file, video`);
    }
    return backend as StorageBackend;
  }

  private parseMemoryTypes(types: string): MemoryType[] {
    const validTypes: MemoryType[] = ['snippet', 'pattern', 'config', 'insight', 'runbook', 'fact', 'note'];
    const parsed = types.split(',').map(t => t.trim()) as MemoryType[];

    for (const type of parsed) {
      if (!validTypes.includes(type)) {
        throw new Error(`Invalid memory type: ${type}. Must be one of: ${validTypes.join(', ')}`);
      }
    }

    return parsed;
  }

  async migrateStorageBackend(options: {
    sourceBackend: string;
    targetBackend: string;
    scope: string;
    dryRun: boolean;
    noValidate: boolean;
    noBackup: boolean;
  }): Promise<void> {
    try {
      const migrationOptions: StorageMigrationOptions = {
        sourceBackend: this.parseStorageBackend(options.sourceBackend),
        targetBackend: this.parseStorageBackend(options.targetBackend),
        scope: this.parseScope(options.scope),
        dryRun: options.dryRun,
        validateAfterMigration: !options.noValidate && this.config.validateByDefault,
        backupBeforeMigration: !options.noBackup && this.config.backupByDefault,
        onProgress: (progress) => this.logProgress(progress)
      };

      this.log('Starting storage backend migration', {
        from: migrationOptions.sourceBackend,
        to: migrationOptions.targetBackend,
        scope: migrationOptions.scope,
        dryRun: migrationOptions.dryRun
      });

      const result = await this.migrationManager.migrateStorageBackend(migrationOptions);

      this.log('Migration completed', {
        success: result.success,
        sourceItems: result.sourceItems,
        targetItems: result.targetItems,
        missingItems: result.missingItems.length,
        corruptedItems: result.corruptedItems.length,
        inconsistencies: result.inconsistencies.length
      });

      if (!result.success) {
        this.logError('Migration validation failed', result);
        process.exit(1);
      }

    } catch (error) {
      this.logError('Storage migration failed', error);
      process.exit(1);
    }
  }

  async migrateBetweenScopes(options: {
    sourceScope: string;
    targetScope: string;
    storageBackend: string;
    dryRun: boolean;
    noValidate: boolean;
    query?: string;
    tags?: string;
    types?: string;
    titlePatterns?: string;
    contentPatterns?: string;
    files?: string;
    dateStart?: string;
    dateEnd?: string;
  }): Promise<void> {
    try {
      const contentFilter: ScopeMigrationOptions['contentFilter'] = {};

      if (options.query) contentFilter.query = options.query;
      if (options.tags) contentFilter.tags = options.tags.split(',').map(t => t.trim());
      if (options.types) contentFilter.types = this.parseMemoryTypes(options.types);
      if (options.titlePatterns) contentFilter.titlePatterns = options.titlePatterns.split(',').map(t => t.trim());
      if (options.contentPatterns) contentFilter.contentPatterns = options.contentPatterns.split(',').map(t => t.trim());
      if (options.files) contentFilter.files = options.files.split(',').map(f => f.trim());
      if (options.dateStart && options.dateEnd) {
        contentFilter.dateRange = { start: options.dateStart, end: options.dateEnd };
      }

      const migrationOptions: ScopeMigrationOptions = {
        sourceScope: this.parseScope(options.sourceScope),
        targetScope: this.parseScope(options.targetScope),
        storageBackend: this.parseStorageBackend(options.storageBackend),
        contentFilter: Object.keys(contentFilter).length > 0 ? contentFilter : undefined,
        dryRun: options.dryRun,
        validateAfterMigration: !options.noValidate && this.config.validateByDefault,
        onProgress: (progress) => this.logProgress(progress)
      };

      this.log('Starting scope migration', {
        from: migrationOptions.sourceScope,
        to: migrationOptions.targetScope,
        backend: migrationOptions.storageBackend,
        hasFilter: !!migrationOptions.contentFilter,
        dryRun: migrationOptions.dryRun
      });

      if (migrationOptions.contentFilter) {
        this.log('Content filter applied', migrationOptions.contentFilter);
      }

      const result = await this.migrationManager.migrateBetweenScopes(migrationOptions);

      this.log('Scope migration completed', {
        success: result.success,
        sourceItems: result.sourceItems,
        targetItems: result.targetItems,
        missingItems: result.missingItems.length,
        corruptedItems: result.corruptedItems.length,
        inconsistencies: result.inconsistencies.length
      });

      if (!result.success) {
        this.logError('Scope migration validation failed', result);
        process.exit(1);
      }

    } catch (error) {
      this.logError('Scope migration failed', error);
      process.exit(1);
    }
  }

  async showMigrationStatus(options: {
    scope?: string;
    backend?: string;
  }): Promise<void> {
    try {
      const scopes: MemoryScope[] = options.scope ? [this.parseScope(options.scope)] : ['global', 'local', 'committed'];
      const backends: StorageBackend[] = options.backend ? [this.parseStorageBackend(options.backend)] : ['file', 'video'];

      const statuses = [];

      for (const scope of scopes) {
        for (const backend of backends) {
          try {
            const status = await this.migrationManager.getMigrationStatus(scope, backend);
            statuses.push({
              scope,
              backend,
              itemCount: status.itemCount,
              storageSize: status.storageSize,
              lastMigration: status.lastMigration
            });
          } catch (error) {
            statuses.push({
              scope,
              backend,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      if (this.config.outputFormat === 'json') {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        console.log('\n=== Migration Status Report ===\n');
        for (const status of statuses) {
          console.log(`Scope: ${status.scope} | Backend: ${status.backend}`);
          if ('error' in status) {
            console.log(`  ❌ Error: ${status.error}`);
          } else {
            console.log(`  📊 Items: ${status.itemCount}`);
            console.log(`  💾 Size: ${this.formatBytes(status.storageSize)}`);
            if (status.lastMigration) {
              console.log(`  🕐 Last Migration: ${status.lastMigration.toISOString()}`);
            }
          }
          console.log('');
        }
      }

    } catch (error) {
      this.logError('Failed to get migration status', error);
      process.exit(1);
    }
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
  }

  async validateMigration(options: {
    scope: string;
    backend: string;
  }): Promise<void> {
    try {
      this.log('Starting migration validation', {
        scope: options.scope,
        backend: options.backend
      });

      // This would require extending MigrationManager with a standalone validation method
      // For now, we'll show how to get status which includes validation info
      const status = await this.migrationManager.getMigrationStatus(
        this.parseScope(options.scope),
        this.parseStorageBackend(options.backend)
      );

      this.log('Validation completed', {
        scope: options.scope,
        backend: options.backend,
        itemCount: status.itemCount,
        storageSize: status.storageSize
      });

    } catch (error) {
      this.logError('Validation failed', error);
      process.exit(1);
    }
  }

  run(): void {
    const program = new Command();

    program
      .name('llm-memory-migrate')
      .description('LLM Memory Migration CLI - Migrate between storage backends and scopes')
      .version('1.0.0')
      .option('-c, --config <file>', 'Configuration file path')
      .option('-f, --format <format>', 'Output format: text or json', 'text')
      .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.format) {
          this.config.outputFormat = opts.format as 'text' | 'json';
        }
      });

    // Storage Backend Migration Command
    const storageCmd = program
      .command('storage')
      .description('Migrate between storage backends (file ↔ video)')
      .requiredOption('-s, --source <backend>', 'Source storage backend (file|video)')
      .requiredOption('-t, --target <backend>', 'Target storage backend (file|video)')
      .requiredOption('--scope <scope>', 'Memory scope (global|local|committed)')
      .option('-d, --dry-run', 'Show what would be migrated without making changes', false)
      .option('--no-validate', 'Skip validation after migration')
      .option('--no-backup', 'Skip backup before migration')
      .action(async (options) => {
        await this.migrateStorageBackend(options);
      });

    // Scope Migration Command
    const scopeCmd = program
      .command('scope')
      .description('Migrate memories between scopes with content filtering')
      .requiredOption('-s, --source-scope <scope>', 'Source scope (global|local|committed)')
      .requiredOption('-t, --target-scope <scope>', 'Target scope (global|local|committed)')
      .option('-b, --storage-backend <backend>', 'Storage backend to use (file|video)', 'file')
      .option('-d, --dry-run', 'Show what would be migrated without making changes', false)
      .option('--no-validate', 'Skip validation after migration')
      .option('-q, --query <text>', 'Filter by text query in title/content')
      .option('--tags <tags>', 'Filter by tags (comma-separated)')
      .option('--types <types>', 'Filter by memory types (comma-separated: snippet,pattern,config,insight,runbook,fact,note)')
      .option('--title-patterns <patterns>', 'Filter by title regex patterns (comma-separated)')
      .option('--content-patterns <patterns>', 'Filter by content regex patterns (comma-separated)')
      .option('--files <files>', 'Filter by associated files (comma-separated)')
      .option('--date-start <date>', 'Filter by creation date start (ISO format)')
      .option('--date-end <date>', 'Filter by creation date end (ISO format)')
      .action(async (options) => {
        await this.migrateBetweenScopes(options);
      });

    // Status Command
    const statusCmd = program
      .command('status')
      .description('Show migration status and statistics')
      .option('-s, --scope <scope>', 'Specific scope to check (global|local|committed)')
      .option('-b, --backend <backend>', 'Specific backend to check (file|video)')
      .action(async (options) => {
        await this.showMigrationStatus(options);
      });

    // Validation Command
    const validateCmd = program
      .command('validate')
      .description('Validate migration integrity')
      .requiredOption('-s, --scope <scope>', 'Scope to validate (global|local|committed)')
      .requiredOption('-b, --backend <backend>', 'Backend to validate (file|video)')
      .action(async (options) => {
        await this.validateMigration(options);
      });

    // Add examples to help
    program.addHelpText('after', `
Examples:
  # Migrate from file to video storage in local scope
  $ llm-memory-migrate storage --source file --target video --scope local

  # Dry run of scope migration with content filtering
  $ llm-memory-migrate scope --source-scope local --target-scope committed --dry-run --query "React hooks"

  # Migrate specific memory types between scopes
  $ llm-memory-migrate scope -s global -t local --types "snippet,pattern" --tags "typescript,react"

  # Show migration status for all scopes and backends
  $ llm-memory-migrate status

  # Validate specific scope/backend combination
  $ llm-memory-migrate validate --scope local --backend video

  # Use JSON output format
  $ llm-memory-migrate status --format json

Configuration file (migration-config.json):
{
  "defaultStorageBackend": "file",
  "defaultScope": "local",
  "progressUpdateInterval": 1000,
  "validateByDefault": true,
  "backupByDefault": true,
  "outputFormat": "text"
}

Locations checked for config (in order):
- ~/.llm-memory/migration-config.json
- .llm-memory/migration-config.json
- ./migration-config.json
    `);

    program.parse();
  }
}

// Run CLI if this file is executed directly
// Check if running directly by comparing resolved filenames
const currentFile = fileURLToPath(import.meta.url);
const executedFile = resolve(process.argv[1]);

if (currentFile === executedFile || executedFile.includes('migration-cli')) {
  const cli = new MigrationCLI();
  cli.run();
}

export { MigrationCLI };
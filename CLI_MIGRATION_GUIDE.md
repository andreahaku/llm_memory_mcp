# LLM Memory Migration CLI Guide

This guide provides comprehensive documentation for the LLM Memory Migration CLI tool, which enables seamless migration between storage backends (file ↔ video) and memory scopes (global ↔ local ↔ committed) with intelligent content filtering capabilities.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands Reference](#commands-reference)
- [Configuration](#configuration)
- [Shell Scripts](#shell-scripts)
- [Advanced Usage](#advanced-usage)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

The LLM Memory Migration CLI provides direct command-line access to the MigrationManager system, allowing for:

### Storage Backend Migration
- **File → Video**: Migrate from traditional file storage to video-based QR code storage
- **Video → File**: Migrate from video storage back to file storage
- **Validation**: Integrity checking and corruption detection
- **Backup**: Automatic backup creation before migration

### Scope Migration
- **Cross-scope transfers**: Move memories between global, local, and committed scopes
- **Content filtering**: Intelligent filtering by query, tags, types, patterns, files, and dates
- **Selective migration**: Fine-grained control over what gets migrated
- **Validation**: Ensure proper scope assignment and data integrity

## Installation

### Prerequisites
- Node.js 18+
- pnpm 9+
- LLM Memory MCP package installed

### Install Dependencies
```bash
# Install the commander.js dependency
pnpm install commander@^11.1.0

# Build the project to generate CLI executable
pnpm build
```

### CLI Access Methods

#### Method 1: Package Scripts (Recommended for development)
```bash
pnpm run migrate:storage    # Storage backend migration
pnpm run migrate:scope      # Scope migration
pnpm run migrate:status     # Status checking
pnpm run migrate:validate   # Validation
```

#### Method 2: Direct Binary (After npm install -g)
```bash
llm-memory-migrate storage --source file --target video --scope local
llm-memory-migrate scope --source-scope global --target-scope local --query "React"
```

#### Method 3: Using tsx (Development)
```bash
tsx src/cli/migration-cli.ts storage --source file --target video --scope local
```

## Quick Start

### 1. Check Current Status
```bash
# Check status of all scopes and backends
pnpm run migrate:status

# Check specific scope and backend
pnpm run migrate:status -- --scope local --backend file
```

### 2. Storage Backend Migration
```bash
# Dry run: See what would be migrated
pnpm run migrate:storage -- \
  --source file \
  --target video \
  --scope local \
  --dry-run

# Actual migration
pnpm run migrate:storage -- \
  --source file \
  --target video \
  --scope local
```

### 3. Scope Migration with Filtering
```bash
# Migrate React-related memories from global to local scope
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope local \
  --query "React" \
  --dry-run
```

### 4. Validation
```bash
# Validate specific scope/backend
pnpm run migrate:validate -- --scope local --backend video

# Use the comprehensive validation script
./scripts/validate-migration.sh
```

## Commands Reference

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <file>` | Configuration file path | Auto-detected |
| `-f, --format <format>` | Output format: text or json | text |
| `--help` | Show help information | - |
| `--version` | Show version number | - |

### Storage Backend Migration

**Command:** `storage`

Migrate between storage backends (file ↔ video) within the same scope.

#### Required Options:
- `-s, --source <backend>` - Source storage backend (file|video)
- `-t, --target <backend>` - Target storage backend (file|video)
- `--scope <scope>` - Memory scope (global|local|committed)

#### Optional Options:
- `-d, --dry-run` - Show what would be migrated without making changes
- `--no-validate` - Skip validation after migration
- `--no-backup` - Skip backup before migration

#### Examples:
```bash
# Migrate from file to video storage in local scope
pnpm run migrate:storage -- \
  --source file \
  --target video \
  --scope local

# Dry run migration with no backup
pnpm run migrate:storage -- \
  --source file \
  --target video \
  --scope global \
  --dry-run \
  --no-backup
```

### Scope Migration

**Command:** `scope`

Migrate memories between scopes with intelligent content filtering.

#### Required Options:
- `-s, --source-scope <scope>` - Source scope (global|local|committed)
- `-t, --target-scope <scope>` - Target scope (global|local|committed)

#### Optional Options:
- `-b, --storage-backend <backend>` - Storage backend to use (file|video) [default: file]
- `-d, --dry-run` - Show what would be migrated without making changes
- `--no-validate` - Skip validation after migration

#### Content Filtering Options:
- `-q, --query <text>` - Filter by text query in title/content
- `--tags <tags>` - Filter by tags (comma-separated)
- `--types <types>` - Filter by memory types (comma-separated)
- `--title-patterns <patterns>` - Filter by title regex patterns (comma-separated)
- `--content-patterns <patterns>` - Filter by content regex patterns (comma-separated)
- `--files <files>` - Filter by associated files (comma-separated)
- `--date-start <date>` - Filter by creation date start (ISO format)
- `--date-end <date>` - Filter by creation date end (ISO format)

#### Memory Types:
- `snippet` - Code snippets
- `pattern` - Design patterns and best practices
- `config` - Configuration examples
- `insight` - Technical insights and learnings
- `runbook` - Operational procedures
- `fact` - Factual information
- `note` - General notes

#### Examples:
```bash
# Migrate all React-related memories
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope local \
  --query "React"

# Migrate specific memory types with tags
pnpm run migrate:scope -- \
  --source-scope local \
  --target-scope committed \
  --types "snippet,pattern" \
  --tags "typescript,react"

# Migrate memories from specific files in a date range
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope local \
  --files "src/components/,src/hooks/" \
  --date-start "2024-01-01" \
  --date-end "2024-12-31"

# Migrate using regex patterns
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope committed \
  --title-patterns "^API.*,.*Hook$" \
  --content-patterns "useState|useEffect"
```

### Status Command

**Command:** `status`

Show migration status and statistics for all or specific scope/backend combinations.

#### Optional Options:
- `-s, --scope <scope>` - Specific scope to check (global|local|committed)
- `-b, --backend <backend>` - Specific backend to check (file|video)

#### Examples:
```bash
# Show status for all scopes and backends
pnpm run migrate:status

# Show status for specific scope
pnpm run migrate:status -- --scope local

# Show status in JSON format
pnpm run migrate:status -- --format json
```

### Validation Command

**Command:** `validate`

Validate migration integrity for a specific scope/backend combination.

#### Required Options:
- `-s, --scope <scope>` - Scope to validate (global|local|committed)
- `-b, --backend <backend>` - Backend to validate (file|video)

#### Examples:
```bash
# Validate specific scope/backend
pnpm run migrate:validate -- --scope local --backend video

# Validate with JSON output
pnpm run migrate:validate -- \
  --scope local \
  --backend video \
  --format json
```

## Configuration

### Configuration File

The CLI automatically searches for configuration files in the following locations (in order):
1. `~/.llm-memory/migration-config.json` (user global)
2. `.llm-memory/migration-config.json` (project specific)
3. `./migration-config.json` (current directory)

### Configuration Schema

```json
{
  "defaultStorageBackend": "file",
  "defaultScope": "local",
  "progressUpdateInterval": 1000,
  "validateByDefault": true,
  "backupByDefault": true,
  "outputFormat": "text"
}
```

#### Configuration Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultStorageBackend` | `"file" \| "video"` | `"file"` | Default storage backend |
| `defaultScope` | `"global" \| "local" \| "committed"` | `"local"` | Default memory scope |
| `progressUpdateInterval` | `number` | `1000` | Progress update interval in milliseconds |
| `validateByDefault` | `boolean` | `true` | Enable validation by default |
| `backupByDefault` | `boolean` | `true` | Enable backup by default |
| `outputFormat` | `"text" \| "json"` | `"text"` | Default output format |

### Example Configuration Files

#### Development Configuration
```json
{
  "defaultStorageBackend": "file",
  "defaultScope": "local",
  "progressUpdateInterval": 500,
  "validateByDefault": true,
  "backupByDefault": true,
  "outputFormat": "text"
}
```

#### Production Configuration
```json
{
  "defaultStorageBackend": "video",
  "defaultScope": "committed",
  "progressUpdateInterval": 2000,
  "validateByDefault": true,
  "backupByDefault": true,
  "outputFormat": "json"
}
```

#### CI/CD Configuration
```json
{
  "progressUpdateInterval": 5000,
  "validateByDefault": false,
  "backupByDefault": false,
  "outputFormat": "json"
}
```

## Shell Scripts

The migration system includes three convenient shell scripts for common operations:

### 1. migrate-to-video.sh

Migrate all storage from file to video format.

```bash
# Basic usage
./scripts/migrate-to-video.sh [scope] [--dry-run]

# Examples
./scripts/migrate-to-video.sh local              # Migrate local scope
./scripts/migrate-to-video.sh global --dry-run   # Dry run for global scope
./scripts/migrate-to-video.sh committed          # Migrate committed scope
```

### 2. migrate-scope-content.sh

Migrate specific content between scopes with filtering.

```bash
# Full usage
./scripts/migrate-scope-content.sh --from <source> --to <target> [options]

# Examples
# Migrate React content from global to local
./scripts/migrate-scope-content.sh --from global --to local --query "React"

# Migrate code snippets with TypeScript tags
./scripts/migrate-scope-content.sh \
  --from local \
  --to committed \
  --types "snippet,pattern" \
  --tags "typescript"

# Dry run with date filtering
./scripts/migrate-scope-content.sh \
  --from global \
  --to local \
  --dry-run \
  --date-start "2024-01-01"
```

### 3. validate-migration.sh

Comprehensive validation of migration integrity.

```bash
# Validate all scopes and backends
./scripts/validate-migration.sh

# Validate specific scope
./scripts/validate-migration.sh local

# Validate specific scope and backend
./scripts/validate-migration.sh local video

# JSON output format
./scripts/validate-migration.sh --format json
./scripts/validate-migration.sh local video --json
```

## Advanced Usage

### Progress Monitoring

The CLI provides detailed progress information during migrations:

#### Text Format Progress
```
[██████████████████████░░░░░░░░] 75% | migrating_items | 750/1000 items | 12.5 items/sec | 3 errors
```

#### JSON Format Progress
```json
{
  "type": "progress",
  "phase": "migrating_items",
  "percentage": 75,
  "itemsProcessed": 750,
  "totalItems": 1000,
  "currentItem": "01H5...",
  "errors": 3,
  "itemsPerSecond": 12.5,
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

### Complex Content Filtering

#### Multi-criteria Filtering
```bash
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope committed \
  --query "API authentication" \
  --types "snippet,pattern,insight" \
  --tags "security,auth,jwt" \
  --title-patterns ".*Auth.*,.*Security.*" \
  --files "src/auth/,src/security/" \
  --date-start "2024-01-01"
```

#### Regex Pattern Examples
```bash
# Find React hooks
--title-patterns "^use[A-Z].*"

# Find API endpoints
--content-patterns "/(api|endpoint)/.*"

# Find configuration files
--files ".*\.config\.(js|ts|json)"
```

### Batch Operations

#### Sequential Migrations
```bash
# Migrate multiple scopes to video
for scope in global local committed; do
  echo "Migrating $scope to video..."
  pnpm run migrate:storage -- \
    --source file \
    --target video \
    --scope "$scope"
done
```

#### Conditional Migration
```bash
# Only migrate if there are items to migrate
STATUS=$(pnpm run migrate:status -- --scope local --backend file --format json)
ITEM_COUNT=$(echo "$STATUS" | jq '.[0].itemCount // 0')

if [ "$ITEM_COUNT" -gt 0 ]; then
  echo "Migrating $ITEM_COUNT items..."
  pnpm run migrate:storage -- \
    --source file \
    --target video \
    --scope local
else
  echo "No items to migrate"
fi
```

### Integration with CI/CD

#### GitHub Actions Example
```yaml
name: Memory Migration
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: pnpm install
      - run: pnpm build

      # Validate before migration
      - run: ./scripts/validate-migration.sh --format json

      # Migrate to video storage if validation passes
      - run: ./scripts/migrate-to-video.sh committed
        if: success()
```

#### Docker Integration
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm build

# Migration entrypoint
ENTRYPOINT ["node", "dist/cli/migration-cli.js"]
CMD ["status"]
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied
```bash
# Error: Permission denied accessing ~/.llm-memory
# Solution: Check directory permissions
chmod 755 ~/.llm-memory
chmod 644 ~/.llm-memory/**/*
```

#### 2. Migration Fails with "Source not found"
```bash
# Check if scope/backend combination exists
pnpm run migrate:status -- --scope local --backend file

# Initialize missing storage if needed
# (This would require additional tooling - not yet implemented)
```

#### 3. Video Encoding/Decoding Issues
```bash
# Ensure FFmpeg is available
ffmpeg -version

# Check video storage configuration
cat .llm-memory/config.json
```

#### 4. Memory/Performance Issues
```bash
# Use smaller batch sizes in configuration
{
  "progressUpdateInterval": 5000,
  "batchSize": 100
}

# Monitor system resources
htop
df -h ~/.llm-memory
```

### Debugging Options

#### Enable Verbose Logging
```bash
DEBUG=llm-memory:migration pnpm run migrate:storage -- \
  --source file \
  --target video \
  --scope local
```

#### Dry Run Analysis
```bash
# Always test with dry run first
pnpm run migrate:scope -- \
  --source-scope global \
  --target-scope committed \
  --dry-run \
  --query "test"
```

### Recovery Procedures

#### Restore from Backup
```bash
# Backups are created automatically at:
# ~/.llm-memory/{scope}_backup_{timestamp}_{backend}/

# Manual restore (example)
mv ~/.llm-memory/local ~/.llm-memory/local_corrupted
mv ~/.llm-memory/local_backup_1705401234567_file ~/.llm-memory/local
```

#### Repair Corrupted Storage
```bash
# Validate and identify issues
./scripts/validate-migration.sh local file --format json

# Re-run migration with validation enabled
pnpm run migrate:storage -- \
  --source file \
  --target file \
  --scope local \
  --no-backup  # Skip backup for repair operations
```

## Best Practices

### Pre-Migration Checklist
1. **Backup Data**: Always backup before major migrations
2. **Test with Dry Run**: Use `--dry-run` to preview changes
3. **Check Available Space**: Ensure sufficient disk space
4. **Validate Current State**: Run status checks before migration
5. **Stop Active Processes**: Ensure no MCP servers are actively writing

### Migration Planning
1. **Start Small**: Test with a subset of data first
2. **Off-Peak Hours**: Run large migrations during low usage times
3. **Monitor Progress**: Use progress indicators and logging
4. **Verify Results**: Always validate after migration
5. **Document Changes**: Keep records of migration operations

### Content Filtering Best Practices
1. **Use Specific Queries**: More specific filters are more predictable
2. **Test Regex Patterns**: Validate regex patterns before using them
3. **Combine Multiple Filters**: Use AND logic for precise selection
4. **Check Filter Results**: Use dry run to verify filter effectiveness

### Performance Optimization
1. **Batch Operations**: Group similar operations together
2. **Use JSON Output**: More efficient for programmatic processing
3. **Configure Update Intervals**: Adjust progress update frequency
4. **Monitor Resources**: Watch memory and disk usage during migration

### Security Considerations
1. **Sensitive Data**: Review content before cross-scope migration
2. **Access Control**: Ensure proper permissions on storage directories
3. **Backup Security**: Secure backup locations appropriately
4. **Audit Trail**: Keep logs of migration operations

### Maintenance
1. **Regular Validation**: Schedule periodic integrity checks
2. **Cleanup Backups**: Remove old backups to free space
3. **Update Dependencies**: Keep CLI and dependencies up to date
4. **Monitor Storage Growth**: Track storage usage over time

---

## CLI Help Output

For reference, here's the complete help output from the CLI:

```bash
$ llm-memory-migrate --help

Usage: llm-memory-migrate [options] [command]

LLM Memory Migration CLI - Migrate between storage backends and scopes

Options:
  -V, --version                 display version number
  -c, --config <file>          Configuration file path
  -f, --format <format>        Output format: text or json (default: "text")
  -h, --help                   display help for command

Commands:
  storage [options]            Migrate between storage backends (file ↔ video)
  scope [options]              Migrate memories between scopes with content filtering
  status [options]             Show migration status and statistics
  validate [options]           Validate migration integrity
  help [command]               display help for command

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
```

This comprehensive CLI system provides production-ready migration capabilities with extensive configuration options, robust error handling, and detailed progress reporting.
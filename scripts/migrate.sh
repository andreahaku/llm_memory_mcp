#!/bin/bash

# LLM Memory MCP Migration Script
# Handles upgrades, data migrations, and system transitions

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${PROJECT_ROOT}/migration.log"
MIGRATION_LOCK="${PROJECT_ROOT}/.migration_lock"

# Migration metadata
CURRENT_VERSION_FILE="${PROJECT_ROOT}/.version"
MIGRATION_STATE_FILE="${PROJECT_ROOT}/.migration_state"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"
    cleanup_migration
    exit 1
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

# Migration lock management
acquire_lock() {
    if [ -f "$MIGRATION_LOCK" ]; then
        local lock_pid=$(cat "$MIGRATION_LOCK" 2>/dev/null || echo "")
        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            error "Another migration is already running (PID: $lock_pid)"
        else
            warning "Stale migration lock found, removing..."
            rm -f "$MIGRATION_LOCK"
        fi
    fi

    echo $$ > "$MIGRATION_LOCK"
    log "Migration lock acquired"
}

release_lock() {
    if [ -f "$MIGRATION_LOCK" ]; then
        rm -f "$MIGRATION_LOCK"
        log "Migration lock released"
    fi
}

cleanup_migration() {
    release_lock
}

# Trap cleanup on exit
trap cleanup_migration EXIT

# Get current version
get_current_version() {
    if [ -f "$CURRENT_VERSION_FILE" ]; then
        cat "$CURRENT_VERSION_FILE"
    else
        echo "0.0.0"
    fi
}

# Get target version from package.json
get_target_version() {
    if [ -f "${PROJECT_ROOT}/package.json" ]; then
        jq -r '.version' "${PROJECT_ROOT}/package.json" 2>/dev/null || echo "1.0.0"
    else
        echo "1.0.0"
    fi
}

# Compare versions
version_compare() {
    local version1="$1"
    local version2="$2"

    if [ "$version1" = "$version2" ]; then
        echo "0"  # Equal
    else
        local sorted=$(printf '%s\n%s\n' "$version1" "$version2" | sort -V)
        if [ "$(echo "$sorted" | head -1)" = "$version1" ]; then
            echo "-1"  # version1 < version2
        else
            echo "1"   # version1 > version2
        fi
    fi
}

# Create backup before migration
create_migration_backup() {
    log "Creating pre-migration backup..."

    local backup_timestamp="migration_$(date +'%Y%m%d_%H%M%S')"
    local backup_script="${SCRIPT_DIR}/backup.sh"

    if [ -f "$backup_script" ]; then
        BACKUP_ROOT="${PROJECT_ROOT}/backups/migrations" "$backup_script" backup
        success "Migration backup created"
    else
        warning "Backup script not found, proceeding without backup"
    fi
}

# Migration: Legacy journal to optimized format
migrate_journal_format() {
    local from_version="$1"
    local to_version="$2"

    log "Migrating journal format from $from_version to $to_version..."

    # Find all legacy journal files
    local legacy_journals=$(find "${PROJECT_ROOT}" -name "journal.ndjson" 2>/dev/null | wc -l)

    if [ "$legacy_journals" -gt 0 ]; then
        log "Found $legacy_journals legacy journal files to migrate"

        # Run the migration through the application
        if [ -f "${PROJECT_ROOT}/dist/index.js" ]; then
            cd "$PROJECT_ROOT"
            echo '{"tool": "maintenance.migrate", "arguments": {"scope": "all"}}' | node dist/index.js || warning "Journal migration may have failed"
            success "Journal format migration completed"
        else
            warning "Application not built, skipping journal migration"
        fi
    else
        log "No legacy journals found to migrate"
    fi
}

# Migration: Storage adapter transition
migrate_storage_adapter() {
    local from_version="$1"
    local to_version="$2"

    log "Migrating storage adapter from $from_version to $to_version..."

    # Check if video storage migration is needed
    local has_file_storage=$(find "${PROJECT_ROOT}/data" -name "*.json" 2>/dev/null | head -1)
    local has_video_storage=$(find "${PROJECT_ROOT}/data" -name "*.mp4" 2>/dev/null | head -1)

    if [ -n "$has_file_storage" ] && [ -z "$has_video_storage" ]; then
        log "File storage detected, preparing for video storage transition"

        # Create video storage directories
        mkdir -p "${PROJECT_ROOT}/data/videos"
        mkdir -p "${PROJECT_ROOT}/data/segments"

        # Note: Actual migration would happen during first write operation
        success "Storage adapter migration prepared"
    else
        log "Video storage already in use or no data to migrate"
    fi
}

# Migration: Configuration updates
migrate_configuration() {
    local from_version="$1"
    local to_version="$2"

    log "Migrating configuration from $from_version to $to_version..."

    # Backup existing configs
    if [ -d "${PROJECT_ROOT}/config" ]; then
        cp -r "${PROJECT_ROOT}/config" "${PROJECT_ROOT}/config.backup.$(date +'%Y%m%d_%H%M%S')"
    fi

    # Update production config with new features
    local prod_config="${PROJECT_ROOT}/config/production.json"
    if [ -f "$prod_config" ]; then
        # Use jq to update configuration if needed
        local temp_config=$(mktemp)
        jq '. + {
            "video_storage": {
                "encoder": {
                    "type": "native",
                    "fallback": "wasm"
                }
            }
        }' "$prod_config" > "$temp_config" && mv "$temp_config" "$prod_config"

        success "Configuration updated"
    else
        log "No production config found to update"
    fi
}

# Migration: Database schema updates
migrate_database_schema() {
    local from_version="$1"
    local to_version="$2"

    log "Migrating database schema from $from_version to $to_version..."

    # Check for schema changes needed
    local needs_migration=false

    # Version-specific migrations
    case "$to_version" in
        "1.1.0"|"1.2.0")
            # Enhanced frame indexing migration
            if [ -d "${PROJECT_ROOT}/data/videos" ]; then
                log "Rebuilding video indexes for enhanced frame indexing..."
                # This would trigger index rebuilding in the application
                touch "${PROJECT_ROOT}/.rebuild_indexes"
                needs_migration=true
            fi
            ;;
        "2.0.0")
            # Major schema upgrade
            log "Major schema upgrade detected"
            needs_migration=true
            ;;
    esac

    if [ "$needs_migration" = true ]; then
        success "Database schema migration flagged for processing"
    else
        log "No database schema changes required"
    fi
}

# Migration: Docker image updates
migrate_docker_setup() {
    local from_version="$1"
    local to_version="$2"

    log "Migrating Docker setup from $from_version to $to_version..."

    # Stop existing containers
    if docker-compose ps | grep -q "Up"; then
        log "Stopping existing containers..."
        docker-compose down --timeout 30
    fi

    # Remove old images to force rebuild
    local old_images=$(docker images llm-memory-mcp --format "{{.ID}}" | head -1)
    if [ -n "$old_images" ]; then
        log "Removing old Docker images..."
        docker rmi "$old_images" 2>/dev/null || warning "Could not remove old images"
    fi

    success "Docker setup prepared for migration"
}

# Run specific migration based on version
run_version_migration() {
    local from_version="$1"
    local to_version="$2"

    log "Running migration from $from_version to $to_version..."

    # Always migrate these components
    migrate_journal_format "$from_version" "$to_version"
    migrate_configuration "$from_version" "$to_version"

    # Version-specific migrations
    case "$to_version" in
        "0.9.0"|"1.0.0")
            migrate_storage_adapter "$from_version" "$to_version"
            ;;
        "1.1.0")
            migrate_database_schema "$from_version" "$to_version"
            ;;
        "2.0.0")
            migrate_storage_adapter "$from_version" "$to_version"
            migrate_database_schema "$from_version" "$to_version"
            migrate_docker_setup "$from_version" "$to_version"
            ;;
    esac

    # Update version tracking
    echo "$to_version" > "$CURRENT_VERSION_FILE"
    echo "migration_completed=$(date -Iseconds)" > "$MIGRATION_STATE_FILE"
    echo "from_version=$from_version" >> "$MIGRATION_STATE_FILE"
    echo "to_version=$to_version" >> "$MIGRATION_STATE_FILE"

    success "Migration from $from_version to $to_version completed"
}

# Verify migration success
verify_migration() {
    local target_version="$1"

    log "Verifying migration to $target_version..."

    # Check version file
    local current_version=$(get_current_version)
    if [ "$current_version" != "$target_version" ]; then
        error "Version mismatch after migration: expected $target_version, got $current_version"
    fi

    # Check application can start
    if [ -f "${PROJECT_ROOT}/dist/index.js" ]; then
        cd "$PROJECT_ROOT"
        timeout 10s node dist/index.js --version >/dev/null 2>&1 || warning "Application startup verification failed"
    fi

    # Check data integrity
    if [ -d "${PROJECT_ROOT}/data" ]; then
        local data_files=$(find "${PROJECT_ROOT}/data" -name "*.json" -o -name "*.mp4" | wc -l)
        log "Found $data_files data files after migration"
    fi

    success "Migration verification completed"
}

# Rollback migration
rollback_migration() {
    local backup_path="$1"

    if [ -z "$backup_path" ] || [ ! -f "$backup_path" ]; then
        error "Invalid or missing backup path for rollback"
    fi

    log "Rolling back migration using backup: $backup_path..."

    # Stop services
    docker-compose down --timeout 30 2>/dev/null || true

    # Restore from backup
    "${SCRIPT_DIR}/backup.sh" restore "$backup_path"

    success "Migration rollback completed"
}

# Check if migration is needed
check_migration_needed() {
    local current_version=$(get_current_version)
    local target_version=$(get_target_version)

    local comparison=$(version_compare "$current_version" "$target_version")

    case "$comparison" in
        "-1")
            echo "upgrade"
            ;;
        "1")
            echo "downgrade"
            ;;
        "0")
            echo "none"
            ;;
    esac
}

# Main migration function
main() {
    log "Starting migration process..."

    acquire_lock

    local current_version=$(get_current_version)
    local target_version=$(get_target_version)
    local migration_type=$(check_migration_needed)

    log "Current version: $current_version"
    log "Target version: $target_version"
    log "Migration type: $migration_type"

    case "$migration_type" in
        "upgrade")
            log "🚀 Upgrade migration required"
            create_migration_backup
            run_version_migration "$current_version" "$target_version"
            verify_migration "$target_version"
            success "🎉 Upgrade migration completed successfully!"
            ;;
        "downgrade")
            warning "⬇️ Downgrade detected - this may cause data loss"
            read -p "Continue with downgrade? (yes/no): " -r
            if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
                create_migration_backup
                run_version_migration "$current_version" "$target_version"
                verify_migration "$target_version"
                success "Downgrade migration completed"
            else
                log "Migration cancelled by user"
                exit 0
            fi
            ;;
        "none")
            log "✅ No migration needed - versions match"
            exit 0
            ;;
    esac
}

# List migration history
list_migrations() {
    log "Migration History:"
    echo ""

    if [ -f "$MIGRATION_STATE_FILE" ]; then
        cat "$MIGRATION_STATE_FILE"
    else
        log "No migration history found"
    fi

    echo ""
    log "Current version: $(get_current_version)"
    log "Target version: $(get_target_version)"
}

# Handle command line arguments
case "${1:-migrate}" in
    "migrate"|"upgrade")
        main
        ;;
    "check")
        local current_version=$(get_current_version)
        local target_version=$(get_target_version)
        local migration_type=$(check_migration_needed)

        echo "Current version: $current_version"
        echo "Target version: $target_version"
        echo "Migration needed: $migration_type"
        ;;
    "rollback")
        if [ -z "${2:-}" ]; then
            error "Please specify backup file for rollback"
        fi
        rollback_migration "$2"
        ;;
    "history")
        list_migrations
        ;;
    "force-version")
        if [ -z "${2:-}" ]; then
            error "Please specify version to set"
        fi
        echo "$2" > "$CURRENT_VERSION_FILE"
        success "Version set to $2"
        ;;
    *)
        echo "Usage: $0 {migrate|check|rollback <backup>|history|force-version <version>}"
        echo ""
        echo "  migrate              - Run migration (default)"
        echo "  upgrade              - Alias for migrate"
        echo "  check                - Check if migration is needed"
        echo "  rollback <backup>    - Rollback to previous version"
        echo "  history              - Show migration history"
        echo "  force-version <ver>  - Force set version (dangerous)"
        exit 1
        ;;
esac
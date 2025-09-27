#!/bin/bash

# LLM Memory MCP Backup Script
# Comprehensive data backup with compression and integrity verification

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="${BACKUP_ROOT:-${PROJECT_ROOT}/backups}"
LOG_FILE="${PROJECT_ROOT}/backup.log"

# Default settings
COMPRESSION_LEVEL="${COMPRESSION_LEVEL:-6}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
VERIFY_BACKUP="${VERIFY_BACKUP:-true}"
INCREMENTAL="${INCREMENTAL:-false}"

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
    exit 1
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

# Calculate directory size
calculate_size() {
    local dir="$1"
    if [ -d "$dir" ]; then
        du -sh "$dir" | cut -f1
    else
        echo "0B"
    fi
}

# Create backup directory structure
setup_backup_dir() {
    local backup_timestamp="$1"
    local backup_dir="${BACKUP_ROOT}/${backup_timestamp}"

    mkdir -p "$backup_dir"
    mkdir -p "$backup_dir/data"
    mkdir -p "$backup_dir/config"
    mkdir -p "$backup_dir/logs"
    mkdir -p "$backup_dir/metadata"

    echo "$backup_dir"
}

# Create backup manifest
create_manifest() {
    local backup_dir="$1"
    local start_time="$2"
    local end_time="$3"

    local manifest_file="${backup_dir}/metadata/manifest.json"

    cat > "$manifest_file" << EOF
{
  "backup_info": {
    "timestamp": "$(date -Iseconds)",
    "backup_type": "$([ "$INCREMENTAL" = "true" ] && echo "incremental" || echo "full")",
    "start_time": "$start_time",
    "end_time": "$end_time",
    "duration_seconds": $(( $(date -d "$end_time" +%s) - $(date -d "$start_time" +%s) )),
    "compression_level": $COMPRESSION_LEVEL,
    "created_by": "$(whoami)",
    "hostname": "$(hostname)",
    "backup_script_version": "1.0.0"
  },
  "source_info": {
    "project_root": "$PROJECT_ROOT",
    "git_commit": "$(cd "$PROJECT_ROOT" && git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "git_branch": "$(cd "$PROJECT_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
    "git_status": "$(cd "$PROJECT_ROOT" && git status --porcelain 2>/dev/null | wc -l) files modified"
  },
  "backup_contents": {
    "data_directory": "$([ -d "${PROJECT_ROOT}/data" ] && echo "true" || echo "false")",
    "config_directory": "$([ -d "${PROJECT_ROOT}/config" ] && echo "true" || echo "false")",
    "logs_directory": "$([ -d "${PROJECT_ROOT}/logs" ] && echo "true" || echo "false")",
    "docker_state": "$(docker-compose ps --format json 2>/dev/null | jq -r length || echo 0) containers"
  },
  "size_info": {
    "original_data_size": "$(calculate_size "${PROJECT_ROOT}/data")",
    "original_config_size": "$(calculate_size "${PROJECT_ROOT}/config")",
    "original_logs_size": "$(calculate_size "${PROJECT_ROOT}/logs")",
    "backup_size": "$(calculate_size "$backup_dir")"
  }
}
EOF

    echo "$manifest_file"
}

# Backup data directory
backup_data() {
    local backup_dir="$1"
    local source_dir="${PROJECT_ROOT}/data"

    if [ ! -d "$source_dir" ]; then
        warning "Data directory not found: $source_dir"
        return
    fi

    log "Backing up data directory..."

    local data_size=$(calculate_size "$source_dir")
    log "Data directory size: $data_size"

    if [ "$INCREMENTAL" = "true" ] && [ -f "${BACKUP_ROOT}/.last_full_backup" ]; then
        local last_backup=$(cat "${BACKUP_ROOT}/.last_full_backup")
        if [ -d "$last_backup" ]; then
            log "Creating incremental backup from $last_backup"
            rsync -av --link-dest="$last_backup/data" "$source_dir/" "${backup_dir}/data/"
        else
            warning "Last backup directory not found, creating full backup"
            cp -r "$source_dir" "${backup_dir}/"
        fi
    else
        cp -r "$source_dir" "${backup_dir}/"
    fi

    # Compress video files separately for better compression
    if [ -d "${source_dir}/videos" ]; then
        log "Compressing video storage..."
        tar -czf "${backup_dir}/data/videos.tar.gz" -C "${source_dir}" videos/
        rm -rf "${backup_dir}/data/videos"
    fi

    success "Data backup completed"
}

# Backup configuration
backup_config() {
    local backup_dir="$1"
    local source_dir="${PROJECT_ROOT}/config"

    if [ ! -d "$source_dir" ]; then
        warning "Config directory not found: $source_dir"
        return
    fi

    log "Backing up configuration..."

    cp -r "$source_dir" "${backup_dir}/"

    # Also backup important root config files
    for file in docker-compose.yml Dockerfile package.json pnpm-lock.yaml; do
        if [ -f "${PROJECT_ROOT}/$file" ]; then
            cp "${PROJECT_ROOT}/$file" "${backup_dir}/config/"
        fi
    done

    success "Configuration backup completed"
}

# Backup logs
backup_logs() {
    local backup_dir="$1"
    local source_dir="${PROJECT_ROOT}/logs"

    if [ ! -d "$source_dir" ]; then
        warning "Logs directory not found: $source_dir"
        return
    fi

    log "Backing up logs..."

    # Compress logs for better storage efficiency
    tar -czf "${backup_dir}/logs/application_logs.tar.gz" -C "$source_dir" .

    # Also capture current container logs
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null || echo "")
    if [ -n "$container_id" ]; then
        log "Capturing container logs..."
        docker logs "$container_id" > "${backup_dir}/logs/container_logs.txt" 2>&1
    fi

    success "Logs backup completed"
}

# Backup container state
backup_container_state() {
    local backup_dir="$1"

    log "Backing up container state..."

    # Export container configuration
    docker-compose config > "${backup_dir}/metadata/docker-compose.yml" 2>/dev/null || true

    # Capture container status
    docker-compose ps --format json > "${backup_dir}/metadata/containers.json" 2>/dev/null || echo "[]" > "${backup_dir}/metadata/containers.json"

    # Capture image information
    docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}" | grep llm-memory-mcp > "${backup_dir}/metadata/images.txt" 2>/dev/null || true

    success "Container state backup completed"
}

# Verify backup integrity
verify_backup() {
    local backup_dir="$1"

    if [ "$VERIFY_BACKUP" != "true" ]; then
        return
    fi

    log "Verifying backup integrity..."

    # Generate checksums for backup files
    local checksum_file="${backup_dir}/metadata/checksums.sha256"
    find "$backup_dir" -type f -not -path "*/metadata/checksums.sha256" -exec sha256sum {} \; > "$checksum_file"

    # Verify critical files exist
    local critical_files=("metadata/manifest.json")

    for file in "${critical_files[@]}"; do
        if [ ! -f "${backup_dir}/$file" ]; then
            error "Critical backup file missing: $file"
        fi
    done

    # Test archive integrity for compressed files
    find "$backup_dir" -name "*.tar.gz" -exec tar -tzf {} >/dev/null \; 2>&1 || error "Archive integrity check failed"

    success "Backup integrity verified"
}

# Compress backup
compress_backup() {
    local backup_dir="$1"
    local backup_name=$(basename "$backup_dir")

    log "Compressing backup archive..."

    cd "$BACKUP_ROOT"
    tar -czf "${backup_name}.tar.gz" "$backup_name"

    if [ -f "${backup_name}.tar.gz" ]; then
        rm -rf "$backup_name"
        success "Backup compressed to ${backup_name}.tar.gz"
        echo "${BACKUP_ROOT}/${backup_name}.tar.gz"
    else
        error "Failed to create compressed backup"
    fi
}

# Clean old backups
cleanup_old_backups() {
    log "Cleaning up old backups (retention: $RETENTION_DAYS days)..."

    local deleted_count=0
    while IFS= read -r -d '' backup_file; do
        if [ -n "$backup_file" ]; then
            rm -f "$backup_file"
            deleted_count=$((deleted_count + 1))
        fi
    done < <(find "$BACKUP_ROOT" -name "*.tar.gz" -type f -mtime +$RETENTION_DAYS -print0 2>/dev/null)

    if [ $deleted_count -gt 0 ]; then
        success "Cleaned up $deleted_count old backup files"
    else
        log "No old backups to clean up"
    fi
}

# List backups
list_backups() {
    log "Available backups:"
    echo ""

    if [ ! -d "$BACKUP_ROOT" ]; then
        warning "Backup directory does not exist: $BACKUP_ROOT"
        return
    fi

    # List compressed backups
    find "$BACKUP_ROOT" -name "*.tar.gz" -type f -exec ls -lh {} \; 2>/dev/null | \
        awk '{print $5, $6, $7, $8, $9}' | \
        sort -k2,3 || echo "No backups found"
}

# Restore backup
restore_backup() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        error "Backup file not found: $backup_file"
    fi

    log "Restoring backup from $backup_file..."

    # Create temporary restore directory
    local temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # Extract backup
    tar -xzf "$backup_file"

    local backup_name=$(basename "$backup_file" .tar.gz)
    local restore_dir="$temp_dir/$backup_name"

    if [ ! -d "$restore_dir" ]; then
        error "Invalid backup archive structure"
    fi

    # Verify manifest
    if [ ! -f "$restore_dir/metadata/manifest.json" ]; then
        error "Backup manifest not found"
    fi

    log "Backup manifest:"
    cat "$restore_dir/metadata/manifest.json" | jq . || cat "$restore_dir/metadata/manifest.json"

    # Stop current services
    log "Stopping current services..."
    cd "$PROJECT_ROOT"
    docker-compose down

    # Restore data
    if [ -d "$restore_dir/data" ]; then
        log "Restoring data..."
        rm -rf "${PROJECT_ROOT}/data"
        cp -r "$restore_dir/data" "$PROJECT_ROOT/"

        # Decompress video storage if needed
        if [ -f "${PROJECT_ROOT}/data/videos.tar.gz" ]; then
            cd "${PROJECT_ROOT}/data"
            tar -xzf videos.tar.gz
            rm videos.tar.gz
        fi
    fi

    # Restore configuration
    if [ -d "$restore_dir/config" ]; then
        log "Restoring configuration..."
        cp -r "$restore_dir/config/"* "$PROJECT_ROOT/"
    fi

    # Cleanup
    rm -rf "$temp_dir"

    success "Restore completed. Please restart services manually."
}

# Main backup function
main() {
    local backup_timestamp=$(date +'%Y%m%d_%H%M%S')
    local start_time=$(date -Iseconds)

    log "Starting backup process (timestamp: $backup_timestamp)..."

    # Setup backup directory
    local backup_dir=$(setup_backup_dir "$backup_timestamp")
    log "Backup directory: $backup_dir"

    # Perform backup operations
    backup_data "$backup_dir"
    backup_config "$backup_dir"
    backup_logs "$backup_dir"
    backup_container_state "$backup_dir"

    # Create manifest and verify
    local end_time=$(date -Iseconds)
    local manifest_file=$(create_manifest "$backup_dir" "$start_time" "$end_time")
    verify_backup "$backup_dir"

    # Compress and cleanup
    local compressed_backup=$(compress_backup "$backup_dir")

    # Update last backup reference
    if [ "$INCREMENTAL" != "true" ]; then
        echo "$backup_dir" > "${BACKUP_ROOT}/.last_full_backup"
    fi

    cleanup_old_backups

    success "🎉 Backup completed successfully!"
    log "Backup location: $compressed_backup"
    log "Backup size: $(calculate_size "$compressed_backup")"
}

# Handle command line arguments
case "${1:-backup}" in
    "backup")
        main
        ;;
    "list")
        list_backups
        ;;
    "restore")
        if [ -z "${2:-}" ]; then
            error "Please specify backup file to restore"
        fi
        restore_backup "$2"
        ;;
    "cleanup")
        cleanup_old_backups
        ;;
    *)
        echo "Usage: $0 {backup|list|restore <backup_file>|cleanup}"
        echo ""
        echo "  backup               - Create new backup (default)"
        echo "  list                 - List available backups"
        echo "  restore <file>       - Restore from backup file"
        echo "  cleanup              - Remove old backups"
        echo ""
        echo "Environment variables:"
        echo "  BACKUP_ROOT          - Backup storage location (default: ./backups)"
        echo "  COMPRESSION_LEVEL    - Compression level 1-9 (default: 6)"
        echo "  RETENTION_DAYS       - Days to keep backups (default: 30)"
        echo "  VERIFY_BACKUP        - Verify backup integrity (default: true)"
        echo "  INCREMENTAL          - Create incremental backup (default: false)"
        exit 1
        ;;
esac
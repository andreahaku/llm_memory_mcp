#!/bin/bash

# migrate-scope-content.sh
# Script to migrate specific content between memory scopes with intelligent filtering
# Usage: ./scripts/migrate-scope-content.sh --from <source> --to <target> [options]

set -e

# Default values
SOURCE_SCOPE=""
TARGET_SCOPE=""
STORAGE_BACKEND="file"
DRY_RUN_FLAG=""
FILTER_ARGS=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --from|-f)
            SOURCE_SCOPE="$2"
            shift 2
            ;;
        --to|-t)
            TARGET_SCOPE="$2"
            shift 2
            ;;
        --backend|-b)
            STORAGE_BACKEND="$2"
            shift 2
            ;;
        --dry-run|-d)
            DRY_RUN_FLAG="--dry-run"
            shift
            ;;
        --query|-q)
            FILTER_ARGS="$FILTER_ARGS --query \"$2\""
            shift 2
            ;;
        --tags)
            FILTER_ARGS="$FILTER_ARGS --tags \"$2\""
            shift 2
            ;;
        --types)
            FILTER_ARGS="$FILTER_ARGS --types \"$2\""
            shift 2
            ;;
        --title-patterns)
            FILTER_ARGS="$FILTER_ARGS --title-patterns \"$2\""
            shift 2
            ;;
        --content-patterns)
            FILTER_ARGS="$FILTER_ARGS --content-patterns \"$2\""
            shift 2
            ;;
        --files)
            FILTER_ARGS="$FILTER_ARGS --files \"$2\""
            shift 2
            ;;
        --date-start)
            FILTER_ARGS="$FILTER_ARGS --date-start \"$2\""
            shift 2
            ;;
        --date-end)
            FILTER_ARGS="$FILTER_ARGS --date-end \"$2\""
            shift 2
            ;;
        --help|-h)
            cat << 'EOF'
migrate-scope-content.sh - Migrate specific content between memory scopes

USAGE:
    ./scripts/migrate-scope-content.sh --from <source> --to <target> [options]

REQUIRED ARGUMENTS:
    --from, -f <scope>      Source scope (global|local|committed)
    --to, -t <scope>        Target scope (global|local|committed)

OPTIONS:
    --backend, -b <backend> Storage backend to use (file|video) [default: file]
    --dry-run, -d          Show what would be migrated without making changes
    --query, -q <text>     Filter by text query in title/content
    --tags <tags>          Filter by tags (comma-separated)
    --types <types>        Filter by memory types (comma-separated)
                           Valid types: snippet,pattern,config,insight,runbook,fact,note
    --title-patterns <pat> Filter by title regex patterns (comma-separated)
    --content-patterns <p> Filter by content regex patterns (comma-separated)
    --files <files>        Filter by associated files (comma-separated)
    --date-start <date>    Filter by creation date start (ISO format)
    --date-end <date>      Filter by creation date end (ISO format)
    --help, -h             Show this help message

EXAMPLES:
    # Migrate all React-related memories from global to local scope
    ./scripts/migrate-scope-content.sh --from global --to local --query "React"

    # Migrate code snippets and patterns with TypeScript tags
    ./scripts/migrate-scope-content.sh --from local --to committed --types "snippet,pattern" --tags "typescript"

    # Dry run migration of recent memories
    ./scripts/migrate-scope-content.sh --from global --to local --dry-run --date-start "2024-01-01"

    # Migrate memories related to specific files
    ./scripts/migrate-scope-content.sh --from local --to committed --files "src/components/,src/hooks/"
EOF
            exit 0
            ;;
        *)
            echo "❌ Error: Unknown option '$1'"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$SOURCE_SCOPE" ]]; then
    echo "❌ Error: --from <source> is required"
    exit 1
fi

if [[ -z "$TARGET_SCOPE" ]]; then
    echo "❌ Error: --to <target> is required"
    exit 1
fi

# Validate scopes
if [[ ! "$SOURCE_SCOPE" =~ ^(global|local|committed)$ ]]; then
    echo "❌ Error: Invalid source scope '$SOURCE_SCOPE'. Must be one of: global, local, committed"
    exit 1
fi

if [[ ! "$TARGET_SCOPE" =~ ^(global|local|committed)$ ]]; then
    echo "❌ Error: Invalid target scope '$TARGET_SCOPE'. Must be one of: global, local, committed"
    exit 1
fi

if [[ "$SOURCE_SCOPE" == "$TARGET_SCOPE" ]]; then
    echo "❌ Error: Source and target scopes cannot be the same"
    exit 1
fi

# Validate storage backend
if [[ ! "$STORAGE_BACKEND" =~ ^(file|video)$ ]]; then
    echo "❌ Error: Invalid storage backend '$STORAGE_BACKEND'. Must be one of: file, video"
    exit 1
fi

echo "=== LLM Memory Scope Migration: $SOURCE_SCOPE → $TARGET_SCOPE ==="
echo "Storage backend: $STORAGE_BACKEND"
echo "Dry run: ${DRY_RUN_FLAG:-false}"
if [[ -n "$FILTER_ARGS" ]]; then
    echo "Filters applied: Yes"
else
    echo "Filters applied: None (all content)"
fi
echo

# Check if pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo "❌ Error: pnpm is required but not found in PATH"
    exit 1
fi

# Build the project to ensure CLI is up to date
echo "📦 Building project..."
pnpm build

# Show source status before migration
echo "📊 Source scope status ($SOURCE_SCOPE):"
pnpm run migrate:status -- --scope "$SOURCE_SCOPE" --backend "$STORAGE_BACKEND"

echo "📊 Target scope status ($TARGET_SCOPE) before migration:"
pnpm run migrate:status -- --scope "$TARGET_SCOPE" --backend "$STORAGE_BACKEND"

echo
echo "🔄 Starting scope migration..."

# Build the complete command
MIGRATION_CMD="pnpm run migrate:scope -- --source-scope \"$SOURCE_SCOPE\" --target-scope \"$TARGET_SCOPE\" --storage-backend \"$STORAGE_BACKEND\" $DRY_RUN_FLAG $FILTER_ARGS"

# Execute the migration
echo "Executing: $MIGRATION_CMD"
eval $MIGRATION_CMD

# Show results
if [[ -z "$DRY_RUN_FLAG" ]]; then
    echo
    echo "📊 Target scope status ($TARGET_SCOPE) after migration:"
    pnpm run migrate:status -- --scope "$TARGET_SCOPE" --backend "$STORAGE_BACKEND"

    echo
    echo "✅ Scope migration completed successfully!"
    echo "💡 You can validate the migration with:"
    echo "   pnpm run migrate:validate -- --scope $TARGET_SCOPE --backend $STORAGE_BACKEND"
else
    echo
    echo "✅ Dry run completed successfully!"
    echo "💡 To perform the actual migration, run the same command without --dry-run"
fi
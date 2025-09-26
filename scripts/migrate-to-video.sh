#!/bin/bash

# migrate-to-video.sh
# Script to migrate all storage backends from file to video format
# Usage: ./scripts/migrate-to-video.sh [scope] [--dry-run]

set -e

# Default values
SCOPE="${1:-local}"
DRY_RUN_FLAG=""
if [[ "$2" == "--dry-run" ]]; then
    DRY_RUN_FLAG="--dry-run"
fi

echo "=== LLM Memory Migration: File → Video ==="
echo "Scope: $SCOPE"
echo "Dry run: ${DRY_RUN_FLAG:-false}"
echo

# Validate scope
if [[ ! "$SCOPE" =~ ^(global|local|committed)$ ]]; then
    echo "❌ Error: Invalid scope '$SCOPE'. Must be one of: global, local, committed"
    exit 1
fi

# Check if pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo "❌ Error: pnpm is required but not found in PATH"
    exit 1
fi

# Build the project to ensure CLI is up to date
echo "📦 Building project..."
pnpm build

# Perform the migration
echo "🔄 Starting file → video migration for $SCOPE scope..."
pnpm run migrate:storage -- \
    --source file \
    --target video \
    --scope "$SCOPE" \
    $DRY_RUN_FLAG

# Check migration status after completion
if [[ -z "$DRY_RUN_FLAG" ]]; then
    echo
    echo "📊 Post-migration status:"
    pnpm run migrate:status -- --scope "$SCOPE" --backend video

    echo
    echo "✅ Migration completed successfully!"
    echo "💡 You can now validate the migration with:"
    echo "   pnpm run migrate:validate -- --scope $SCOPE --backend video"
else
    echo
    echo "✅ Dry run completed successfully!"
    echo "💡 To perform the actual migration, run:"
    echo "   ./scripts/migrate-to-video.sh $SCOPE"
fi
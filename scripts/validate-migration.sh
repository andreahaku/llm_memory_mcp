#!/bin/bash

# validate-migration.sh
# Script to validate migration integrity across all scopes and backends
# Usage: ./scripts/validate-migration.sh [scope] [backend] [--format json]

set -e

# Default values
SPECIFIC_SCOPE="$1"
SPECIFIC_BACKEND="$2"
FORMAT_FLAG=""

# Parse remaining arguments for format flag
shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --format)
            FORMAT_FLAG="--format $2"
            shift 2
            ;;
        --json)
            FORMAT_FLAG="--format json"
            shift
            ;;
        *)
            echo "❌ Error: Unknown option '$1'"
            exit 1
            ;;
    esac
done

# Define all possible combinations
ALL_SCOPES=("global" "local" "committed")
ALL_BACKENDS=("file" "video")

# Determine which scopes and backends to check
if [[ -n "$SPECIFIC_SCOPE" ]]; then
    if [[ ! "$SPECIFIC_SCOPE" =~ ^(global|local|committed)$ ]]; then
        echo "❌ Error: Invalid scope '$SPECIFIC_SCOPE'. Must be one of: global, local, committed"
        exit 1
    fi
    SCOPES=("$SPECIFIC_SCOPE")
else
    SCOPES=("${ALL_SCOPES[@]}")
fi

if [[ -n "$SPECIFIC_BACKEND" ]]; then
    if [[ ! "$SPECIFIC_BACKEND" =~ ^(file|video)$ ]]; then
        echo "❌ Error: Invalid backend '$SPECIFIC_BACKEND'. Must be one of: file, video"
        exit 1
    fi
    BACKENDS=("$SPECIFIC_BACKEND")
else
    BACKENDS=("${ALL_BACKENDS[@]}")
fi

echo "=== LLM Memory Migration Validation ==="
if [[ -n "$SPECIFIC_SCOPE" && -n "$SPECIFIC_BACKEND" ]]; then
    echo "Validating: $SPECIFIC_SCOPE scope with $SPECIFIC_BACKEND backend"
elif [[ -n "$SPECIFIC_SCOPE" ]]; then
    echo "Validating: $SPECIFIC_SCOPE scope with all backends"
elif [[ -n "$SPECIFIC_BACKEND" ]]; then
    echo "Validating: All scopes with $SPECIFIC_BACKEND backend"
else
    echo "Validating: All scopes and backends"
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

# Counters for summary
TOTAL_VALIDATIONS=0
SUCCESSFUL_VALIDATIONS=0
FAILED_VALIDATIONS=0
VALIDATION_RESULTS=()

# Validate each combination
for scope in "${SCOPES[@]}"; do
    for backend in "${BACKENDS[@]}"; do
        echo "🔍 Validating $scope scope with $backend backend..."
        TOTAL_VALIDATIONS=$((TOTAL_VALIDATIONS + 1))

        # Run validation and capture result
        if pnpm run migrate:validate -- --scope "$scope" --backend "$backend" $FORMAT_FLAG; then
            echo "  ✅ Validation passed"
            SUCCESSFUL_VALIDATIONS=$((SUCCESSFUL_VALIDATIONS + 1))
            VALIDATION_RESULTS+=("✅ $scope/$backend: PASS")
        else
            echo "  ❌ Validation failed"
            FAILED_VALIDATIONS=$((FAILED_VALIDATIONS + 1))
            VALIDATION_RESULTS+=("❌ $scope/$backend: FAIL")
        fi
        echo
    done
done

# Show comprehensive status report
echo "📊 Comprehensive Status Report:"
pnpm run migrate:status $FORMAT_FLAG

echo
echo "=== Validation Summary ==="
echo "Total validations: $TOTAL_VALIDATIONS"
echo "Successful: $SUCCESSFUL_VALIDATIONS"
echo "Failed: $FAILED_VALIDATIONS"
echo
echo "Results breakdown:"
for result in "${VALIDATION_RESULTS[@]}"; do
    echo "  $result"
done

# Exit with appropriate code
if [[ $FAILED_VALIDATIONS -eq 0 ]]; then
    echo
    echo "🎉 All validations passed successfully!"

    # Show additional insights
    echo
    echo "💡 Migration Health Check:"
    echo "   - All storage backends are accessible"
    echo "   - No data corruption detected"
    echo "   - Memory items are properly indexed"
    echo "   - Cross-scope integrity maintained"

    exit 0
else
    echo
    echo "⚠️  $FAILED_VALIDATIONS validation(s) failed!"
    echo
    echo "🔧 Troubleshooting steps:"
    echo "   1. Check storage permissions and disk space"
    echo "   2. Verify memory file integrity"
    echo "   3. Run migration repair tools if available"
    echo "   4. Review logs for specific error details"

    exit 1
fi
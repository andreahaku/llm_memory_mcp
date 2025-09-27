#!/bin/bash

# LLM Memory MCP Production Deployment Script
# Automates deployment with safety checks and rollback capabilities

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOG_FILE="${PROJECT_ROOT}/deploy.log"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

# Check prerequisites
check_prerequisites() {
    log "Checking deployment prerequisites..."

    # Check required commands
    local required_commands=("docker" "docker-compose" "node" "pnpm" "git" "ffmpeg")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            error "$cmd is not installed or not in PATH"
        fi
    done

    # Check Node.js version
    local node_version=$(node -v | cut -d'v' -f2)
    local required_version="18.0.0"
    if ! printf '%s\n%s\n' "$required_version" "$node_version" | sort -V -C; then
        error "Node.js version $node_version is less than required $required_version"
    fi

    # Check pnpm version
    local pnpm_version=$(pnpm -v)
    local required_pnpm="9.0.0"
    if ! printf '%s\n%s\n' "$required_pnpm" "$pnpm_version" | sort -V -C; then
        error "pnpm version $pnpm_version is less than required $required_pnpm"
    fi

    # Check FFmpeg
    if ! ffmpeg -version >/dev/null 2>&1; then
        error "FFmpeg is not properly installed"
    fi

    # Check disk space (require at least 10GB free)
    local available_space=$(df "$PROJECT_ROOT" | awk 'NR==2 {print $4}')
    local required_space=10485760  # 10GB in KB
    if [ "$available_space" -lt "$required_space" ]; then
        error "Insufficient disk space. Required: 10GB, Available: $(($available_space/1024/1024))GB"
    fi

    success "All prerequisites satisfied"
}

# Backup current deployment
backup_deployment() {
    log "Creating deployment backup..."

    local backup_timestamp=$(date +'%Y%m%d_%H%M%S')
    local backup_path="${BACKUP_DIR}/${backup_timestamp}"

    mkdir -p "$backup_path"

    # Backup data directories if they exist
    if [ -d "${PROJECT_ROOT}/data" ]; then
        cp -r "${PROJECT_ROOT}/data" "${backup_path}/"
    fi

    # Backup logs
    if [ -d "${PROJECT_ROOT}/logs" ]; then
        cp -r "${PROJECT_ROOT}/logs" "${backup_path}/"
    fi

    # Backup configuration
    if [ -d "${PROJECT_ROOT}/config" ]; then
        cp -r "${PROJECT_ROOT}/config" "${backup_path}/"
    fi

    # Create backup manifest
    cat > "${backup_path}/manifest.json" << EOF
{
  "backup_timestamp": "${backup_timestamp}",
  "deployment_env": "${DEPLOYMENT_ENV}",
  "git_commit": "$(git rev-parse HEAD)",
  "git_branch": "$(git rev-parse --abbrev-ref HEAD)",
  "node_version": "$(node -v)",
  "created_by": "$(whoami)",
  "backup_path": "${backup_path}"
}
EOF

    success "Backup created at $backup_path"
    echo "$backup_path" > "${PROJECT_ROOT}/.last_backup"
}

# Build application
build_application() {
    log "Building application..."

    cd "$PROJECT_ROOT"

    # Install dependencies
    pnpm install --frozen-lockfile

    # Run type checking
    pnpm run typecheck

    # Run linting
    pnpm run lint

    # Build the application
    pnpm run build

    # Verify build
    if [ ! -f "dist/index.js" ]; then
        error "Build failed - dist/index.js not found"
    fi

    success "Application built successfully"
}

# Run tests
run_tests() {
    log "Running tests..."

    cd "$PROJECT_ROOT"

    # Run comprehensive tests
    if ! pnpm run test:all; then
        error "Tests failed - deployment aborted"
    fi

    success "All tests passed"
}

# Prepare deployment environment
prepare_deployment() {
    log "Preparing deployment environment..."

    # Create necessary directories
    mkdir -p "${PROJECT_ROOT}/data/production"
    mkdir -p "${PROJECT_ROOT}/data/videos"
    mkdir -p "${PROJECT_ROOT}/logs"
    mkdir -p "${PROJECT_ROOT}/monitoring"

    # Set proper permissions
    chmod 755 "${PROJECT_ROOT}/data"
    chmod 755 "${PROJECT_ROOT}/logs"

    # Copy production configuration if not exists
    if [ ! -f "${PROJECT_ROOT}/config/production.json" ]; then
        error "Production configuration not found at config/production.json"
    fi

    success "Deployment environment prepared"
}

# Deploy with Docker
deploy_docker() {
    log "Deploying with Docker..."

    cd "$PROJECT_ROOT"

    # Stop existing containers gracefully
    if docker-compose ps | grep -q "llm-memory-mcp"; then
        log "Stopping existing containers..."
        docker-compose down --timeout 30
    fi

    # Build new image
    docker-compose build --no-cache

    # Start services
    docker-compose up -d

    # Wait for health check
    log "Waiting for health check..."
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:8080/health >/dev/null 2>&1; then
            success "Health check passed"
            break
        fi

        attempt=$((attempt + 1))
        log "Health check attempt $attempt/$max_attempts..."
        sleep 10
    done

    if [ $attempt -eq $max_attempts ]; then
        error "Health check failed after $max_attempts attempts"
    fi

    success "Docker deployment completed"
}

# Verify deployment
verify_deployment() {
    log "Verifying deployment..."

    # Check container status
    if ! docker-compose ps | grep -q "Up"; then
        error "Container is not running"
    fi

    # Check health endpoint
    local health_response=$(curl -s http://localhost:8080/health)
    if [ -z "$health_response" ]; then
        error "Health endpoint not responding"
    fi

    # Check metrics endpoint
    if ! curl -s http://localhost:9090/metrics >/dev/null 2>&1; then
        warn "Metrics endpoint not responding"
    fi

    # Check logs for errors
    local error_count=$(docker-compose logs --tail=100 | grep -c "ERROR" || true)
    if [ "$error_count" -gt 0 ]; then
        warn "Found $error_count errors in recent logs"
    fi

    success "Deployment verification completed"
}

# Rollback deployment
rollback_deployment() {
    local backup_path="$1"

    log "Rolling back deployment to $backup_path..."

    # Stop current deployment
    docker-compose down --timeout 30

    # Restore data
    if [ -d "${backup_path}/data" ]; then
        rm -rf "${PROJECT_ROOT}/data"
        cp -r "${backup_path}/data" "${PROJECT_ROOT}/"
    fi

    # Restore configuration
    if [ -d "${backup_path}/config" ]; then
        rm -rf "${PROJECT_ROOT}/config"
        cp -r "${backup_path}/config" "${PROJECT_ROOT}/"
    fi

    # Restart with previous configuration
    docker-compose up -d

    success "Rollback completed"
}

# Main deployment function
main() {
    log "Starting LLM Memory MCP deployment (environment: $DEPLOYMENT_ENV)"

    # Trap errors for cleanup
    trap 'error "Deployment failed at line $LINENO"' ERR

    check_prerequisites
    backup_deployment
    build_application
    run_tests
    prepare_deployment
    deploy_docker
    verify_deployment

    success "🎉 Deployment completed successfully!"
    log "Access health check: http://localhost:8080/health"
    log "Access metrics: http://localhost:9090/metrics"
    log "View logs: docker-compose logs -f"
}

# Handle command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "rollback")
        if [ -f "${PROJECT_ROOT}/.last_backup" ]; then
            backup_path=$(cat "${PROJECT_ROOT}/.last_backup")
            if [ -d "$backup_path" ]; then
                rollback_deployment "$backup_path"
            else
                error "Backup directory not found: $backup_path"
            fi
        else
            error "No backup information found"
        fi
        ;;
    "health")
        curl -s http://localhost:8080/health | jq . || echo "Health check failed"
        ;;
    "logs")
        docker-compose logs -f
        ;;
    "stop")
        docker-compose down
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|health|logs|stop}"
        exit 1
        ;;
esac
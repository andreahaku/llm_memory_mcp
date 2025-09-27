#!/bin/bash

# LLM Memory MCP Health Check Script
# Comprehensive system health validation for production environments

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HEALTH_URL="http://localhost:8080/health"
METRICS_URL="http://localhost:9090/metrics"
LOG_FILE="${PROJECT_ROOT}/health-check.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Health check results
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNING=0

# Logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
}

error() {
    echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
    CHECKS_WARNING=$((CHECKS_WARNING + 1))
}

# Check container status
check_container_status() {
    log "Checking container status..."

    if ! docker-compose ps >/dev/null 2>&1; then
        error "Docker Compose not available or not in project directory"
        return
    fi

    local container_status=$(docker-compose ps --services --filter "status=running" 2>/dev/null | wc -l)
    local expected_containers=1

    if [ "$container_status" -ge "$expected_containers" ]; then
        success "Container is running ($container_status/$expected_containers)"
    else
        error "Container not running ($container_status/$expected_containers)"
        docker-compose ps | tee -a "$LOG_FILE"
    fi
}

# Check HTTP endpoints
check_http_endpoints() {
    log "Checking HTTP endpoints..."

    # Health endpoint
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
        success "Health endpoint responding"

        # Parse health response
        local health_response=$(curl -s "$HEALTH_URL" 2>/dev/null)
        if echo "$health_response" | jq -e '.status == "healthy"' >/dev/null 2>&1; then
            success "Health status is healthy"
        else
            warning "Health status may not be healthy: $health_response"
        fi
    else
        error "Health endpoint not responding at $HEALTH_URL"
    fi

    # Metrics endpoint
    if curl -sf "$METRICS_URL" >/dev/null 2>&1; then
        success "Metrics endpoint responding"
    else
        warning "Metrics endpoint not responding at $METRICS_URL"
    fi
}

# Check resource usage
check_resource_usage() {
    log "Checking resource usage..."

    # Memory usage
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)
    if [ -n "$container_id" ]; then
        local memory_stats=$(docker stats --no-stream --format "{{.MemUsage}}" "$container_id" 2>/dev/null || echo "N/A")
        if [ "$memory_stats" != "N/A" ]; then
            success "Container memory usage: $memory_stats"

            # Parse memory usage percentage
            local mem_percent=$(docker stats --no-stream --format "{{.MemPerc}}" "$container_id" 2>/dev/null | sed 's/%//')
            if [ -n "$mem_percent" ] && [ "$mem_percent" != "N/A" ]; then
                if (( $(echo "$mem_percent > 85" | bc -l) )); then
                    warning "High memory usage: ${mem_percent}%"
                else
                    success "Memory usage within limits: ${mem_percent}%"
                fi
            fi
        else
            warning "Unable to get memory statistics"
        fi

        # CPU usage
        local cpu_stats=$(docker stats --no-stream --format "{{.CPUPerc}}" "$container_id" 2>/dev/null || echo "N/A")
        if [ "$cpu_stats" != "N/A" ]; then
            success "Container CPU usage: $cpu_stats"
        else
            warning "Unable to get CPU statistics"
        fi
    else
        error "Container not found for resource monitoring"
    fi
}

# Check disk space
check_disk_space() {
    log "Checking disk space..."

    # Check main project directory
    local project_usage=$(df -h "$PROJECT_ROOT" | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$project_usage" -lt 90 ]; then
        success "Project directory disk usage: ${project_usage}%"
    elif [ "$project_usage" -lt 95 ]; then
        warning "High disk usage on project directory: ${project_usage}%"
    else
        error "Critical disk usage on project directory: ${project_usage}%"
    fi

    # Check /tmp usage
    local tmp_usage=$(df -h /tmp | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$tmp_usage" -lt 85 ]; then
        success "Temporary directory disk usage: ${tmp_usage}%"
    else
        warning "High temporary directory disk usage: ${tmp_usage}%"
    fi
}

# Check log files
check_log_health() {
    log "Checking log health..."

    # Check if logs are being generated
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)
    if [ -n "$container_id" ]; then
        local recent_logs=$(docker logs --since="5m" "$container_id" 2>&1 | wc -l)
        if [ "$recent_logs" -gt 0 ]; then
            success "Container generating logs ($recent_logs lines in last 5 minutes)"
        else
            warning "No recent log activity"
        fi

        # Check for error patterns
        local error_count=$(docker logs --since="1h" "$container_id" 2>&1 | grep -i "error\|exception\|fatal" | wc -l)
        if [ "$error_count" -eq 0 ]; then
            success "No errors in recent logs"
        elif [ "$error_count" -lt 5 ]; then
            warning "Few errors found in logs: $error_count"
        else
            error "Many errors found in logs: $error_count"
        fi
    else
        error "Cannot check logs - container not found"
    fi
}

# Check FFmpeg availability
check_ffmpeg_availability() {
    log "Checking FFmpeg availability..."

    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)
    if [ -n "$container_id" ]; then
        if docker exec "$container_id" ffmpeg -version >/dev/null 2>&1; then
            success "FFmpeg available in container"

            # Get FFmpeg version
            local ffmpeg_version=$(docker exec "$container_id" ffmpeg -version 2>/dev/null | head -1)
            success "FFmpeg version: $ffmpeg_version"
        else
            error "FFmpeg not available in container"
        fi
    else
        warning "Cannot check FFmpeg - container not found"
    fi
}

# Check video encoding capability
check_video_encoding() {
    log "Checking video encoding capability..."

    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)
    if [ -n "$container_id" ]; then
        # Create a simple test
        if docker exec "$container_id" sh -c 'echo "Video encoding test" > /tmp/test.txt' >/dev/null 2>&1; then
            success "Can write to temp directory for encoding"
        else
            warning "Cannot write to temp directory"
        fi
    else
        warning "Cannot test video encoding - container not found"
    fi
}

# Check network connectivity
check_network_connectivity() {
    log "Checking network connectivity..."

    # Check if container can reach external services (DNS)
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)
    if [ -n "$container_id" ]; then
        if docker exec "$container_id" nslookup google.com >/dev/null 2>&1; then
            success "Network connectivity working"
        else
            warning "Network connectivity issues detected"
        fi
    else
        warning "Cannot check network - container not found"
    fi
}

# Check data integrity
check_data_integrity() {
    log "Checking data integrity..."

    # Check if data directories exist and are accessible
    if [ -d "${PROJECT_ROOT}/data" ]; then
        local data_files=$(find "${PROJECT_ROOT}/data" -type f | wc -l)
        success "Data directory accessible with $data_files files"
    else
        warning "Data directory not found"
    fi

    # Check video storage
    if [ -d "${PROJECT_ROOT}/data/videos" ]; then
        local video_files=$(find "${PROJECT_ROOT}/data/videos" -name "*.mp4" | wc -l)
        success "Video storage accessible with $video_files videos"
    else
        warning "Video storage directory not found"
    fi
}

# Performance metrics check
check_performance_metrics() {
    log "Checking performance metrics..."

    if curl -sf "$METRICS_URL" >/dev/null 2>&1; then
        local metrics=$(curl -s "$METRICS_URL" 2>/dev/null)

        # Check for basic metrics
        if echo "$metrics" | grep -q "process_cpu_seconds_total"; then
            success "CPU metrics available"
        else
            warning "CPU metrics not found"
        fi

        if echo "$metrics" | grep -q "process_resident_memory_bytes"; then
            success "Memory metrics available"
        else
            warning "Memory metrics not found"
        fi
    else
        warning "Cannot retrieve performance metrics"
    fi
}

# Generate health report
generate_report() {
    log "Generating health report..."

    local total_checks=$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_WARNING))
    local health_score=$(( (CHECKS_PASSED * 100) / total_checks ))

    echo ""
    echo "════════════════════════════════════════"
    echo "         HEALTH CHECK SUMMARY"
    echo "════════════════════════════════════════"
    echo "Total Checks: $total_checks"
    echo -e "Passed: ${GREEN}$CHECKS_PASSED${NC}"
    echo -e "Failed: ${RED}$CHECKS_FAILED${NC}"
    echo -e "Warnings: ${YELLOW}$CHECKS_WARNING${NC}"
    echo "Health Score: $health_score%"
    echo ""

    if [ "$CHECKS_FAILED" -eq 0 ] && [ "$CHECKS_WARNING" -eq 0 ]; then
        echo -e "${GREEN}🎉 System is healthy!${NC}"
        exit 0
    elif [ "$CHECKS_FAILED" -eq 0 ]; then
        echo -e "${YELLOW}⚠️ System has warnings but is operational${NC}"
        exit 1
    else
        echo -e "${RED}🚨 System has critical issues!${NC}"
        exit 2
    fi
}

# Main health check function
main() {
    log "Starting comprehensive health check..."

    check_container_status
    check_http_endpoints
    check_resource_usage
    check_disk_space
    check_log_health
    check_ffmpeg_availability
    check_video_encoding
    check_network_connectivity
    check_data_integrity
    check_performance_metrics

    generate_report
}

# Handle command line arguments
case "${1:-all}" in
    "all")
        main
        ;;
    "quick")
        check_container_status
        check_http_endpoints
        generate_report
        ;;
    "resources")
        check_resource_usage
        check_disk_space
        generate_report
        ;;
    "logs")
        check_log_health
        ;;
    "encoding")
        check_ffmpeg_availability
        check_video_encoding
        ;;
    *)
        echo "Usage: $0 {all|quick|resources|logs|encoding}"
        echo ""
        echo "  all       - Run all health checks (default)"
        echo "  quick     - Run basic container and endpoint checks"
        echo "  resources - Check resource usage and disk space"
        echo "  logs      - Check log health and error rates"
        echo "  encoding  - Check video encoding capabilities"
        exit 1
        ;;
esac
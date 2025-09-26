#!/bin/bash

# LLM Memory MCP Monitoring Script
# Performance monitoring, alerting, and metrics collection

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${PROJECT_ROOT}/monitoring.log"
METRICS_DIR="${PROJECT_ROOT}/metrics"
ALERTS_FILE="${PROJECT_ROOT}/alerts.log"

# Monitoring settings
MONITORING_INTERVAL="${MONITORING_INTERVAL:-30}"
ALERT_THRESHOLD_CPU="${ALERT_THRESHOLD_CPU:-80}"
ALERT_THRESHOLD_MEMORY="${ALERT_THRESHOLD_MEMORY:-85}"
ALERT_THRESHOLD_DISK="${ALERT_THRESHOLD_DISK:-90}"
ALERT_THRESHOLD_QUEUE="${ALERT_THRESHOLD_QUEUE:-8000}"

# Metrics endpoints
HEALTH_URL="http://localhost:8080/health"
METRICS_URL="http://localhost:9090/metrics"

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
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

alert() {
    local message="$1"
    local severity="${2:-WARNING}"
    local timestamp=$(date -Iseconds)

    echo "[$timestamp] [$severity] $message" | tee -a "$ALERTS_FILE"

    case "$severity" in
        "CRITICAL")
            echo -e "${RED}🚨 CRITICAL: $message${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}⚠️ WARNING: $message${NC}"
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️ INFO: $message${NC}"
            ;;
    esac
}

# Initialize monitoring
init_monitoring() {
    mkdir -p "$METRICS_DIR"
    mkdir -p "${METRICS_DIR}/historical"
    touch "$LOG_FILE"
    touch "$ALERTS_FILE"

    log "Monitoring system initialized"
}

# Get container metrics
get_container_metrics() {
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)

    if [ -z "$container_id" ]; then
        echo '{"error": "container_not_found"}'
        return
    fi

    # Get container stats
    local stats=$(docker stats --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" "$container_id" 2>/dev/null)

    if [ -n "$stats" ]; then
        local cpu_percent=$(echo "$stats" | tail -1 | awk '{print $1}' | sed 's/%//')
        local memory_usage=$(echo "$stats" | tail -1 | awk '{print $2}')
        local memory_percent=$(echo "$stats" | tail -1 | awk '{print $3}' | sed 's/%//')
        local network_io=$(echo "$stats" | tail -1 | awk '{print $4}')
        local disk_io=$(echo "$stats" | tail -1 | awk '{print $5}')

        cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "container_id": "$container_id",
  "cpu_percent": $cpu_percent,
  "memory_usage": "$memory_usage",
  "memory_percent": $memory_percent,
  "network_io": "$network_io",
  "disk_io": "$disk_io"
}
EOF
    else
        echo '{"error": "stats_unavailable"}'
    fi
}

# Get application metrics
get_application_metrics() {
    if curl -sf "$METRICS_URL" >/dev/null 2>&1; then
        local metrics=$(curl -s "$METRICS_URL" 2>/dev/null)

        # Extract key metrics using grep
        local memory_usage=$(echo "$metrics" | grep "process_resident_memory_bytes" | tail -1 | awk '{print $2}' || echo "0")
        local cpu_time=$(echo "$metrics" | grep "process_cpu_seconds_total" | tail -1 | awk '{print $2}' || echo "0")
        local heap_used=$(echo "$metrics" | grep "nodejs_heap_size_used_bytes" | tail -1 | awk '{print $2}' || echo "0")
        local event_loop_lag=$(echo "$metrics" | grep "nodejs_eventloop_lag_seconds" | tail -1 | awk '{print $2}' || echo "0")

        cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "memory_usage_bytes": $memory_usage,
  "cpu_time_seconds": $cpu_time,
  "heap_used_bytes": $heap_used,
  "event_loop_lag_seconds": $event_loop_lag
}
EOF
    else
        echo '{"error": "metrics_unavailable"}'
    fi
}

# Get system metrics
get_system_metrics() {
    local disk_usage=$(df -h "$PROJECT_ROOT" | awk 'NR==2 {print $5}' | sed 's/%//')
    local load_avg=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
    local available_memory=$(free -m | awk 'NR==2 {printf "%.2f", $7/$2*100}')

    cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "disk_usage_percent": $disk_usage,
  "load_average": $load_avg,
  "available_memory_percent": $available_memory
}
EOF
}

# Get video encoding metrics
get_video_metrics() {
    local container_id=$(docker-compose ps -q llm-memory-mcp 2>/dev/null)

    if [ -n "$container_id" ]; then
        # Check encoding queue (if logs contain queue information)
        local queue_size=$(docker logs --since="5m" "$container_id" 2>&1 | grep -o "queue.*[0-9]\+" | tail -1 | grep -o "[0-9]\+" || echo "0")
        local encoding_errors=$(docker logs --since="1h" "$container_id" 2>&1 | grep -i "encoding.*error" | wc -l)
        local videos_processed=$(find "${PROJECT_ROOT}/data/videos" -name "*.mp4" -mmin -60 | wc -l)

        cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "encoding_queue_size": $queue_size,
  "encoding_errors_1h": $encoding_errors,
  "videos_processed_1h": $videos_processed
}
EOF
    else
        echo '{"error": "container_unavailable"}'
    fi
}

# Check health status
check_health() {
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
        local health_response=$(curl -s "$HEALTH_URL" 2>/dev/null)
        echo "$health_response" | jq -c '. + {"timestamp": "'$(date -Iseconds)'"}' 2>/dev/null || echo '{"status": "unknown", "timestamp": "'$(date -Iseconds)'"}'
    else
        echo '{"status": "unhealthy", "timestamp": "'$(date -Iseconds)'", "error": "endpoint_unavailable"}'
    fi
}

# Collect all metrics
collect_metrics() {
    local timestamp=$(date +'%Y%m%d_%H%M%S')
    local metrics_file="${METRICS_DIR}/metrics_${timestamp}.json"

    log "Collecting metrics..."

    # Combine all metrics into one JSON object
    cat << EOF > "$metrics_file"
{
  "collection_time": "$(date -Iseconds)",
  "container": $(get_container_metrics),
  "application": $(get_application_metrics),
  "system": $(get_system_metrics),
  "video_encoding": $(get_video_metrics),
  "health": $(check_health)
}
EOF

    echo "$metrics_file"
}

# Analyze metrics for alerts
analyze_metrics() {
    local metrics_file="$1"

    if [ ! -f "$metrics_file" ]; then
        warning "Metrics file not found: $metrics_file"
        return
    fi

    # Extract values for analysis
    local cpu_percent=$(jq -r '.container.cpu_percent // 0' "$metrics_file" 2>/dev/null)
    local memory_percent=$(jq -r '.container.memory_percent // 0' "$metrics_file" 2>/dev/null)
    local disk_usage=$(jq -r '.system.disk_usage_percent // 0' "$metrics_file" 2>/dev/null)
    local queue_size=$(jq -r '.video_encoding.encoding_queue_size // 0' "$metrics_file" 2>/dev/null)
    local health_status=$(jq -r '.health.status // "unknown"' "$metrics_file" 2>/dev/null)

    # CPU usage alert
    if (( $(echo "$cpu_percent > $ALERT_THRESHOLD_CPU" | bc -l) )); then
        alert "High CPU usage detected: ${cpu_percent}%" "WARNING"
    fi

    # Memory usage alert
    if (( $(echo "$memory_percent > $ALERT_THRESHOLD_MEMORY" | bc -l) )); then
        alert "High memory usage detected: ${memory_percent}%" "WARNING"
    fi

    # Disk usage alert
    if (( $(echo "$disk_usage > $ALERT_THRESHOLD_DISK" | bc -l) )); then
        alert "High disk usage detected: ${disk_usage}%" "CRITICAL"
    fi

    # Queue size alert
    if (( $(echo "$queue_size > $ALERT_THRESHOLD_QUEUE" | bc -l) )); then
        alert "Large encoding queue detected: $queue_size items" "WARNING"
    fi

    # Health status alert
    if [ "$health_status" != "healthy" ]; then
        alert "Application health check failed: $health_status" "CRITICAL"
    fi
}

# Generate performance report
generate_report() {
    local hours="${1:-1}"
    local report_file="${METRICS_DIR}/performance_report_$(date +'%Y%m%d_%H%M%S').html"

    log "Generating performance report for last $hours hours..."

    # Find metrics files from the last N hours
    local since_time=$(date -d "${hours} hours ago" +'%Y%m%d_%H%M%S')
    local metrics_files=$(find "$METRICS_DIR" -name "metrics_*.json" -newer <(touch -t "$since_time" /tmp/ref_time) 2>/dev/null | sort)

    # Generate HTML report
    cat << EOF > "$report_file"
<!DOCTYPE html>
<html>
<head>
    <title>LLM Memory MCP Performance Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric-card { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .alert { background-color: #fff3cd; border-color: #ffeaa7; }
        .critical { background-color: #f8d7da; border-color: #f5c6cb; }
        .healthy { background-color: #d4edda; border-color: #c3e6cb; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>LLM Memory MCP Performance Report</h1>
    <p>Generated: $(date)</p>
    <p>Period: Last $hours hours</p>

    <div class="metric-card">
        <h2>Summary</h2>
        <p>Metrics files analyzed: $(echo "$metrics_files" | wc -l)</p>
        <p>Report period: $(date -d "${hours} hours ago") to $(date)</p>
    </div>

    <div class="metric-card">
        <h2>Recent Alerts</h2>
        <table>
            <tr><th>Timestamp</th><th>Severity</th><th>Message</th></tr>
EOF

    # Add recent alerts to report
    tail -20 "$ALERTS_FILE" 2>/dev/null | while IFS= read -r line; do
        if [ -n "$line" ]; then
            local timestamp=$(echo "$line" | grep -o '\[[^]]*\]' | head -1 | sed 's/\[//;s/\]//')
            local severity=$(echo "$line" | grep -o '\[[^]]*\]' | tail -1 | sed 's/\[//;s/\]//')
            local message=$(echo "$line" | sed 's/\[[^]]*\] \[[^]]*\] //')
            echo "<tr><td>$timestamp</td><td>$severity</td><td>$message</td></tr>" >> "$report_file"
        fi
    done

    cat << EOF >> "$report_file"
        </table>
    </div>

    <div class="metric-card">
        <h2>Performance Metrics</h2>
        <p>Latest metrics collected from: $(ls -t "$METRICS_DIR"/metrics_*.json | head -1 | xargs basename)</p>
    </div>

</body>
</html>
EOF

    success "Performance report generated: $report_file"
    echo "$report_file"
}

# Clean old metrics
cleanup_metrics() {
    local retention_days="${1:-7}"

    log "Cleaning metrics older than $retention_days days..."

    # Move old metrics to historical directory
    find "$METRICS_DIR" -name "metrics_*.json" -mtime +$retention_days -exec mv {} "${METRICS_DIR}/historical/" \; 2>/dev/null || true

    # Compress historical metrics
    find "${METRICS_DIR}/historical" -name "metrics_*.json" -mtime +1 -exec gzip {} \; 2>/dev/null || true

    # Remove very old historical data
    find "${METRICS_DIR}/historical" -name "*.gz" -mtime +30 -delete 2>/dev/null || true

    success "Metrics cleanup completed"
}

# Continuous monitoring loop
monitor_continuous() {
    log "Starting continuous monitoring (interval: ${MONITORING_INTERVAL}s)..."

    init_monitoring

    while true; do
        local metrics_file=$(collect_metrics)
        analyze_metrics "$metrics_file"

        # Clean up old metrics periodically (every hour)
        local current_minute=$(date +%M)
        if [ "$current_minute" = "00" ]; then
            cleanup_metrics
        fi

        log "Metrics collected: $metrics_file"
        sleep "$MONITORING_INTERVAL"
    done
}

# Real-time dashboard
show_dashboard() {
    local refresh_interval="${1:-5}"

    while true; do
        clear
        echo "=========================================="
        echo "   LLM Memory MCP Live Dashboard"
        echo "   $(date)"
        echo "=========================================="
        echo ""

        # Get current metrics
        local metrics_file=$(collect_metrics)

        if [ -f "$metrics_file" ]; then
            echo "Container Status:"
            jq -r '.container | "  CPU: \(.cpu_percent)%  Memory: \(.memory_percent)%  Usage: \(.memory_usage)"' "$metrics_file" 2>/dev/null || echo "  Status: Unknown"
            echo ""

            echo "System Status:"
            jq -r '.system | "  Disk Usage: \(.disk_usage_percent)%  Load: \(.load_average)  Free Memory: \(.available_memory_percent)%"' "$metrics_file" 2>/dev/null || echo "  Status: Unknown"
            echo ""

            echo "Video Encoding:"
            jq -r '.video_encoding | "  Queue Size: \(.encoding_queue_size)  Errors (1h): \(.encoding_errors_1h)  Processed (1h): \(.videos_processed_1h)"' "$metrics_file" 2>/dev/null || echo "  Status: Unknown"
            echo ""

            echo "Health Status:"
            jq -r '.health | "  Status: \(.status)  Last Check: \(.timestamp)"' "$metrics_file" 2>/dev/null || echo "  Status: Unknown"
            echo ""

            echo "Recent Alerts:"
            tail -5 "$ALERTS_FILE" 2>/dev/null | while IFS= read -r line; do
                echo "  $line"
            done
        else
            echo "Unable to collect metrics"
        fi

        echo ""
        echo "Press Ctrl+C to exit"
        echo "Refreshing in ${refresh_interval}s..."

        sleep "$refresh_interval"
    done
}

# Main function
main() {
    init_monitoring
    local metrics_file=$(collect_metrics)
    analyze_metrics "$metrics_file"
    success "Monitoring check completed"
}

# Handle command line arguments
case "${1:-check}" in
    "check")
        main
        ;;
    "continuous")
        monitor_continuous
        ;;
    "dashboard")
        show_dashboard "${2:-5}"
        ;;
    "report")
        generate_report "${2:-24}"
        ;;
    "cleanup")
        cleanup_metrics "${2:-7}"
        ;;
    "alerts")
        tail -20 "$ALERTS_FILE" 2>/dev/null || echo "No alerts found"
        ;;
    *)
        echo "Usage: $0 {check|continuous|dashboard [interval]|report [hours]|cleanup [days]|alerts}"
        echo ""
        echo "  check                 - Run single monitoring check (default)"
        echo "  continuous            - Start continuous monitoring"
        echo "  dashboard [interval]  - Show real-time dashboard (refresh every N seconds)"
        echo "  report [hours]        - Generate performance report for last N hours"
        echo "  cleanup [days]        - Clean metrics older than N days"
        echo "  alerts                - Show recent alerts"
        echo ""
        echo "Environment variables:"
        echo "  MONITORING_INTERVAL   - Monitoring interval in seconds (default: 30)"
        echo "  ALERT_THRESHOLD_CPU   - CPU usage alert threshold (default: 80)"
        echo "  ALERT_THRESHOLD_MEMORY- Memory usage alert threshold (default: 85)"
        echo "  ALERT_THRESHOLD_DISK  - Disk usage alert threshold (default: 90)"
        echo "  ALERT_THRESHOLD_QUEUE - Queue size alert threshold (default: 8000)"
        exit 1
        ;;
esac
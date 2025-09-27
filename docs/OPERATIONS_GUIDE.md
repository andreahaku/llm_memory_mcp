# Operations Manual

**LLM Memory MCP Server - Operations Guide**

This manual provides comprehensive operational procedures for managing the LLM Memory MCP Server in production environments. It covers daily operations, maintenance procedures, troubleshooting, and performance optimization.

---

## Table of Contents

1. [Daily Operations](#daily-operations)
2. [Health Monitoring](#health-monitoring)
3. [Performance Monitoring](#performance-monitoring)
4. [Maintenance Procedures](#maintenance-procedures)
5. [Backup and Recovery](#backup-and-recovery)
6. [Troubleshooting](#troubleshooting)
7. [Performance Optimization](#performance-optimization)
8. [Emergency Procedures](#emergency-procedures)
9. [Security Operations](#security-operations)
10. [Capacity Management](#capacity-management)

---

## Daily Operations

### Morning Health Check

**Automated Health Check**
```bash
# Run comprehensive health check
/opt/llm-memory-mcp/scripts/health-check.js

# Check service status
systemctl status llm-memory-mcp

# Verify overnight operations
grep "$(date --date='yesterday' '+%Y-%m-%d')" /var/log/llm-memory/server.log | grep -i error
```

**System Resource Check**
```bash
# Check disk usage
df -h /var/lib/llm-memory
df -h /var/log/llm-memory
df -h /var/backups/llm-memory

# Check memory usage
free -h
ps aux | grep node | head -5

# Check CPU utilization
top -n 1 -b | head -10
```

**Service Verification**
```bash
# Test MCP server responsiveness
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | nc localhost 3000

# Check search performance
curl -s "http://localhost:9090/metrics" | grep llm_memory_search_duration

# Verify backup completion
ls -la /var/backups/llm-memory/ | head -5
```

### Routine Monitoring Tasks

**Performance Metrics Review**
```bash
# Check search latency trends (last 24 hours)
curl -s "http://localhost:9090/metrics" | grep -E "(search_duration|operations_total)"

# Review compression ratios
grep "compression.*ratio" /var/log/llm-memory/server.log | tail -20

# Check cache hit rates
curl -s "http://localhost:9090/metrics" | grep cache_hit_rate
```

**Error Log Analysis**
```bash
# Check for recent errors
tail -100 /var/log/llm-memory/server.log | grep -i error

# Review warning messages
grep -i warn /var/log/llm-memory/server.log | tail -20

# Analyze failed operations
grep "Tool execution failed" /var/log/llm-memory/server.log | tail -10
```

**Storage Health Check**
```bash
# Verify storage integrity
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all

# Check journal health
node /opt/llm-memory-mcp/dist/index.js journal.stats --scope=all

# Review storage utilization
du -sh /var/lib/llm-memory/*
```

---

## Health Monitoring

### Key Health Indicators

**Service Health Metrics**
- Service uptime and restart frequency
- Response time to health check requests
- Error rate per hour/day
- Resource utilization trends

**Performance Health Metrics**
- Search query latency (p50, p95, p99)
- Memory operation throughput
- Cache hit rates
- Compression ratios achieved

**Storage Health Metrics**
- Journal integrity status
- Storage utilization percentage
- Backup completion status
- Index rebuild frequency

### Health Check Scripts

**Comprehensive Health Monitor**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/health-monitor.sh

set -euo pipefail

LOG_FILE="/var/log/llm-memory/health-check.log"
ALERT_THRESHOLD_ERROR_RATE=0.05  # 5% error rate
ALERT_THRESHOLD_LATENCY_MS=1000  # 1 second
ALERT_THRESHOLD_DISK_USAGE=85    # 85% disk usage

echo "$(date): Starting health check" >> "$LOG_FILE"

# Check service status
if ! systemctl is-active --quiet llm-memory-mcp; then
    echo "CRITICAL: Service is not running" | tee -a "$LOG_FILE"
    exit 2
fi

# Check response time
RESPONSE_TIME=$(curl -w "%{time_total}" -o /dev/null -s http://localhost:8080/health)
RESPONSE_MS=$(echo "$RESPONSE_TIME * 1000" | bc)

if (( $(echo "$RESPONSE_MS > $ALERT_THRESHOLD_LATENCY_MS" | bc -l) )); then
    echo "WARNING: High response time: ${RESPONSE_MS}ms" | tee -a "$LOG_FILE"
fi

# Check disk usage
DISK_USAGE=$(df /var/lib/llm-memory | tail -1 | awk '{print $5}' | sed 's/%//')
if (( DISK_USAGE > ALERT_THRESHOLD_DISK_USAGE )); then
    echo "WARNING: High disk usage: ${DISK_USAGE}%" | tee -a "$LOG_FILE"
fi

# Check error rate (last hour)
HOUR_AGO=$(date -d '1 hour ago' '+%Y-%m-%d %H:%M')
TOTAL_OPS=$(grep -c "Tool called:" /var/log/llm-memory/server.log || echo "0")
ERROR_OPS=$(grep -c "Tool execution failed" /var/log/llm-memory/server.log || echo "0")

if (( TOTAL_OPS > 0 )); then
    ERROR_RATE=$(echo "scale=3; $ERROR_OPS / $TOTAL_OPS" | bc)
    if (( $(echo "$ERROR_RATE > $ALERT_THRESHOLD_ERROR_RATE" | bc -l) )); then
        echo "WARNING: High error rate: ${ERROR_RATE}%" | tee -a "$LOG_FILE"
    fi
fi

echo "$(date): Health check completed successfully" >> "$LOG_FILE"
```

**Storage Health Check**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/storage-health.sh

SCOPE=${1:-"all"}
REPORT_FILE="/var/log/llm-memory/storage-health-$(date +%Y%m%d).log"

echo "Storage Health Check - $(date)" >> "$REPORT_FILE"
echo "Scope: $SCOPE" >> "$REPORT_FILE"
echo "========================================" >> "$REPORT_FILE"

# Run integrity check
echo "Running integrity verification..." >> "$REPORT_FILE"
INTEGRITY_RESULT=$(node /opt/llm-memory-mcp/dist/index.js journal.verify --scope="$SCOPE")
echo "$INTEGRITY_RESULT" >> "$REPORT_FILE"

# Check journal statistics
echo -e "\nJournal Statistics:" >> "$REPORT_FILE"
JOURNAL_STATS=$(node /opt/llm-memory-mcp/dist/index.js journal.stats --scope="$SCOPE")
echo "$JOURNAL_STATS" >> "$REPORT_FILE"

# Check maintenance status
echo -e "\nMaintenance Status:" >> "$REPORT_FILE"
VERIFY_RESULT=$(node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope="$SCOPE")
echo "$VERIFY_RESULT" >> "$REPORT_FILE"

# Extract key metrics
CORRUPTED_COUNT=$(echo "$INTEGRITY_RESULT" | jq -r '.corruptedItems | length' 2>/dev/null || echo "0")
INTEGRITY_SCORE=$(echo "$INTEGRITY_RESULT" | jq -r '.integrityScore' 2>/dev/null || echo "1.0")

if [[ "$CORRUPTED_COUNT" != "0" ]]; then
    echo "ERROR: Found $CORRUPTED_COUNT corrupted items" | tee -a "$REPORT_FILE"
fi

if (( $(echo "$INTEGRITY_SCORE < 0.99" | bc -l) )); then
    echo "WARNING: Low integrity score: $INTEGRITY_SCORE" | tee -a "$REPORT_FILE"
fi

echo "Storage health check completed" >> "$REPORT_FILE"
```

### Alerting Integration

**Prometheus Alert Manager Rules**
```yaml
# /etc/prometheus/rules/llm-memory.yml
groups:
  - name: llm-memory-health
    rules:
      - alert: LLMMemoryServiceDown
        expr: up{job="llm-memory-mcp"} == 0
        for: 1m
        labels:
          severity: critical
          service: llm-memory
        annotations:
          summary: "LLM Memory service is down"
          description: "Service has been unavailable for {{ $for }}"
          runbook_url: "https://docs.company.com/runbooks/llm-memory-down"

      - alert: LLMMemoryHighLatency
        expr: histogram_quantile(0.95, llm_memory_search_duration_seconds) > 1.0
        for: 5m
        labels:
          severity: warning
          service: llm-memory
        annotations:
          summary: "High search latency detected"
          description: "95th percentile latency is {{ $value }}s"

      - alert: LLMMemoryLowCompressionRatio
        expr: llm_memory_compression_ratio < 30
        for: 10m
        labels:
          severity: warning
          service: llm-memory
        annotations:
          summary: "Low compression ratio"
          description: "Compression ratio has dropped to {{ $value }}x"

      - alert: LLMMemoryHighErrorRate
        expr: rate(llm_memory_operations_total{status="error"}[5m]) / rate(llm_memory_operations_total[5m]) > 0.05
        for: 3m
        labels:
          severity: warning
          service: llm-memory
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"
```

---

## Performance Monitoring

### Key Performance Indicators

**Search Performance**
- Average search latency (target: <100ms)
- 95th percentile search latency (target: <200ms)
- Search throughput (queries per second)
- Cache hit rate (target: >80%)

**Storage Performance**
- Memory operation throughput (ops/sec)
- Compression ratio (target: 30-80x)
- Video encoding latency
- Storage utilization efficiency

**System Performance**
- CPU utilization (target: <70% average)
- Memory usage (target: <80% of allocated)
- Disk I/O utilization
- Network throughput

### Performance Monitoring Scripts

**Performance Dashboard**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/performance-dashboard.sh

clear
echo "LLM Memory MCP Server - Performance Dashboard"
echo "=============================================="
echo "Updated: $(date)"
echo

# Service Status
echo "Service Status:"
if systemctl is-active --quiet llm-memory-mcp; then
    echo "  ✅ Service: Running"
    UPTIME=$(systemctl show llm-memory-mcp --property=ActiveEnterTimestamp --value)
    echo "  ⏰ Uptime: $(date -d "$UPTIME" '+%Y-%m-%d %H:%M:%S')"
else
    echo "  ❌ Service: Stopped"
fi
echo

# Resource Usage
echo "Resource Usage:"
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
echo "  🖥️  CPU: ${CPU_USAGE}%"

MEM_INFO=$(free | grep "Mem:")
MEM_USED=$(echo $MEM_INFO | awk '{printf "%.1f", $3/$2 * 100.0}')
echo "  🧠 Memory: ${MEM_USED}%"

DISK_USAGE=$(df /var/lib/llm-memory | tail -1 | awk '{print $5}')
echo "  💾 Disk: ${DISK_USAGE}"
echo

# Performance Metrics
echo "Performance Metrics:"
if command -v curl >/dev/null && curl -s http://localhost:9090/metrics >/dev/null; then
    # Extract metrics from Prometheus endpoint
    SEARCH_P95=$(curl -s http://localhost:9090/metrics | grep 'llm_memory_search_duration_seconds.*0.95' | awk '{print $2}')
    if [[ -n "$SEARCH_P95" ]]; then
        echo "  🔍 Search P95: $(printf '%.0f' $(echo "$SEARCH_P95 * 1000" | bc))ms"
    fi

    CACHE_HIT_RATE=$(curl -s http://localhost:9090/metrics | grep 'llm_memory_cache_hit_rate' | awk '{print $2}' | head -1)
    if [[ -n "$CACHE_HIT_RATE" ]]; then
        echo "  📊 Cache Hit Rate: $(printf '%.1f' $(echo "$CACHE_HIT_RATE * 100" | bc))%"
    fi

    COMPRESSION_RATIO=$(curl -s http://localhost:9090/metrics | grep 'llm_memory_compression_ratio' | awk '{print $2}' | head -1)
    if [[ -n "$COMPRESSION_RATIO" ]]; then
        echo "  🗜️  Compression: ${COMPRESSION_RATIO}x"
    fi
else
    echo "  ⚠️  Metrics endpoint unavailable"
fi
echo

# Recent Activity
echo "Recent Activity (last 10 operations):"
tail -10 /var/log/llm-memory/server.log | grep "Tool called:" | while read line; do
    TIMESTAMP=$(echo "$line" | cut -d' ' -f1-2)
    OPERATION=$(echo "$line" | grep -o "Tool called: [^[:space:]]*" | cut -d' ' -f3)
    echo "  📝 $TIMESTAMP - $OPERATION"
done
echo

# Error Summary
echo "Error Summary (last 24 hours):"
ERRORS_24H=$(grep "$(date '+%Y-%m-%d')" /var/log/llm-memory/server.log | grep -ci error || echo 0)
WARNINGS_24H=$(grep "$(date '+%Y-%m-%d')" /var/log/llm-memory/server.log | grep -ci warn || echo 0)
echo "  ❌ Errors: $ERRORS_24H"
echo "  ⚠️  Warnings: $WARNINGS_24H"
```

**Performance Benchmark**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/performance-benchmark.sh

ITERATIONS=${1:-50}
SCOPE=${2:-"project"}
RESULTS_FILE="/var/log/llm-memory/benchmark-$(date +%Y%m%d_%H%M%S).json"

echo "Running performance benchmark..."
echo "Iterations: $ITERATIONS"
echo "Scope: $SCOPE"
echo "Results will be saved to: $RESULTS_FILE"

# Create test queries
TEST_QUERIES=(
    "memory management"
    "video encoding"
    "storage compression"
    "search performance"
    "typescript implementation"
)

# Initialize results
cat > "$RESULTS_FILE" << EOF
{
  "benchmark": {
    "timestamp": "$(date -Iseconds)",
    "iterations": $ITERATIONS,
    "scope": "$SCOPE",
    "results": []
  }
}
EOF

TOTAL_TIME=0
SUCCESSFUL_QUERIES=0

for i in $(seq 1 $ITERATIONS); do
    QUERY=${TEST_QUERIES[$((i % ${#TEST_QUERIES[@]}))]}

    START_TIME=$(date +%s%3N)

    # Execute search query
    RESULT=$(node /opt/llm-memory-mcp/dist/index.js memory.query \
        --scope="$SCOPE" \
        --q="$QUERY" \
        --k=20 2>/dev/null)

    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))

    if [[ $? -eq 0 ]]; then
        SUCCESSFUL_QUERIES=$((SUCCESSFUL_QUERIES + 1))
        TOTAL_TIME=$((TOTAL_TIME + DURATION))
        RESULT_COUNT=$(echo "$RESULT" | jq -r '.items | length' 2>/dev/null || echo 0)

        # Append result to file
        jq --argjson duration "$DURATION" \
           --arg query "$QUERY" \
           --argjson results "$RESULT_COUNT" \
           '.benchmark.results += [{"iteration": '$i', "query": $query, "duration_ms": $duration, "result_count": $results}]' \
           "$RESULTS_FILE" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "$RESULTS_FILE"

        echo -n "."
    else
        echo -n "E"
    fi
done

echo

# Calculate statistics
if [[ $SUCCESSFUL_QUERIES -gt 0 ]]; then
    AVG_TIME=$((TOTAL_TIME / SUCCESSFUL_QUERIES))
    SUCCESS_RATE=$(echo "scale=2; $SUCCESSFUL_QUERIES / $ITERATIONS * 100" | bc)

    # Update results file with summary
    jq --argjson avg "$AVG_TIME" \
       --arg success_rate "$SUCCESS_RATE" \
       '.benchmark.summary = {"avg_duration_ms": $avg, "success_rate": $success_rate}' \
       "$RESULTS_FILE" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "$RESULTS_FILE"

    echo "Benchmark completed:"
    echo "  Average response time: ${AVG_TIME}ms"
    echo "  Success rate: ${SUCCESS_RATE}%"
    echo "  Total successful queries: $SUCCESSFUL_QUERIES"
else
    echo "Benchmark failed: No successful queries"
fi
```

---

## Maintenance Procedures

### Scheduled Maintenance

**Daily Maintenance (Automated)**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/daily-maintenance.sh

echo "$(date): Starting daily maintenance" >> /var/log/llm-memory/maintenance.log

# Rotate logs
logrotate /etc/logrotate.d/llm-memory

# Clean up temporary files
find /tmp -name "llm-memory-*" -mtime +1 -delete

# Compact journals if needed
COMPACT_THRESHOLD_MB=100
for SCOPE in global local committed; do
    JOURNAL_SIZE=$(du -m "/var/lib/llm-memory/$SCOPE/journal.ndjson" 2>/dev/null | cut -f1 || echo 0)
    if (( JOURNAL_SIZE > COMPACT_THRESHOLD_MB )); then
        echo "Compacting $SCOPE journal (${JOURNAL_SIZE}MB)" >> /var/log/llm-memory/maintenance.log
        node /opt/llm-memory-mcp/dist/index.js maintenance.compact --scope="$SCOPE"
    fi
done

# Verify storage integrity
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all >> /var/log/llm-memory/maintenance.log

echo "$(date): Daily maintenance completed" >> /var/log/llm-memory/maintenance.log
```

**Weekly Maintenance**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/weekly-maintenance.sh

echo "$(date): Starting weekly maintenance" >> /var/log/llm-memory/maintenance.log

# Full integrity check and rebuild if needed
for SCOPE in global local committed; do
    echo "Checking $SCOPE scope integrity..." >> /var/log/llm-memory/maintenance.log

    INTEGRITY_RESULT=$(node /opt/llm-memory-mcp/dist/index.js journal.verify --scope="$SCOPE")
    INTEGRITY_SCORE=$(echo "$INTEGRITY_RESULT" | jq -r '.integrityScore' 2>/dev/null || echo "1.0")

    if (( $(echo "$INTEGRITY_SCORE < 0.98" | bc -l) )); then
        echo "Low integrity score for $SCOPE: $INTEGRITY_SCORE, rebuilding..." >> /var/log/llm-memory/maintenance.log
        node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope="$SCOPE"
    fi
done

# Optimize storage
echo "Running storage optimization..." >> /var/log/llm-memory/maintenance.log
node /opt/llm-memory-mcp/dist/index.js maintenance.compactSnapshot --scope=all

# Generate performance report
/opt/llm-memory-mcp/scripts/performance-report.sh weekly

echo "$(date): Weekly maintenance completed" >> /var/log/llm-memory/maintenance.log
```

**Monthly Maintenance**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/monthly-maintenance.sh

echo "$(date): Starting monthly maintenance" >> /var/log/llm-memory/maintenance.log

# Archive old logs
find /var/log/llm-memory -name "*.log" -mtime +30 -exec gzip {} \;
find /var/log/llm-memory -name "*.gz" -mtime +90 -delete

# Clean up old backups (keep last 12 months)
find /var/backups/llm-memory -name "llm-memory-backup-*" -mtime +365 -exec rm -rf {} \;

# Update system dependencies (if automated updates are enabled)
if [[ -f /opt/llm-memory-mcp/.auto-update ]]; then
    cd /opt/llm-memory-mcp
    pnpm update
    pnpm run build
    systemctl reload llm-memory-mcp
fi

# Generate comprehensive performance report
/opt/llm-memory-mcp/scripts/performance-report.sh monthly

# Send maintenance summary report
/opt/llm-memory-mcp/scripts/send-maintenance-report.sh

echo "$(date): Monthly maintenance completed" >> /var/log/llm-memory/maintenance.log
```

### Manual Maintenance Procedures

**Index Rebuilding**
```bash
# Rebuild indexes for specific scope
node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=local

# Rebuild all indexes
node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=all

# Rebuild with verification
node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=global
node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope=global
```

**Journal Optimization**
```bash
# Check journal statistics
node /opt/llm-memory-mcp/dist/index.js journal.stats --scope=all

# Migrate to optimized journal format
node /opt/llm-memory-mcp/dist/index.js journal.migrate --scope=all

# Verify optimized journal integrity
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all
```

**Storage Cleanup**
```bash
# Remove orphaned files
find /var/lib/llm-memory -name "*.tmp" -mtime +1 -delete

# Clean up incomplete video segments
find /var/lib/llm-memory -name "segment-*.partial" -mtime +1 -delete

# Verify storage consistency
for SCOPE in global local committed; do
    echo "Checking $SCOPE scope..."
    node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope="$SCOPE"
done
```

---

## Backup and Recovery

### Backup Procedures

**Automated Backup**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/automated-backup.sh

set -euo pipefail

BACKUP_DIR="/var/backups/llm-memory"
DATA_DIR="/var/lib/llm-memory"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="llm-memory-backup-${TIMESTAMP}"
RETENTION_DAYS=30

echo "$(date): Starting automated backup: $BACKUP_NAME"

# Create backup directory
mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"

# Create snapshot to ensure consistency
echo "Creating snapshot..."
node /opt/llm-memory-mcp/dist/index.js maintenance.snapshot --scope=all

# Backup data directory with compression
echo "Backing up data directory..."
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz" \
    --exclude="*.tmp" \
    --exclude="*.lock" \
    -C "${DATA_DIR}" .

# Backup configuration
echo "Backing up configuration..."
if [[ -d /etc/llm-memory ]]; then
    tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/config.tar.gz" -C /etc llm-memory
fi

# Create backup manifest
echo "Generating backup manifest..."
cat > "${BACKUP_DIR}/${BACKUP_NAME}/manifest.json" << EOF
{
  "timestamp": "${TIMESTAMP}",
  "type": "automated",
  "version": "$(node /opt/llm-memory-mcp/dist/index.js --version 2>/dev/null || echo 'unknown')",
  "hostname": "$(hostname)",
  "dataSize": $(du -sb "${DATA_DIR}" | cut -f1),
  "compressedSize": $(stat -c%s "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz"),
  "files": $(find "${DATA_DIR}" -type f | wc -l),
  "checksum": "$(tar -cf - -C "${DATA_DIR}" . | sha256sum | cut -d' ' -f1)",
  "scopes": ["global", "local", "committed"]
}
EOF

# Verify backup integrity
echo "Verifying backup integrity..."
tar -tzf "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz" >/dev/null

# Cleanup old backups
echo "Cleaning up old backups..."
find "${BACKUP_DIR}" -name "llm-memory-backup-*" -mtime +${RETENTION_DAYS} -exec rm -rf {} \;

# Log backup completion
BACKUP_SIZE=$(du -sh "${BACKUP_DIR}/${BACKUP_NAME}" | cut -f1)
echo "$(date): Backup completed successfully: $BACKUP_NAME (${BACKUP_SIZE})"

# Send notification (if configured)
if [[ -x /opt/llm-memory-mcp/scripts/send-notification.sh ]]; then
    /opt/llm-memory-mcp/scripts/send-notification.sh \
        "Backup Completed" \
        "LLM Memory backup $BACKUP_NAME completed successfully (${BACKUP_SIZE})"
fi
```

**Manual Backup**
```bash
# Create manual backup with custom name
BACKUP_NAME="manual-$(date +%Y%m%d_%H%M%S)-$(whoami)"
/opt/llm-memory-mcp/scripts/backup.sh "$BACKUP_NAME"

# Backup specific scope only
SCOPE="local"
tar -czf "/var/backups/llm-memory/scope-${SCOPE}-$(date +%Y%m%d_%H%M%S).tar.gz" \
    -C "/var/lib/llm-memory" "$SCOPE"
```

### Recovery Procedures

**Full System Recovery**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/full-recovery.sh

BACKUP_TIMESTAMP="$1"
BACKUP_DIR="/var/backups/llm-memory"
DATA_DIR="/var/lib/llm-memory"

if [[ -z "$BACKUP_TIMESTAMP" ]]; then
    echo "Usage: $0 <backup-timestamp>"
    echo "Available backups:"
    ls -1 "${BACKUP_DIR}" | grep "llm-memory-backup-" | sort -r | head -10
    exit 1
fi

RESTORE_DIR="${BACKUP_DIR}/llm-memory-backup-${BACKUP_TIMESTAMP}"

if [[ ! -d "$RESTORE_DIR" ]]; then
    echo "Backup not found: $RESTORE_DIR"
    exit 1
fi

echo "Starting full system recovery from: $BACKUP_TIMESTAMP"
echo "WARNING: This will replace all current data!"
read -p "Continue? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Recovery cancelled"
    exit 1
fi

# Stop service
echo "Stopping service..."
systemctl stop llm-memory-mcp

# Backup current data (just in case)
if [[ -d "$DATA_DIR" ]]; then
    echo "Backing up current data..."
    mv "${DATA_DIR}" "${DATA_DIR}.backup-$(date +%Y%m%d_%H%M%S)"
fi

# Restore data
echo "Restoring data directory..."
mkdir -p "${DATA_DIR}"
tar -xzf "${RESTORE_DIR}/data.tar.gz" -C "${DATA_DIR}"

# Restore configuration if available
if [[ -f "${RESTORE_DIR}/config.tar.gz" ]]; then
    echo "Restoring configuration..."
    tar -xzf "${RESTORE_DIR}/config.tar.gz" -C /etc
fi

# Set correct permissions
echo "Setting permissions..."
chown -R llm-memory:llm-memory "${DATA_DIR}"
chmod 750 "${DATA_DIR}"
find "${DATA_DIR}" -type f -exec chmod 640 {} \;

# Verify restoration
echo "Verifying restored data..."
node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope=all

# Start service
echo "Starting service..."
systemctl start llm-memory-mcp

# Wait for service to be ready
sleep 5
if systemctl is-active --quiet llm-memory-mcp; then
    echo "Recovery completed successfully"
    echo "Service is running and ready"
else
    echo "ERROR: Service failed to start after recovery"
    echo "Check logs: journalctl -u llm-memory-mcp -n 50"
    exit 1
fi
```

**Scope-Specific Recovery**
```bash
# Recover specific scope from backup
SCOPE="local"
BACKUP_TIMESTAMP="20241225_120000"
BACKUP_DIR="/var/backups/llm-memory/llm-memory-backup-${BACKUP_TIMESTAMP}"

# Stop service
systemctl stop llm-memory-mcp

# Backup current scope data
mv "/var/lib/llm-memory/$SCOPE" "/var/lib/llm-memory/${SCOPE}.backup-$(date +%Y%m%d_%H%M%S)"

# Extract and restore scope
mkdir -p "/tmp/restore"
tar -xzf "${BACKUP_DIR}/data.tar.gz" -C "/tmp/restore"
mv "/tmp/restore/$SCOPE" "/var/lib/llm-memory/"
rm -rf "/tmp/restore"

# Set permissions
chown -R llm-memory:llm-memory "/var/lib/llm-memory/$SCOPE"

# Verify and start
node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope="$SCOPE"
systemctl start llm-memory-mcp
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Service Startup Failures

**Symptoms:**
- Service exits immediately after startup
- "EADDRINUSE" or permission denied errors
- FFmpeg not found errors

**Diagnosis:**
```bash
# Check service logs
journalctl -u llm-memory-mcp -n 50

# Test manual startup
sudo -u llm-memory node /opt/llm-memory-mcp/dist/index.js --test-mode

# Check permissions
ls -la /var/lib/llm-memory
sudo -u llm-memory touch /var/lib/llm-memory/test-file

# Verify dependencies
which node
which ffmpeg
node --version
ffmpeg -version
```

**Solutions:**
```bash
# Fix permissions
sudo chown -R llm-memory:llm-memory /var/lib/llm-memory
sudo chmod 750 /var/lib/llm-memory

# Install missing dependencies
sudo apt update && sudo apt install ffmpeg  # Ubuntu
brew install ffmpeg  # macOS

# Check port conflicts
netstat -tulpn | grep :3000
```

#### 2. High Memory Usage

**Symptoms:**
- Process memory continuously growing
- Out of memory errors
- System becomes slow or unresponsive

**Diagnosis:**
```bash
# Monitor memory usage over time
watch -n 5 'ps aux | grep node | grep llm-memory'

# Check heap usage
node --inspect /opt/llm-memory-mcp/dist/index.js &
# Connect Chrome DevTools to analyze heap

# Review cache configurations
curl http://localhost:9090/metrics | grep cache_size
```

**Solutions:**
```bash
# Reduce cache sizes
export LLM_MEMORY_CACHE_SIZE_MB=512

# Enable garbage collection logging
node --expose-gc --trace-gc /opt/llm-memory-mcp/dist/index.js

# Restart service to clear memory
systemctl restart llm-memory-mcp

# Adjust Node.js heap size
export NODE_OPTIONS="--max-old-space-size=4096"
```

#### 3. Video Encoding Issues

**Symptoms:**
- Low compression ratios
- "Encoder unavailable" errors
- High CPU usage during encoding

**Diagnosis:**
```bash
# Check FFmpeg capabilities
ffmpeg -encoders | grep h264
ffmpeg -hwaccels

# Test encoding manually
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=30 \
       -c:v libx264 -crf 23 -preset medium test.mp4

# Check hardware acceleration
lspci | grep VGA
nvidia-smi  # For NVIDIA GPUs
```

**Solutions:**
```bash
# Switch to software encoding
export LLM_MEMORY_VIDEO_ENCODER=wasm

# Adjust encoding quality
export LLM_MEMORY_VIDEO_CRF=28  # Lower quality, better compression
export LLM_MEMORY_VIDEO_PRESET=ultrafast  # Faster encoding

# Enable hardware acceleration
export LLM_MEMORY_VIDEO_HWACCEL=auto

# Test different codecs
export LLM_MEMORY_VIDEO_CODEC=h265  # Better compression
```

#### 4. Search Performance Problems

**Symptoms:**
- Search queries taking >1 second
- Timeouts on complex queries
- High CPU during searches

**Diagnosis:**
```bash
# Check index health
node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope=all

# Monitor search performance
tail -f /var/log/llm-memory/server.log | grep "search.*ms"

# Check index sizes
du -sh /var/lib/llm-memory/*/index*
```

**Solutions:**
```bash
# Rebuild indexes
node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=all

# Optimize search parameters
# Edit search configuration to reduce search scope

# Add more memory for caches
export LLM_MEMORY_CACHE_SIZE_MB=2048
```

#### 5. Storage Corruption

**Symptoms:**
- Integrity check failures
- Journal replay errors
- Missing memory items

**Diagnosis:**
```bash
# Run comprehensive integrity check
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all

# Check journal statistics
node /opt/llm-memory-mcp/dist/index.js journal.stats --scope=all

# Examine recent operations
grep -i error /var/log/llm-memory/server.log | tail -20
```

**Solutions:**
```bash
# Rebuild from journal
node /opt/llm-memory-mcp/dist/index.js maintenance.replay --scope=all --compact=true

# Restore from backup if corruption is severe
/opt/llm-memory-mcp/scripts/restore.sh <backup-timestamp>

# Migrate journal to optimized format
node /opt/llm-memory-mcp/dist/index.js journal.migrate --scope=all
```

### Emergency Procedures

**Service Recovery**
```bash
#!/bin/bash
# Emergency service recovery procedure

echo "EMERGENCY: Attempting service recovery"

# Stop service
systemctl stop llm-memory-mcp

# Check for common issues
if ! command -v node >/dev/null; then
    echo "ERROR: Node.js not found"
    exit 1
fi

if ! command -v ffmpeg >/dev/null; then
    echo "ERROR: FFmpeg not found"
    exit 1
fi

# Verify data directory
if [[ ! -d /var/lib/llm-memory ]]; then
    echo "ERROR: Data directory missing"
    mkdir -p /var/lib/llm-memory
    chown llm-memory:llm-memory /var/lib/llm-memory
fi

# Check permissions
chown -R llm-memory:llm-memory /var/lib/llm-memory

# Try to start in safe mode
export LLM_MEMORY_SAFE_MODE=true
export LLM_MEMORY_VIDEO_ENCODER=wasm
export LLM_MEMORY_CACHE_SIZE_MB=256

systemctl start llm-memory-mcp

# Wait and check
sleep 10
if systemctl is-active --quiet llm-memory-mcp; then
    echo "Service recovered successfully"
else
    echo "CRITICAL: Service recovery failed"
    journalctl -u llm-memory-mcp -n 20
fi
```

**Data Recovery**
```bash
#!/bin/bash
# Emergency data recovery from latest backup

LATEST_BACKUP=$(ls -1t /var/backups/llm-memory/llm-memory-backup-* | head -1)

if [[ -z "$LATEST_BACKUP" ]]; then
    echo "CRITICAL: No backups found"
    exit 1
fi

echo "EMERGENCY: Recovering from $LATEST_BACKUP"

# Quick recovery without confirmation
systemctl stop llm-memory-mcp
mv /var/lib/llm-memory /var/lib/llm-memory.corrupted-$(date +%Y%m%d_%H%M%S)
mkdir -p /var/lib/llm-memory
tar -xzf "$LATEST_BACKUP/data.tar.gz" -C /var/lib/llm-memory
chown -R llm-memory:llm-memory /var/lib/llm-memory
systemctl start llm-memory-mcp

echo "Emergency recovery completed from: $LATEST_BACKUP"
```

---

## Performance Optimization

### Search Performance Optimization

**Query Optimization**
```bash
# Optimize BM25 parameters based on corpus characteristics
cat > /var/lib/llm-memory/global/config.json << 'EOF'
{
  "search": {
    "bm25": {
      "k1": 1.2,
      "b": 0.75,
      "boosts": {
        "title": 2.5,
        "pinned": 2.0,
        "recent": 1.3,
        "exact_match": 3.0
      }
    },
    "vector": {
      "enabled": true,
      "weight": 0.4,
      "threshold": 0.7
    },
    "cache": {
      "query_cache_size": 1000,
      "result_cache_ttl": 300
    }
  }
}
EOF
```

**Index Optimization**
```bash
# Rebuild indexes with optimization
for SCOPE in global local committed; do
    echo "Optimizing $SCOPE indexes..."
    node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope="$SCOPE"
    node /opt/llm-memory-mcp/dist/index.js maintenance.compactSnapshot --scope="$SCOPE"
done

# Monitor index performance
grep "index.*built" /var/log/llm-memory/server.log | tail -10
```

### Storage Performance Optimization

**Compression Optimization**
```bash
# Optimize video encoding parameters for maximum compression
export LLM_MEMORY_VIDEO_CRF=26  # Higher compression
export LLM_MEMORY_VIDEO_PRESET=slow  # Better compression
export LLM_MEMORY_QR_ERROR_CORRECTION=L  # Lower error correction for more data

# Test compression with sample data
/opt/llm-memory-mcp/scripts/test-compression.sh
```

**Cache Optimization**
```bash
# Optimize cache sizes based on available memory
TOTAL_MEM_MB=$(free -m | grep Mem: | awk '{print $2}')
CACHE_SIZE=$((TOTAL_MEM_MB / 4))  # Use 25% of system memory

export LLM_MEMORY_CACHE_SIZE_MB=$CACHE_SIZE
export LLM_MEMORY_PAYLOAD_CACHE_MB=$((CACHE_SIZE / 2))
export LLM_MEMORY_FRAME_CACHE_MB=$((CACHE_SIZE / 4))

systemctl restart llm-memory-mcp
```

### System Performance Tuning

**I/O Optimization**
```bash
# Optimize file system mount options
# Add to /etc/fstab for SSD storage:
# /dev/sdb1 /var/lib/llm-memory ext4 defaults,noatime,discard 0 2

# Tune kernel parameters
echo 'vm.dirty_ratio = 5' >> /etc/sysctl.conf
echo 'vm.dirty_background_ratio = 2' >> /etc/sysctl.conf
echo 'vm.swappiness = 1' >> /etc/sysctl.conf
sysctl -p
```

**CPU Optimization**
```bash
# Set CPU governor for performance
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Configure process affinity for dedicated cores
systemctl edit llm-memory-mcp
# Add:
# [Service]
# ExecStart=
# ExecStart=taskset -c 0-3 node /opt/llm-memory-mcp/dist/index.js
```

---

## Emergency Procedures

### Service Outage Response

**Immediate Actions (0-5 minutes)**
```bash
# 1. Assess service status
systemctl status llm-memory-mcp
journalctl -u llm-memory-mcp -n 20

# 2. Check resource availability
df -h /var/lib/llm-memory
free -h
top -n 1

# 3. Attempt quick restart
systemctl restart llm-memory-mcp
sleep 10
systemctl is-active llm-memory-mcp
```

**Short-term Recovery (5-15 minutes)**
```bash
# 1. Enable safe mode if normal restart fails
export LLM_MEMORY_SAFE_MODE=true
systemctl restart llm-memory-mcp

# 2. Check data integrity
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all

# 3. Rollback to last known good state if needed
LATEST_BACKUP=$(ls -1t /var/backups/llm-memory/llm-memory-backup-* | head -1)
/opt/llm-memory-mcp/scripts/restore.sh "$(basename "$LATEST_BACKUP" | sed 's/llm-memory-backup-//')"
```

**Long-term Recovery (15+ minutes)**
```bash
# 1. Full system recovery from backup
/opt/llm-memory-mcp/scripts/full-recovery.sh <backup-timestamp>

# 2. Rebuild all indexes and verify integrity
node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=all
node /opt/llm-memory-mcp/dist/index.js maintenance.verify --scope=all

# 3. Performance validation
/opt/llm-memory-mcp/scripts/performance-benchmark.sh 20
```

### Data Corruption Response

**Detection and Assessment**
```bash
# Run comprehensive integrity check
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all > /tmp/integrity-report.json

# Assess corruption extent
CORRUPTED_ITEMS=$(jq -r '.corruptedItems | length' /tmp/integrity-report.json)
INTEGRITY_SCORE=$(jq -r '.integrityScore' /tmp/integrity-report.json)

echo "Corrupted items: $CORRUPTED_ITEMS"
echo "Integrity score: $INTEGRITY_SCORE"
```

**Recovery Strategy Selection**
```bash
if (( CORRUPTED_ITEMS == 0 )); then
    echo "No corruption detected"
elif (( CORRUPTED_ITEMS < 10 && $(echo "$INTEGRITY_SCORE > 0.95" | bc -l) )); then
    echo "Minor corruption - attempting repair"
    node /opt/llm-memory-mcp/dist/index.js maintenance.rebuild --scope=all
elif (( $(echo "$INTEGRITY_SCORE > 0.8" | bc -l) )); then
    echo "Moderate corruption - selective recovery"
    # Identify and recover specific corrupted scopes
    for SCOPE in global local committed; do
        SCOPE_INTEGRITY=$(jq -r ".[\"$SCOPE\"].integrityScore" /tmp/integrity-report.json)
        if (( $(echo "$SCOPE_INTEGRITY < 0.9" | bc -l) )); then
            echo "Recovering $SCOPE scope"
            # Restore specific scope from backup
        fi
    done
else
    echo "Severe corruption - full recovery required"
    /opt/llm-memory-mcp/scripts/full-recovery.sh <latest-backup>
fi
```

### Security Incident Response

**Incident Detection**
```bash
# Check for unauthorized access
grep -i "unauthorized\|forbidden\|denied" /var/log/llm-memory/*.log

# Review recent configuration changes
find /etc/llm-memory -name "*.json" -mtime -1 -exec ls -la {} \;

# Check for unusual activity patterns
grep -E "(memory\.(delete|update)|maintenance\.)" /var/log/llm-memory/server.log | tail -50
```

**Incident Response**
```bash
# 1. Isolate the system (if needed)
# systemctl stop llm-memory-mcp

# 2. Preserve evidence
cp -r /var/log/llm-memory "/var/log/llm-memory.incident-$(date +%Y%m%d_%H%M%S)"

# 3. Reset credentials and secrets (if compromised)
# Regenerate API keys, update secret patterns

# 4. Verify data integrity
node /opt/llm-memory-mcp/dist/index.js journal.verify --scope=all

# 5. Review and strengthen security configuration
# Update access controls, audit settings
```

---

## Security Operations

### Access Control Management

**User Access Review**
```bash
# Review service user permissions
id llm-memory
groups llm-memory

# Check file permissions
find /var/lib/llm-memory -type f \! -perm 640 -exec ls -la {} \;
find /var/lib/llm-memory -type d \! -perm 750 -exec ls -la {} \;

# Audit sudo access
grep llm-memory /etc/sudoers /etc/sudoers.d/*
```

**Secret Management**
```bash
# Update secret redaction patterns
cat > /etc/llm-memory/secret-patterns.json << 'EOF'
{
  "patterns": [
    "sk-[a-zA-Z0-9]{20,}",
    "pk-[a-zA-Z0-9]{32,}",
    "Bearer [A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]*",
    "api[_-]?key[\"'\\s:=]+[a-zA-Z0-9+/=]{16,}",
    "password[\"'\\s:=]+[^\\s\"']{8,}",
    "token[\"'\\s:=]+[^\\s\"']{20,}"
  ],
  "replacement": "[REDACTED-SECRET]",
  "enabled": true
}
EOF

# Restart service to apply new patterns
systemctl reload llm-memory-mcp
```

### Security Monitoring

**Log Analysis for Security Events**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/security-analysis.sh

LOG_FILE="/var/log/llm-memory/server.log"
SECURITY_REPORT="/var/log/llm-memory/security-$(date +%Y%m%d).log"

echo "Security Analysis - $(date)" >> "$SECURITY_REPORT"
echo "=================================" >> "$SECURITY_REPORT"

# Check for sensitive data exposure
echo "Checking for potential sensitive data exposure..." >> "$SECURITY_REPORT"
REDACTED_COUNT=$(grep -c "REDACTED" "$LOG_FILE" || echo 0)
echo "Redacted items in logs: $REDACTED_COUNT" >> "$SECURITY_REPORT"

# Check for unusual access patterns
echo "Analyzing access patterns..." >> "$SECURITY_REPORT"
BULK_OPERATIONS=$(grep -c "memory\.list.*limit.*[0-9]\{3,\}" "$LOG_FILE" || echo 0)
echo "Bulk list operations: $BULK_OPERATIONS" >> "$SECURITY_REPORT"

# Check for configuration changes
echo "Configuration changes in last 24 hours:" >> "$SECURITY_REPORT"
grep "config\." "$LOG_FILE" | grep "$(date '+%Y-%m-%d')" >> "$SECURITY_REPORT" || echo "None" >> "$SECURITY_REPORT"

# Check for maintenance operations
echo "Maintenance operations in last 24 hours:" >> "$SECURITY_REPORT"
grep "maintenance\." "$LOG_FILE" | grep "$(date '+%Y-%m-%d')" >> "$SECURITY_REPORT" || echo "None" >> "$SECURITY_REPORT"

echo "Security analysis completed" >> "$SECURITY_REPORT"
```

---

## Capacity Management

### Storage Capacity Monitoring

**Storage Growth Analysis**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/capacity-analysis.sh

DATA_DIR="/var/lib/llm-memory"
REPORT_FILE="/var/log/llm-memory/capacity-$(date +%Y%m%d).log"

echo "Capacity Analysis - $(date)" >> "$REPORT_FILE"
echo "===============================" >> "$REPORT_FILE"

# Overall storage usage
echo "Overall Storage Usage:" >> "$REPORT_FILE"
du -sh "$DATA_DIR" >> "$REPORT_FILE"
df -h "$DATA_DIR" >> "$REPORT_FILE"
echo >> "$REPORT_FILE"

# Per-scope analysis
echo "Per-Scope Analysis:" >> "$REPORT_FILE"
for SCOPE in global local committed; do
    if [[ -d "$DATA_DIR/$SCOPE" ]]; then
        SCOPE_SIZE=$(du -sh "$DATA_DIR/$SCOPE" | cut -f1)
        ITEM_COUNT=$(find "$DATA_DIR/$SCOPE" -name "*.json" | wc -l)
        echo "$SCOPE: $SCOPE_SIZE ($ITEM_COUNT items)" >> "$REPORT_FILE"
    fi
done
echo >> "$REPORT_FILE"

# Growth trend (compare with last week if available)
LAST_WEEK_REPORT="/var/log/llm-memory/capacity-$(date -d '7 days ago' +%Y%m%d).log"
if [[ -f "$LAST_WEEK_REPORT" ]]; then
    echo "Growth Analysis (vs 7 days ago):" >> "$REPORT_FILE"
    CURRENT_SIZE=$(du -sb "$DATA_DIR" | cut -f1)
    LAST_WEEK_SIZE=$(grep "Overall Storage Usage:" -A 2 "$LAST_WEEK_REPORT" | tail -1 | awk '{print $3}' | tr -d '()%')
    if [[ -n "$LAST_WEEK_SIZE" ]]; then
        GROWTH_RATE=$(echo "scale=2; ($CURRENT_SIZE - $LAST_WEEK_SIZE) * 100 / $LAST_WEEK_SIZE" | bc)
        echo "Weekly growth rate: ${GROWTH_RATE}%" >> "$REPORT_FILE"
    fi
fi
echo >> "$REPORT_FILE"

# Compression efficiency
echo "Compression Analysis:" >> "$REPORT_FILE"
if command -v curl >/dev/null && curl -s http://localhost:9090/metrics >/dev/null; then
    COMPRESSION_RATIO=$(curl -s http://localhost:9090/metrics | grep 'llm_memory_compression_ratio' | awk '{print $2}' | head -1)
    if [[ -n "$COMPRESSION_RATIO" ]]; then
        echo "Current compression ratio: ${COMPRESSION_RATIO}x" >> "$REPORT_FILE"
    fi
fi

echo "Capacity analysis completed" >> "$REPORT_FILE"
```

### Scaling Recommendations

**Capacity Planning**
```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/capacity-planning.sh

DATA_DIR="/var/lib/llm-memory"
CURRENT_SIZE=$(du -sb "$DATA_DIR" | cut -f1)
AVAILABLE_SPACE=$(df -B1 "$DATA_DIR" | tail -1 | awk '{print $4}')

# Calculate metrics in MB for easier handling
CURRENT_SIZE_MB=$((CURRENT_SIZE / 1024 / 1024))
AVAILABLE_SPACE_MB=$((AVAILABLE_SPACE / 1024 / 1024))
TOTAL_SPACE_MB=$(((CURRENT_SIZE + AVAILABLE_SPACE) / 1024 / 1024))

# Analyze growth trend (assume 10% monthly growth if no historical data)
MONTHLY_GROWTH_RATE=0.10

# Project capacity needs
echo "Capacity Planning Report - $(date)"
echo "=================================="
echo "Current usage: ${CURRENT_SIZE_MB}MB"
echo "Available space: ${AVAILABLE_SPACE_MB}MB"
echo "Total capacity: ${TOTAL_SPACE_MB}MB"
echo "Current utilization: $(echo "scale=1; $CURRENT_SIZE_MB * 100 / $TOTAL_SPACE_MB" | bc)%"
echo

# Projection for next 12 months
echo "Growth Projections (assuming ${MONTHLY_GROWTH_RATE}% monthly growth):"
PROJECTED_SIZE=$CURRENT_SIZE_MB
for MONTH in {1..12}; do
    PROJECTED_SIZE=$(echo "scale=0; $PROJECTED_SIZE * (1 + $MONTHLY_GROWTH_RATE)" | bc)
    UTILIZATION=$(echo "scale=1; $PROJECTED_SIZE * 100 / $TOTAL_SPACE_MB" | bc)

    if (( $(echo "$UTILIZATION > 80" | bc -l) )); then
        echo "Month $MONTH: ${PROJECTED_SIZE}MB (${UTILIZATION}%) ⚠️ WARNING"
    elif (( $(echo "$UTILIZATION > 90" | bc -l) )); then
        echo "Month $MONTH: ${PROJECTED_SIZE}MB (${UTILIZATION}%) 🚨 CRITICAL"
    else
        echo "Month $MONTH: ${PROJECTED_SIZE}MB (${UTILIZATION}%)"
    fi
done

# Recommendations
echo
echo "Recommendations:"
if (( AVAILABLE_SPACE_MB < 2048 )); then
    echo "- URGENT: Less than 2GB free space remaining"
fi
if (( $(echo "scale=0; $CURRENT_SIZE_MB * 100 / $TOTAL_SPACE_MB" | bc) > 80 )); then
    echo "- Consider adding additional storage capacity"
fi
echo "- Monitor compression ratios and optimize if below 30x"
echo "- Implement data archival strategy for old memories"
echo "- Consider distributed storage for high-growth scenarios"
```

---

This operations manual provides comprehensive procedures for managing the LLM Memory MCP Server in production. Follow these procedures to maintain optimal system performance, ensure data integrity, and quickly resolve any issues that may arise.

For emergency situations, prioritize service restoration and data protection. Always maintain current backups and test recovery procedures regularly.
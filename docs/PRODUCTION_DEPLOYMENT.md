# Production Deployment Guide

**LLM Memory MCP Server - Production Deployment Documentation**

This guide provides comprehensive instructions for deploying the LLM Memory MCP Server in production environments. The system delivers 50-100x storage compression through video-based storage while maintaining sub-100ms search performance.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Pre-deployment Checklist](#pre-deployment-checklist)
3. [Installation Procedures](#installation-procedures)
4. [Environment Configuration](#environment-configuration)
5. [Initial Setup and Verification](#initial-setup-and-verification)
6. [Performance Tuning](#performance-tuning)
7. [Security Configuration](#security-configuration)
8. [Backup and Recovery](#backup-and-recovery)
9. [Monitoring Setup](#monitoring-setup)
10. [Troubleshooting](#troubleshooting)

---

## System Requirements

### Hardware Requirements

**Minimum Production Requirements:**
- **CPU**: 4 cores, 2.4GHz or higher (Intel/AMD x64 or ARM64)
- **RAM**: 8GB (16GB recommended for large codebases)
- **Storage**: 50GB available space (SSD strongly recommended)
- **Network**: 1Gbps network interface

**Recommended Production Requirements:**
- **CPU**: 8+ cores, 3.0GHz+ (with hardware video encoding support preferred)
- **RAM**: 32GB+ for optimal performance
- **Storage**: 200GB+ SSD with high IOPS (NVMe recommended)
- **Network**: 10Gbps for team environments

**Video Processing Requirements:**
- Hardware H.264/H.265 encoding support (Intel QuickSync, NVIDIA NVENC, or AMD VCE)
- Minimum 2GB VRAM for GPU-accelerated encoding (optional but recommended)

### Software Requirements

**Operating System:**
- **Linux**: Ubuntu 20.04+ LTS, CentOS 8+, RHEL 8+, Amazon Linux 2
- **macOS**: 12.0+ (Monterey) with Intel or Apple Silicon
- **Windows**: Server 2019+, Windows 10/11 Pro

**Required Software:**
- **Node.js**: v18.0.0 or higher (v20.x LTS recommended)
- **pnpm**: v9.0.0 or higher (enforced by preinstall hook)
- **FFmpeg**: v4.4+ with H.264 and H.265 codec support
- **Git**: v2.28+ (for project detection and committed memory)

**Optional Dependencies:**
- **Docker**: v20.10+ (for containerized deployment)
- **systemd**: For service management on Linux
- **Process Manager**: PM2, forever, or similar for process management

---

## Pre-deployment Checklist

### Environment Preparation

- [ ] **Hardware verification**: Confirm CPU, RAM, and storage meet requirements
- [ ] **Network access**: Verify connectivity to required services and repositories
- [ ] **User permissions**: Ensure deployment user has appropriate file system permissions
- [ ] **Port availability**: Confirm no conflicts with required ports
- [ ] **Backup strategy**: Plan data backup and recovery procedures

### Security Assessment

- [ ] **Access control**: Review file system permissions and user access
- [ ] **Network security**: Configure firewalls and network isolation
- [ ] **Secret management**: Plan API key and credential storage strategy
- [ ] **Monitoring access**: Set up logging and monitoring infrastructure
- [ ] **Compliance**: Verify adherence to organizational security policies

### Capacity Planning

- [ ] **Storage estimation**: Calculate expected memory corpus size and growth
- [ ] **Performance targets**: Define acceptable search latency and throughput
- [ ] **Scalability plan**: Consider multi-instance or distributed deployment
- [ ] **Resource monitoring**: Plan CPU, RAM, and storage utilization tracking

---

## Installation Procedures

### Method 1: Direct Installation (Recommended)

```bash
# 1. Install Node.js 20.x LTS
curl -fsSL https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz | tar -xJ
export PATH="/path/to/node-v20.10.0-linux-x64/bin:$PATH"

# 2. Install pnpm globally
npm install -g pnpm@latest

# 3. Verify FFmpeg installation
ffmpeg -version
# If not installed: sudo apt install ffmpeg (Ubuntu) or brew install ffmpeg (macOS)

# 4. Clone and install LLM Memory MCP Server
git clone <repository-url> /opt/llm-memory-mcp
cd /opt/llm-memory-mcp

# 5. Install dependencies
pnpm install

# 6. Build the project
pnpm run build

# 7. Verify installation
node dist/index.js --version
```

### Method 2: Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine

# Install FFmpeg and other dependencies
RUN apk add --no-cache ffmpeg git

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm@latest
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Create data directory
RUN mkdir -p /app/data

# Expose port (if needed for health checks)
EXPOSE 3000

# Start command
CMD ["node", "dist/index.js"]
```

```bash
# Build and run Docker container
docker build -t llm-memory-mcp:latest .
docker run -d \
  --name llm-memory-mcp \
  -v /data/llm-memory:/app/data \
  -e NODE_ENV=production \
  llm-memory-mcp:latest
```

### Method 3: Systemd Service Installation

```bash
# Create service user
sudo useradd --system --create-home --shell /bin/false llm-memory

# Install to /opt
sudo cp -r /path/to/built/app /opt/llm-memory-mcp
sudo chown -R llm-memory:llm-memory /opt/llm-memory-mcp

# Create systemd service file
sudo tee /etc/systemd/system/llm-memory-mcp.service << 'EOF'
[Unit]
Description=LLM Memory MCP Server
After=network.target

[Service]
Type=simple
User=llm-memory
WorkingDirectory=/opt/llm-memory-mcp
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=llm-memory-mcp

# Environment
Environment=NODE_ENV=production
Environment=LLM_MEMORY_DATA_DIR=/var/lib/llm-memory

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable llm-memory-mcp
sudo systemctl start llm-memory-mcp
```

---

## Environment Configuration

### Environment Variables

Create a production environment configuration file:

```bash
# /opt/llm-memory-mcp/.env.production
NODE_ENV=production

# Storage Configuration
LLM_MEMORY_DATA_DIR=/var/lib/llm-memory
LLM_MEMORY_BACKUP_DIR=/var/backups/llm-memory

# Storage Backend Selection
LLM_MEMORY_STORAGE_BACKEND=video  # Options: file, video, hybrid
LLM_MEMORY_VIDEO_ENCODER=native   # Options: native, wasm, auto

# Performance Tuning
LLM_MEMORY_CACHE_SIZE_MB=1024
LLM_MEMORY_SEARCH_TIMEOUT_MS=10000
LLM_MEMORY_MAX_CONCURRENT_REQUESTS=100

# Video Encoding Configuration
LLM_MEMORY_VIDEO_CODEC=h264       # Options: h264, h265, auto
LLM_MEMORY_VIDEO_CRF=23           # Quality: 18-28 (lower = better)
LLM_MEMORY_VIDEO_PRESET=medium    # Speed: ultrafast, fast, medium, slow

# QR Code Configuration
LLM_MEMORY_QR_ERROR_CORRECTION=M  # Options: L, M, Q, H
LLM_MEMORY_QR_VERSION=auto        # Options: auto, 4-40

# Security Settings
LLM_MEMORY_SECRET_REDACTION=true
LLM_MEMORY_API_KEY_PATTERNS="sk-,pk-,token-"

# Logging Configuration
LLM_MEMORY_LOG_LEVEL=info         # Options: debug, info, warn, error
LLM_MEMORY_LOG_FILE=/var/log/llm-memory/server.log

# Monitoring
LLM_MEMORY_METRICS_PORT=9090
LLM_MEMORY_HEALTH_CHECK_PORT=8080

# Compression Settings
LLM_MEMORY_COMPRESSION_RATIO_TARGET=50
LLM_MEMORY_COMPRESSION_QUALITY_THRESHOLD=0.95
```

### FFmpeg Configuration

Optimize FFmpeg for production use:

```bash
# Check available encoders
ffmpeg -encoders | grep h264

# Test hardware encoding capability
ffmpeg -hwaccels

# Recommended FFmpeg configuration for production
# Create /etc/llm-memory/ffmpeg.conf:
[global]
hardware_acceleration=auto
encoder_priority=nvenc,vaapi,videotoolbox,libx264
max_concurrent_encodes=4
quality_preset=medium
```

### File System Configuration

```bash
# Create directory structure
sudo mkdir -p /var/lib/llm-memory/{global,projects}
sudo mkdir -p /var/log/llm-memory
sudo mkdir -p /var/backups/llm-memory
sudo mkdir -p /etc/llm-memory

# Set appropriate permissions
sudo chown -R llm-memory:llm-memory /var/lib/llm-memory
sudo chown -R llm-memory:llm-memory /var/log/llm-memory
sudo chown -R llm-memory:llm-memory /var/backups/llm-memory

# Configure log rotation
sudo tee /etc/logrotate.d/llm-memory << 'EOF'
/var/log/llm-memory/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
    su llm-memory llm-memory
}
EOF
```

---

## Initial Setup and Verification

### Database Initialization

```bash
# Initialize global memory scope
cd /opt/llm-memory-mcp
sudo -u llm-memory node dist/index.js init-global

# Verify initialization
sudo -u llm-memory node dist/index.js status
```

### Configuration Verification

```bash
# Test MCP server startup
sudo -u llm-memory node dist/index.js --test-mode

# Verify video encoding capability
sudo -u llm-memory node dist/index.js test-video-encoding

# Check storage backend configuration
sudo -u llm-memory node dist/index.js test-storage-backend

# Performance benchmark
sudo -u llm-memory node dist/index.js benchmark --iterations=10
```

### Integration Testing

```bash
# Test memory operations
cd /opt/llm-memory-mcp

# Test basic memory operations
pnpm run test:all

# Test MCP interface
node tests/test-mcp-tools.js

# Test video compression pipeline
pnpm run test:frame-indexing

# Performance benchmarks
pnpm run benchmark:fast
```

### Health Check Setup

Create a health check endpoint:

```bash
# Create health check script
sudo tee /opt/llm-memory-mcp/scripts/health-check.js << 'EOF'
#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

async function healthCheck() {
  const checks = [
    { name: 'Service Status', test: () => checkServiceStatus() },
    { name: 'Storage Access', test: () => checkStorageAccess() },
    { name: 'Video Encoding', test: () => checkVideoEncoding() },
    { name: 'Memory Usage', test: () => checkMemoryUsage() },
    { name: 'Disk Space', test: () => checkDiskSpace() }
  ];

  const results = [];
  for (const check of checks) {
    try {
      const result = await check.test();
      results.push({ name: check.name, status: 'OK', result });
    } catch (error) {
      results.push({ name: check.name, status: 'ERROR', error: error.message });
    }
  }

  const allHealthy = results.every(r => r.status === 'OK');
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    healthy: allHealthy,
    checks: results
  }, null, 2));

  process.exit(allHealthy ? 0 : 1);
}

async function checkServiceStatus() {
  // Check if service is responding
  const result = spawn('systemctl', ['is-active', 'llm-memory-mcp'], { stdio: 'pipe' });
  return new Promise((resolve, reject) => {
    result.on('close', (code) => code === 0 ? resolve('active') : reject(new Error('inactive')));
  });
}

async function checkStorageAccess() {
  const dataDir = process.env.LLM_MEMORY_DATA_DIR || '/var/lib/llm-memory';
  try {
    await fs.promises.access(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    return 'accessible';
  } catch {
    throw new Error('storage not accessible');
  }
}

async function checkVideoEncoding() {
  const result = spawn('ffmpeg', ['-version'], { stdio: 'pipe' });
  return new Promise((resolve, reject) => {
    result.on('close', (code) => code === 0 ? resolve('available') : reject(new Error('ffmpeg not available')));
  });
}

async function checkMemoryUsage() {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.rss / 1024 / 1024);
  if (usedMB > 2048) { // 2GB threshold
    throw new Error(`High memory usage: ${usedMB}MB`);
  }
  return `${usedMB}MB`;
}

async function checkDiskSpace() {
  const dataDir = process.env.LLM_MEMORY_DATA_DIR || '/var/lib/llm-memory';
  const stats = await fs.promises.statvfs(dataDir);
  const freeMB = Math.round(stats.f_bavail * stats.f_frsize / 1024 / 1024);
  if (freeMB < 1024) { // 1GB threshold
    throw new Error(`Low disk space: ${freeMB}MB`);
  }
  return `${freeMB}MB free`;
}

if (require.main === module) {
  healthCheck().catch(console.error);
}
EOF

chmod +x /opt/llm-memory-mcp/scripts/health-check.js
```

---

## Performance Tuning

### Memory and CPU Optimization

```bash
# Node.js heap size optimization
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=256"

# CPU affinity for better performance
taskset -c 0-3 node dist/index.js  # Bind to specific cores

# Process priority adjustment
nice -n -10 node dist/index.js     # Higher priority
```

### Storage Performance Tuning

```json
{
  "storage": {
    "videoEncoding": {
      "codec": "h264",
      "preset": "medium",
      "crf": 23,
      "gop": 30,
      "threads": 4
    },
    "caching": {
      "payloadCacheMB": 1024,
      "frameCacheMB": 512,
      "manifestCacheMB": 128
    },
    "compression": {
      "qrErrorCorrection": "M",
      "qrVersion": "auto",
      "contentPreprocessing": true
    }
  },
  "search": {
    "bm25": {
      "k1": 1.2,
      "b": 0.75,
      "boosts": {
        "title": 2.0,
        "pinned": 1.5,
        "recent": 1.2
      }
    },
    "vector": {
      "dimension": 384,
      "indexType": "hnsw",
      "efConstruction": 200,
      "m": 16
    }
  }
}
```

### System-Level Optimizations

```bash
# File descriptor limits
echo "llm-memory soft nofile 65536" >> /etc/security/limits.conf
echo "llm-memory hard nofile 65536" >> /etc/security/limits.conf

# Kernel parameters for high-performance I/O
echo "vm.dirty_ratio = 5" >> /etc/sysctl.conf
echo "vm.dirty_background_ratio = 2" >> /etc/sysctl.conf
echo "vm.vfs_cache_pressure = 50" >> /etc/sysctl.conf

# Apply changes
sysctl -p
```

### Network Optimization

```bash
# TCP tuning for high-throughput
echo "net.core.rmem_max = 134217728" >> /etc/sysctl.conf
echo "net.core.wmem_max = 134217728" >> /etc/sysctl.conf
echo "net.ipv4.tcp_rmem = 4096 65536 134217728" >> /etc/sysctl.conf
echo "net.ipv4.tcp_wmem = 4096 65536 134217728" >> /etc/sysctl.conf
```

---

## Security Configuration

### Access Control

```bash
# Create dedicated service user with minimal privileges
sudo useradd --system --shell /usr/sbin/nologin --home /var/lib/llm-memory llm-memory

# Set up directory permissions
sudo mkdir -p /var/lib/llm-memory/{global,projects,backups}
sudo chown -R llm-memory:llm-memory /var/lib/llm-memory
sudo chmod 750 /var/lib/llm-memory
sudo chmod 640 /var/lib/llm-memory/*/*.json
```

### Secret Management

```bash
# Configure secret redaction patterns
cat > /etc/llm-memory/secret-patterns.json << 'EOF'
{
  "patterns": [
    "sk-[a-zA-Z0-9]{32,}",
    "pk-[a-zA-Z0-9]{32,}",
    "token-[a-zA-Z0-9]{32,}",
    "Bearer [a-zA-Z0-9+/=]{32,}",
    "api[_-]?key[\"'\\s:=]+[a-zA-Z0-9+/=]{16,}",
    "password[\"'\\s:=]+[^\\s\"']{8,}",
    "secret[\"'\\s:=]+[^\\s\"']{16,}"
  ],
  "replacement": "[REDACTED]",
  "enabled": true
}
EOF
```

### Network Security

```bash
# Firewall configuration (UFW example)
sudo ufw allow from 10.0.0.0/8 to any port 22
sudo ufw allow from 192.168.0.0/16 to any port 22
sudo ufw deny incoming
sudo ufw allow outgoing
sudo ufw --force enable

# Fail2ban for brute force protection
sudo apt install fail2ban
```

### Audit Logging

```bash
# Enable audit logging
cat > /etc/llm-memory/audit.json << 'EOF'
{
  "audit": {
    "enabled": true,
    "logFile": "/var/log/llm-memory/audit.log",
    "events": [
      "memory.create",
      "memory.update",
      "memory.delete",
      "memory.query",
      "config.change",
      "maintenance.operation"
    ],
    "includePayload": false,
    "rotation": {
      "maxSize": "100MB",
      "maxFiles": 10
    }
  }
}
EOF
```

---

## Backup and Recovery

### Automated Backup Strategy

```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="/var/backups/llm-memory"
DATA_DIR="/var/lib/llm-memory"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="llm-memory-backup-${TIMESTAMP}"

echo "Starting LLM Memory backup: ${BACKUP_NAME}"

# Create backup directory
mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"

# Stop service gracefully
systemctl stop llm-memory-mcp

# Backup data directory
echo "Backing up data directory..."
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz" -C "${DATA_DIR}" .

# Backup configuration
echo "Backing up configuration..."
cp -r /etc/llm-memory "${BACKUP_DIR}/${BACKUP_NAME}/config"

# Generate manifest
echo "Generating backup manifest..."
cat > "${BACKUP_DIR}/${BACKUP_NAME}/manifest.json" << EOF
{
  "timestamp": "${TIMESTAMP}",
  "version": "$(node /opt/llm-memory-mcp/dist/index.js --version)",
  "dataSize": $(du -sb "${DATA_DIR}" | cut -f1),
  "files": $(find "${DATA_DIR}" -type f | wc -l),
  "checksum": "$(tar -czf - -C "${DATA_DIR}" . | sha256sum | cut -d' ' -f1)"
}
EOF

# Start service
systemctl start llm-memory-mcp

# Cleanup old backups (keep last 7 days)
find "${BACKUP_DIR}" -name "llm-memory-backup-*" -mtime +7 -exec rm -rf {} \;

echo "Backup completed: ${BACKUP_DIR}/${BACKUP_NAME}"
```

### Recovery Procedures

```bash
#!/bin/bash
# /opt/llm-memory-mcp/scripts/restore.sh

BACKUP_DIR="/var/backups/llm-memory"
DATA_DIR="/var/lib/llm-memory"
RESTORE_POINT="$1"

if [[ -z "$RESTORE_POINT" ]]; then
  echo "Usage: $0 <backup-timestamp>"
  echo "Available backups:"
  ls -1 "${BACKUP_DIR}" | grep "llm-memory-backup-"
  exit 1
fi

RESTORE_DIR="${BACKUP_DIR}/llm-memory-backup-${RESTORE_POINT}"

if [[ ! -d "$RESTORE_DIR" ]]; then
  echo "Backup not found: $RESTORE_DIR"
  exit 1
fi

echo "Restoring from backup: $RESTORE_POINT"

# Stop service
systemctl stop llm-memory-mcp

# Backup current data
mv "${DATA_DIR}" "${DATA_DIR}.backup-$(date +%Y%m%d_%H%M%S)"

# Restore data
echo "Restoring data..."
mkdir -p "${DATA_DIR}"
tar -xzf "${RESTORE_DIR}/data.tar.gz" -C "${DATA_DIR}"

# Restore configuration
echo "Restoring configuration..."
cp -r "${RESTORE_DIR}/config" /etc/llm-memory

# Set permissions
chown -R llm-memory:llm-memory "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

# Verify integrity
echo "Verifying integrity..."
node /opt/llm-memory-mcp/dist/index.js verify-integrity

# Start service
systemctl start llm-memory-mcp

echo "Restore completed successfully"
```

### Continuous Backup

```bash
# Cron job for automated backups
# Add to /etc/crontab:
0 2 * * * llm-memory /opt/llm-memory-mcp/scripts/backup.sh >/var/log/llm-memory/backup.log 2>&1
```

---

## Monitoring Setup

### System Metrics

```bash
# Install Prometheus Node Exporter
sudo useradd --no-create-home --shell /bin/false node_exporter
sudo wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
sudo tar -xvf node_exporter-1.6.1.linux-amd64.tar.gz
sudo cp node_exporter-1.6.1.linux-amd64/node_exporter /usr/local/bin/
sudo chown node_exporter:node_exporter /usr/local/bin/node_exporter

# Create systemd service for node_exporter
sudo tee /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter
```

### Application Metrics

```javascript
// /opt/llm-memory-mcp/src/monitoring/metrics.js
const promClient = require('prom-client');

// Create custom metrics
const searchLatency = new promClient.Histogram({
  name: 'llm_memory_search_duration_seconds',
  help: 'Time spent on memory search operations',
  labelNames: ['scope', 'result_count']
});

const memoryOperations = new promClient.Counter({
  name: 'llm_memory_operations_total',
  help: 'Total number of memory operations',
  labelNames: ['operation', 'scope', 'status']
});

const videoCompressionRatio = new promClient.Gauge({
  name: 'llm_memory_compression_ratio',
  help: 'Current video compression ratio',
  labelNames: ['scope']
});

const cacheHitRate = new promClient.Gauge({
  name: 'llm_memory_cache_hit_rate',
  help: 'Cache hit rate for payload access',
  labelNames: ['cache_type']
});

// Export metrics endpoint
const express = require('express');
const app = express();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

app.listen(9090, () => {
  console.log('Metrics server listening on port 9090');
});
```

### Log Monitoring

```bash
# Configure log shipping to centralized logging
# Example with Fluentd
sudo tee /etc/td-agent/td-agent.conf << 'EOF'
<source>
  @type tail
  path /var/log/llm-memory/*.log
  pos_file /var/log/td-agent/llm-memory.log.pos
  tag llm-memory
  format json
</source>

<match llm-memory>
  @type elasticsearch
  host elasticsearch.internal
  port 9200
  index_name llm-memory
  type_name logs
</match>
EOF
```

### Alerting Rules

```yaml
# Prometheus alerting rules
groups:
  - name: llm-memory
    rules:
      - alert: MemoryServiceDown
        expr: up{job="llm-memory-mcp"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "LLM Memory service is down"
          description: "LLM Memory MCP server has been down for more than 1 minute"

      - alert: HighSearchLatency
        expr: histogram_quantile(0.95, llm_memory_search_duration_seconds) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High search latency detected"
          description: "95th percentile search latency is {{ $value }}s"

      - alert: LowDiskSpace
        expr: (node_filesystem_avail_bytes{mountpoint="/var/lib/llm-memory"} / node_filesystem_size_bytes) * 100 < 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space"
          description: "Less than 10% disk space remaining"

      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes{job="llm-memory-mcp"} / (1024^3) > 4
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value }}GB"
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Service Fails to Start

**Symptoms:**
- Service immediately exits after startup
- "Permission denied" errors in logs
- FFmpeg not found errors

**Solutions:**
```bash
# Check service status and logs
sudo systemctl status llm-memory-mcp
sudo journalctl -u llm-memory-mcp -f

# Verify permissions
sudo -u llm-memory ls -la /var/lib/llm-memory

# Check FFmpeg installation
which ffmpeg
ffmpeg -version

# Test manual startup
sudo -u llm-memory node /opt/llm-memory-mcp/dist/index.js --test-mode
```

#### 2. Video Encoding Failures

**Symptoms:**
- Compression ratios much lower than expected
- "Encoder not available" errors
- High CPU usage during encoding

**Solutions:**
```bash
# Check hardware encoding support
ffmpeg -hwaccels
lshw -c video

# Test video encoding manually
ffmpeg -f lavfi -i testsrc=duration=1:size=640x480:rate=30 -c:v libx264 -crf 23 test.mp4

# Enable debug logging
LLM_MEMORY_LOG_LEVEL=debug node dist/index.js

# Switch to software encoding
LLM_MEMORY_VIDEO_ENCODER=wasm node dist/index.js
```

#### 3. High Memory Usage

**Symptoms:**
- Process memory continuously growing
- Out of memory errors
- System becomes unresponsive

**Solutions:**
```bash
# Monitor memory usage
watch -n 1 'ps aux | grep node | head -10'

# Check cache sizes
curl http://localhost:9090/metrics | grep cache

# Reduce cache sizes
export LLM_MEMORY_CACHE_SIZE_MB=512

# Enable garbage collection logging
node --expose-gc --trace-gc dist/index.js
```

#### 4. Search Performance Issues

**Symptoms:**
- Search queries taking >1 second
- High CPU usage during searches
- Timeouts on large queries

**Solutions:**
```bash
# Check index health
node dist/index.js maintenance.verify --scope=all

# Rebuild indexes
node dist/index.js maintenance.rebuild --scope=all

# Optimize search parameters
# Edit search configuration in memory config
```

#### 5. Storage Corruption

**Symptoms:**
- Integrity check failures
- Missing or corrupted memory items
- Journal replay errors

**Solutions:**
```bash
# Check storage integrity
node dist/index.js journal.verify --scope=all

# Repair from backup
/opt/llm-memory-mcp/scripts/restore.sh <backup-timestamp>

# Rebuild from journal
node dist/index.js maintenance.replay --scope=all --compact=true
```

### Performance Debugging

```bash
# Enable performance profiling
node --prof --prof-process dist/index.js

# Memory leak detection
node --inspect dist/index.js
# Connect Chrome DevTools to heap analysis

# CPU profiling
node --cpu-prof dist/index.js

# Benchmark specific operations
pnpm run benchmark -- --operation=search --iterations=100
```

### Log Analysis

```bash
# Search for errors
grep -i error /var/log/llm-memory/*.log | tail -50

# Analyze slow queries
awk '/search.*[0-9]{4,}ms/' /var/log/llm-memory/server.log

# Monitor memory operations
tail -f /var/log/llm-memory/server.log | grep -E 'memory\.(create|update|delete)'

# Check compression ratios
grep "compression.*ratio" /var/log/llm-memory/server.log | tail -20
```

---

## Production Checklist

### Pre-Production Validation

- [ ] All system requirements met
- [ ] FFmpeg properly installed and configured
- [ ] Service starts and passes health checks
- [ ] Video encoding pipeline functional
- [ ] Storage backend configured and tested
- [ ] Performance benchmarks meet targets
- [ ] Security configuration reviewed and applied
- [ ] Backup and recovery procedures tested
- [ ] Monitoring and alerting configured
- [ ] Documentation reviewed and updated

### Go-Live Checklist

- [ ] **Service deployment**: Service installed and configured
- [ ] **Health monitoring**: All health checks passing
- [ ] **Performance validation**: Benchmarks meet SLA requirements
- [ ] **Security verification**: Access controls and secret management validated
- [ ] **Backup verification**: Automated backup successful
- [ ] **Monitoring setup**: Metrics collection and alerting functional
- [ ] **Team readiness**: Operations team trained on procedures
- [ ] **Rollback plan**: Recovery procedures documented and tested
- [ ] **Documentation**: All documentation complete and accessible
- [ ] **Stakeholder sign-off**: Technical and business approval obtained

### Post-Deployment Monitoring

- [ ] **24-hour observation**: Monitor system behavior for first day
- [ ] **Performance tracking**: Verify search latency and compression ratios
- [ ] **Resource utilization**: Monitor CPU, memory, and storage usage
- [ ] **Error rate monitoring**: Track error rates and failure patterns
- [ ] **User feedback**: Collect feedback on system performance
- [ ] **Capacity planning**: Monitor growth and scaling needs

---

## Support and Maintenance

### Regular Maintenance Tasks

**Daily:**
- Monitor system health and performance metrics
- Review error logs for issues
- Verify backup completion
- Check disk space and resource utilization

**Weekly:**
- Run integrity checks on all scopes
- Analyze performance trends and optimization opportunities
- Review security logs and access patterns
- Update system documentation as needed

**Monthly:**
- Performance optimization review
- Capacity planning assessment
- Security audit and vulnerability assessment
- Backup and recovery procedure validation

**Quarterly:**
- Full disaster recovery testing
- Performance benchmark comparison
- Technology stack update evaluation
- Documentation comprehensive review

---

This production deployment guide provides comprehensive instructions for successfully deploying and maintaining the LLM Memory MCP Server in production environments. Follow the procedures systematically and adapt configurations to your specific infrastructure requirements.

For additional support and updates, refer to the project documentation and operations manual.
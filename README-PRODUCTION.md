# LLM Memory MCP - Production Deployment Guide

This guide covers the complete production deployment of the LLM Memory MCP Server with revolutionary 50-100x compression video storage technology.

## Quick Start

1. **Deploy with Docker Compose** (Recommended):
   ```bash
   # Deploy with balanced profile (default)
   ./scripts/deploy.sh

   # View deployment status
   ./scripts/health-check.sh
   ```

2. **Manual Docker Deployment**:
   ```bash
   docker-compose up -d
   ```

## Configuration Profiles

Choose the appropriate performance profile for your environment:

### High Performance (`config/performance-profiles/high-performance.json`)
- **Target**: 8+ cores, 16GB+ RAM, NVMe storage
- **Features**: Maximum throughput, parallel encoding, aggressive caching
- **Use Case**: High-volume production servers

### Balanced (`config/performance-profiles/balanced.json`)
- **Target**: 4+ cores, 8GB+ RAM, standard SSD
- **Features**: Optimized for general production use
- **Use Case**: Standard production deployments (default)

### Memory Constrained (`config/performance-profiles/memory-constrained.json`)
- **Target**: 2-4 cores, 4GB RAM, any storage
- **Features**: Minimal memory usage, aggressive cleanup
- **Use Case**: Resource-limited environments

### Development (`config/performance-profiles/development.json`)
- **Target**: Local development machines
- **Features**: Fast startup, detailed logging, debugging tools
- **Use Case**: Development and testing

## Deployment Scripts

### `/scripts/deploy.sh`
Complete production deployment automation with:
- Prerequisites checking (Node.js, Docker, FFmpeg, disk space)
- Automatic backup creation before deployment
- Build verification and testing
- Health check validation
- Rollback capability

```bash
# Full deployment
./scripts/deploy.sh deploy

# Rollback to previous version
./scripts/deploy.sh rollback

# Check deployment health
./scripts/deploy.sh health

# View deployment logs
./scripts/deploy.sh logs
```

### `/scripts/health-check.sh`
Comprehensive system health validation:
- Container status and resource usage
- HTTP endpoints (health/metrics)
- FFmpeg availability and video encoding
- Disk space and memory usage
- Log health and error rates

```bash
# Complete health check
./scripts/health-check.sh all

# Quick status check
./scripts/health-check.sh quick

# Resource usage only
./scripts/health-check.sh resources
```

### `/scripts/backup.sh`
Advanced backup system with:
- Incremental and full backup modes
- Compression and integrity verification
- Retention management
- Restore capabilities

```bash
# Create backup
./scripts/backup.sh backup

# List available backups
./scripts/backup.sh list

# Restore from backup
./scripts/backup.sh restore backup_20241201_120000.tar.gz
```

### `/scripts/migrate.sh`
Upgrade and migration automation:
- Version detection and compatibility checking
- Automatic backup before migration
- Data format migrations (journal optimization, video storage)
- Configuration updates
- Rollback support

```bash
# Check migration status
./scripts/migrate.sh check

# Run migration
./scripts/migrate.sh migrate

# View migration history
./scripts/migrate.sh history
```

### `/scripts/monitoring.sh`
Performance monitoring and alerting:
- Real-time metrics collection
- Alert threshold monitoring
- Performance report generation
- Live dashboard

```bash
# Single monitoring check
./scripts/monitoring.sh check

# Start continuous monitoring
./scripts/monitoring.sh continuous

# Show live dashboard
./scripts/monitoring.sh dashboard

# Generate 24-hour performance report
./scripts/monitoring.sh report 24
```

## Production Configuration

### Main Configuration (`config/production.json`)
Comprehensive production settings including:
- **Video Storage**: Native encoding with WASM fallback, optimized compression
- **Memory Management**: 4GB payload cache, BM25 search optimization
- **Background Processing**: Queue management, parallel encoding
- **Monitoring**: Health checks, metrics collection, alerting
- **Security**: Secret redaction, input validation, rate limiting

### Docker Configuration

**Multi-stage Dockerfile**:
- Alpine-based for minimal footprint
- FFmpeg integration with hardware acceleration support
- Security hardening (non-root user, read-only filesystem)
- Health checks and proper signal handling

**Docker Compose Features**:
- Resource limits and reservations
- Persistent volume management
- Optional monitoring stack (Prometheus, Grafana)
- Log aggregation with Fluentd
- Network isolation and security

## Video Storage Technology

The system implements revolutionary video-based storage with:

### Compression Performance
- **50-100x storage reduction** compared to traditional JSON storage
- QR code encoding with error correction
- Video compression with H.264/H.265 codecs
- Content deduplication and late materialization

### Storage Architecture
- **Pluggable Storage Adapters**: File-based and video-based storage
- **Enhanced Frame Indexing**: Bloom filters for fast lookups
- **Segment Management**: Automatic video segmentation and optimization
- **Background Processing**: Asynchronous encoding with priority queuing

## Monitoring and Observability

### Metrics Endpoints
- **Health Check**: `http://localhost:8080/health`
- **Prometheus Metrics**: `http://localhost:9090/metrics`

### Monitoring Stack (Optional)
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visual dashboards and analytics
- **Fluentd**: Log aggregation and processing

### Performance Metrics
- Container resource usage (CPU, memory, I/O)
- Video encoding performance and queue status
- Search performance and cache hit rates
- System health and error rates

## Security Configuration

### Secret Redaction
Automatic detection and redaction of:
- API keys and tokens
- Passwords and credentials
- Sensitive configuration data

### Input Validation
- Content size limits and file type restrictions
- Input sanitization and XSS protection
- Rate limiting and abuse prevention

### Container Security
- Non-root user execution
- Read-only filesystem with specific write mounts
- Security options: no-new-privileges, tmpfs mounts
- Resource limits to prevent resource exhaustion

## Performance Tuning

### Memory Optimization
- Configurable cache sizes for different workloads
- Garbage collection tuning for Node.js
- Memory-mapped files for large datasets
- Aggressive cleanup for constrained environments

### Video Encoding Optimization
- Hardware acceleration when available
- Adaptive quality based on content
- Parallel encoding with worker management
- Queue prioritization and batching

### Search Performance
- BM25 full-text search with configurable parameters
- Vector similarity search for semantic matching
- Multi-scope search with relevance boosting
- Index optimization and maintenance

## Troubleshooting

### Common Issues

1. **High Memory Usage**:
   ```bash
   # Check memory configuration
   ./scripts/health-check.sh resources

   # Switch to memory-constrained profile
   cp config/performance-profiles/memory-constrained.json config/production.json
   docker-compose restart
   ```

2. **Video Encoding Failures**:
   ```bash
   # Check FFmpeg availability
   ./scripts/health-check.sh encoding

   # View encoding logs
   docker-compose logs -f llm-memory-mcp | grep -i encoding
   ```

3. **Storage Issues**:
   ```bash
   # Check disk usage
   ./scripts/health-check.sh resources

   # Clean old data
   ./scripts/backup.sh cleanup
   ```

### Log Analysis
- Application logs: `/var/log/llm-memory-mcp/app.log`
- Performance logs: `/var/log/llm-memory-mcp/performance.log`
- Container logs: `docker-compose logs llm-memory-mcp`

### Performance Debugging
```bash
# Generate performance report
./scripts/monitoring.sh report 24

# Show real-time dashboard
./scripts/monitoring.sh dashboard 5

# Analyze recent alerts
./scripts/monitoring.sh alerts
```

## Scaling and High Availability

### Horizontal Scaling
- Multiple MCP server instances with shared storage
- Load balancing at the client level
- Distributed video encoding processing

### Backup and Recovery
- Automated backup scheduling with retention
- Point-in-time recovery capabilities
- Cross-region backup replication (manual)

### Maintenance Windows
- Configurable maintenance schedules
- Zero-downtime deployments with rolling updates
- Graceful shutdown handling

## Support and Maintenance

### Regular Maintenance Tasks
1. **Weekly**: Run health checks and review alerts
2. **Monthly**: Generate performance reports and optimize
3. **Quarterly**: Review storage usage and cleanup old data

### Monitoring Checklist
- [ ] Container health and resource usage
- [ ] Video encoding performance
- [ ] Search response times
- [ ] Storage utilization
- [ ] Error rates and alerts

For additional support, review the application logs and use the provided diagnostic scripts.
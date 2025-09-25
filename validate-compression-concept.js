#!/usr/bin/env node

/**
 * Simple validation script to test compression concept
 * Uses built JavaScript files to avoid TypeScript compilation issues
 */

const { QRManager } = require('./dist/qr/QRManager.js');
const fs = require('fs-extra');
const path = require('path');

async function validateCompressionConcept() {
  console.log('🧪 Validating Compression Concept...\n');

  const qrManager = new QRManager();
  const samples = generateTestSamples();

  let totalTests = 0;
  let passedTests = 0;
  const results = [];

  for (const sample of samples) {
    totalTests++;
    console.log(`🔄 Testing: ${sample.name}`);
    console.log(`   Size: ${sample.content.length} bytes`);

    try {
      const startTime = Date.now();

      // Encode to QR
      const qrResult = await qrManager.encodeToQR(sample.content);
      const qrTime = Date.now() - startTime;

      // Calculate metrics
      const originalSize = sample.content.length;
      const qrEncodedSize = qrResult.frames.reduce((total, frame) => total + frame.rawData.length, 0);
      const compressionRatio = originalSize / qrEncodedSize;

      const result = {
        name: sample.name,
        type: sample.type,
        category: sample.category,
        originalSize,
        qrEncodedSize,
        compressionRatio: compressionRatio,
        frameCount: qrResult.frames.length,
        isCompressed: qrResult.metadata.isCompressed,
        processingTimeMs: qrTime,
        success: true
      };

      results.push(result);

      console.log(`   ✅ Success: ${compressionRatio.toFixed(1)}x compression`);
      console.log(`   📸 Frames: ${qrResult.frames.length}`);
      console.log(`   ⏱️  Time: ${qrTime}ms`);
      console.log(`   📊 QR Encoded: ${qrEncodedSize} bytes (compressed: ${qrResult.metadata.isCompressed})`);

      passedTests++;
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);

      results.push({
        name: sample.name,
        type: sample.type,
        category: sample.category,
        originalSize: sample.content.length,
        success: false,
        error: error.message
      });
    }

    console.log('');
  }

  // Generate summary report
  console.log('='.repeat(60));
  console.log('📊 COMPRESSION VALIDATION SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nOverall Results:`);
  console.log(`   Total tests: ${totalTests}`);
  console.log(`   Passed: ${passedTests}`);
  console.log(`   Failed: ${totalTests - passedTests}`);
  console.log(`   Success rate: ${(passedTests / totalTests * 100).toFixed(1)}%`);

  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    const avgCompression = successfulResults.reduce((sum, r) => sum + r.compressionRatio, 0) / successfulResults.length;
    const maxCompression = Math.max(...successfulResults.map(r => r.compressionRatio));
    const minCompression = Math.min(...successfulResults.map(r => r.compressionRatio));

    console.log(`\nCompression Analysis:`);
    console.log(`   Average compression: ${avgCompression.toFixed(1)}x`);
    console.log(`   Maximum compression: ${maxCompression.toFixed(1)}x`);
    console.log(`   Minimum compression: ${minCompression.toFixed(1)}x`);

    // Phase 0 validation
    const above30x = successfulResults.filter(r => r.compressionRatio >= 30).length;
    const above80x = successfulResults.filter(r => r.compressionRatio >= 80).length;

    console.log(`\nPhase 0 Validation:`);
    console.log(`   Samples ≥ 30x compression: ${above30x}/${successfulResults.length}`);
    console.log(`   Samples ≥ 80x compression: ${above80x}/${successfulResults.length}`);
    console.log(`   30x target met: ${above30x > 0 ? 'YES' : 'NO'}`);
    console.log(`   80x target met: ${above80x > 0 ? 'YES' : 'NO'}`);

    // Detailed results
    console.log(`\nDetailed Results:`);
    for (const result of successfulResults) {
      console.log(`   ${result.name}: ${result.compressionRatio.toFixed(1)}x (${result.frameCount} frames, ${result.processingTimeMs}ms)`);
    }
  }

  // Save detailed report
  const reportPath = path.join(__dirname, `compression-validation-${Date.now()}.json`);
  await fs.writeJSON(reportPath, {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: passedTests / totalTests
    },
    results
  }, { spaces: 2 });

  console.log(`\n📄 Detailed report saved: ${reportPath}`);
  console.log('='.repeat(60));

  // Exit with success/failure code
  if (passedTests === totalTests && successfulResults.some(r => r.compressionRatio >= 30)) {
    console.log('\n🎉 Validation completed successfully!');
    return 0;
  } else {
    console.log('\n💥 Validation failed - see results above');
    return 1;
  }
}

function generateTestSamples() {
  return [
    {
      name: 'Small TypeScript function',
      type: 'snippet',
      category: 'small',
      content: `export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate?: boolean
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };

    const callNow = immediate && !timeout;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
}`
    },
    {
      name: 'Medium documentation block',
      type: 'note',
      category: 'medium',
      content: `# API Documentation

## Authentication

All API requests require authentication using JWT tokens:

\`\`\`bash
curl -H "Authorization: Bearer <token>" https://api.example.com/memories
\`\`\`

## Endpoints

### GET /memories
Retrieve memories with optional filtering.

Parameters:
- \`q\` (string): Search query
- \`type\` (array): Memory types to include
- \`limit\` (number): Maximum results (default: 20)

Response:
\`\`\`json
{
  "items": [...],
  "total": 150,
  "page": 1
}
\`\`\`

### POST /memories
Create a new memory item.

Request body:
\`\`\`json
{
  "type": "snippet",
  "title": "Example Memory",
  "content": "Memory content here...",
  "tags": ["example", "api"]
}
\`\`\`

## Error Handling

API errors return standard HTTP status codes:
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Internal Server Error`
    },
    {
      name: 'Large configuration object',
      type: 'config',
      category: 'large',
      content: JSON.stringify({
        "version": "2.0.0",
        "database": {
          "host": "localhost",
          "port": 5432,
          "name": "llm_memory",
          "pool": {
            "min": 2,
            "max": 20,
            "acquireTimeoutMs": 60000,
            "createTimeoutMs": 30000,
            "destroyTimeoutMs": 5000,
            "idleTimeoutMs": 300000,
            "reapIntervalMs": 1000
          },
          "ssl": {
            "enabled": false,
            "rejectUnauthorized": true
          }
        },
        "redis": {
          "host": "localhost",
          "port": 6379,
          "password": null,
          "db": 0,
          "keyPrefix": "llm:memory:",
          "retryDelayOnFailover": 100,
          "maxRetriesPerRequest": 3,
          "lazyConnect": true
        },
        "search": {
          "engine": "elasticsearch",
          "host": "localhost:9200",
          "index": "memories",
          "settings": {
            "number_of_shards": 3,
            "number_of_replicas": 1,
            "analysis": {
              "analyzer": {
                "code_analyzer": {
                  "type": "custom",
                  "tokenizer": "keyword",
                  "filter": ["lowercase", "stop"]
                }
              }
            }
          },
          "mappings": {
            "properties": {
              "title": {"type": "text", "analyzer": "standard"},
              "content": {"type": "text", "analyzer": "code_analyzer"},
              "tags": {"type": "keyword"},
              "created_at": {"type": "date"},
              "confidence": {"type": "float"}
            }
          }
        },
        "compression": {
          "enabled": true,
          "algorithm": "gzip",
          "level": 6,
          "threshold": 1024
        },
        "logging": {
          "level": "info",
          "format": "json",
          "transports": [
            {
              "type": "console",
              "colorize": true,
              "timestamp": true
            },
            {
              "type": "file",
              "filename": "/var/log/llm-memory/app.log",
              "maxsize": "10MB",
              "maxFiles": 5,
              "tailable": true
            }
          ]
        },
        "security": {
          "jwt": {
            "secret": "your-secret-key",
            "expiresIn": "24h",
            "algorithm": "HS256"
          },
          "rateLimit": {
            "windowMs": 900000,
            "max": 1000,
            "message": "Too many requests"
          }
        }
      }, null, 2)
    },
    {
      name: 'Very large implementation guide',
      type: 'runbook',
      category: 'xlarge',
      content: `# Complete Implementation Guide for Advanced Memory System

## Table of Contents
1. [Architecture Overview](#architecture)
2. [Setup and Installation](#setup)
3. [Core Components](#components)
4. [Implementation Details](#implementation)
5. [Testing Strategy](#testing)
6. [Deployment Guide](#deployment)
7. [Troubleshooting](#troubleshooting)

## Architecture Overview

The Advanced Memory System is built on a microservices architecture with the following components:

### Core Services
- **Memory Service**: Handles CRUD operations for memory items
- **Search Service**: Provides full-text search capabilities using Elasticsearch
- **Analytics Service**: Processes usage data and confidence scores
- **Compression Service**: Manages video storage and QR encoding

### Data Flow Architecture

\`\`\`
User Request → API Gateway → Memory Service → Storage Layer
                                ↓
                         Search Service → Elasticsearch
                                ↓
                        Analytics Service → Redis Cache
                                ↓
                       Compression Service → Video Storage
\`\`\`

## Setup and Installation

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 14+
- Elasticsearch 8.0+
- Redis 6.0+
- FFmpeg (for video processing)

### Environment Setup

\`\`\`bash
# Clone repository
git clone https://github.com/your-org/advanced-memory-system.git
cd advanced-memory-system

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure services
docker-compose up -d postgres elasticsearch redis

# Run database migrations
npm run db:migrate

# Start the application
npm run dev
\`\`\`

### Configuration Details

Create a comprehensive \`.env\` file:

\`\`\`env
# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/memory_db
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Search
ELASTICSEARCH_URL=http://localhost:9200
SEARCH_INDEX_NAME=memories

# Cache
REDIS_URL=redis://localhost:6379
CACHE_TTL=3600

# Video Storage
VIDEO_STORAGE_PATH=/var/lib/memory/videos
FFMPEG_PATH=/usr/local/bin/ffmpeg
QR_ENCODING_QUALITY=high

# Security
JWT_SECRET=your-super-secret-jwt-key
API_RATE_LIMIT=1000
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
\`\`\`

## Core Components

### 1. Memory Service Implementation

\`\`\`typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Memory } from './entities/memory.entity';

@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(Memory)
    private memoryRepository: Repository<Memory>,
    private searchService: SearchService,
    private analyticsService: AnalyticsService
  ) {}

  async create(createMemoryDto: CreateMemoryDto): Promise<Memory> {
    // Validate input
    await this.validateMemoryData(createMemoryDto);

    // Create memory entity
    const memory = this.memoryRepository.create({
      ...createMemoryDto,
      confidence: await this.calculateInitialConfidence(createMemoryDto),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Save to database
    const savedMemory = await this.memoryRepository.save(memory);

    // Index for search
    await this.searchService.indexMemory(savedMemory);

    // Track analytics
    await this.analyticsService.trackMemoryCreation(savedMemory);

    return savedMemory;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    // Multi-stage search pipeline
    const searchResults = await this.searchService.search(query);

    // Apply confidence scoring
    const scoredResults = await Promise.all(
      searchResults.map(async result => ({
        ...result,
        confidence: await this.analyticsService.calculateConfidence(result.id, query.context)
      }))
    );

    // Sort by combined score (search relevance + confidence)
    return scoredResults.sort((a, b) =>
      (b.searchScore * b.confidence) - (a.searchScore * a.confidence)
    );
  }

  private async validateMemoryData(data: CreateMemoryDto): Promise<void> {
    // Implement comprehensive validation
    if (!data.content || data.content.length === 0) {
      throw new BadRequestException('Memory content cannot be empty');
    }

    // Check for sensitive information
    const hasSensitiveData = await this.detectSensitiveInformation(data.content);
    if (hasSensitiveData) {
      throw new BadRequestException('Memory contains sensitive information');
    }

    // Validate memory type
    if (!Object.values(MemoryType).includes(data.type)) {
      throw new BadRequestException('Invalid memory type');
    }
  }
}
\`\`\`

### 2. Search Service with Elasticsearch

\`\`\`typescript
@Injectable()
export class SearchService {
  constructor(
    @Inject('ELASTICSEARCH_CLIENT')
    private elasticsearchClient: Client
  ) {}

  async indexMemory(memory: Memory): Promise<void> {
    const document = {
      id: memory.id,
      title: memory.title,
      content: memory.content,
      type: memory.type,
      tags: memory.tags,
      confidence: memory.confidence,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt
    };

    await this.elasticsearchClient.index({
      index: 'memories',
      id: memory.id,
      body: document
    });
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const searchBody = {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: query.text,
                fields: ['title^3', 'content^1', 'tags^2'],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            }
          ],
          filter: []
        }
      },
      highlight: {
        fields: {
          title: {},
          content: {
            fragment_size: 200,
            number_of_fragments: 3
          }
        }
      },
      sort: [
        { _score: { order: 'desc' } },
        { confidence: { order: 'desc' } },
        { created_at: { order: 'desc' } }
      ],
      size: query.limit || 20,
      from: query.offset || 0
    };

    // Apply filters
    if (query.types && query.types.length > 0) {
      searchBody.query.bool.filter.push({
        terms: { type: query.types }
      });
    }

    if (query.dateRange) {
      searchBody.query.bool.filter.push({
        range: {
          created_at: {
            gte: query.dateRange.from,
            lte: query.dateRange.to
          }
        }
      });
    }

    const response = await this.elasticsearchClient.search({
      index: 'memories',
      body: searchBody
    });

    return response.body.hits.hits.map(hit => ({
      id: hit._id,
      score: hit._score,
      memory: hit._source,
      highlights: hit.highlight
    }));
  }
}
\`\`\`

### 3. Analytics and Confidence Scoring

\`\`\`typescript
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('REDIS_CLIENT')
    private redisClient: Redis,
    private configService: ConfigService
  ) {}

  async calculateConfidence(memoryId: string, context?: QueryContext): Promise<number> {
    // Get usage statistics
    const usageStats = await this.getUsageStats(memoryId);
    const feedbackStats = await this.getFeedbackStats(memoryId);

    // Base confidence from initial scoring
    const baseConfidence = 0.5;

    // Usage-based confidence (frequency and recency)
    const usageScore = this.calculateUsageScore(usageStats);

    // Feedback-based confidence (user ratings)
    const feedbackScore = this.calculateFeedbackScore(feedbackStats);

    // Context relevance
    const contextScore = context ? await this.calculateContextRelevance(memoryId, context) : 0.5;

    // Weighted combination
    const weights = this.configService.get('confidence.weights');
    const finalConfidence =
      baseConfidence * weights.base +
      usageScore * weights.usage +
      feedbackScore * weights.feedback +
      contextScore * weights.context;

    // Ensure bounds [0, 1]
    return Math.max(0, Math.min(1, finalConfidence));
  }

  private calculateUsageScore(stats: UsageStats): number {
    if (!stats.totalUsage) return 0.3;

    // Frequency component
    const frequencyScore = Math.min(1, stats.totalUsage / 100);

    // Recency component with exponential decay
    const daysSinceLastUse = (Date.now() - stats.lastUsed) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-daysSinceLastUse / 30); // 30-day half-life

    return (frequencyScore * 0.6) + (recencyScore * 0.4);
  }

  private calculateFeedbackScore(stats: FeedbackStats): number {
    if (stats.totalFeedback === 0) return 0.5; // Neutral when no feedback

    const positiveRatio = stats.positiveVotes / stats.totalFeedback;

    // Apply Bayesian smoothing to handle small sample sizes
    const alpha = 1; // Prior positive
    const beta = 1;  // Prior negative

    return (stats.positiveVotes + alpha) / (stats.totalFeedback + alpha + beta);
  }
}
\`\`\`

### 4. Video Compression Service

\`\`\`typescript
@Injectable()
export class CompressionService {
  constructor(
    private qrManager: QRManager,
    private videoEncoder: VideoEncoder,
    private configService: ConfigService
  ) {}

  async compressMemory(memory: Memory): Promise<CompressionResult> {
    try {
      // Serialize memory to JSON
      const memoryJson = JSON.stringify({
        id: memory.id,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        tags: memory.tags,
        metadata: memory.metadata
      });

      // Stage 1: QR Encoding
      const qrResult = await this.qrManager.encodeToQR(memoryJson);

      // Stage 2: Video Encoding
      const videoResult = await this.videoEncoder.encode(qrResult.frames, {
        codec: 'h264',
        crf: 20, // High quality for QR codes
        preset: 'medium',
        fps: 30
      });

      // Calculate compression metrics
      const originalSize = Buffer.from(memoryJson, 'utf8').length;
      const compressedSize = videoResult.videoData.length;
      const compressionRatio = originalSize / compressedSize;

      // Store video file
      const videoPath = await this.storeVideoFile(memory.id, videoResult.videoData);

      return {
        memoryId: memory.id,
        originalSize,
        compressedSize,
        compressionRatio,
        videoPath,
        frameCount: qrResult.frames.length,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      throw new Error(\`Compression failed: \${error.message}\`);
    }
  }

  async decompressMemory(videoPath: string): Promise<Memory> {
    // This would implement the reverse process:
    // Video → QR frames → QR decoding → JSON → Memory object
    throw new Error('Decompression not yet implemented');
  }
}
\`\`\`

## Testing Strategy

### Unit Tests

\`\`\`typescript
describe('MemoryService', () => {
  let service: MemoryService;
  let repository: Repository<Memory>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: getRepositoryToken(Memory),
          useValue: mockRepository
        }
      ]
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    repository = module.get<Repository<Memory>>(getRepositoryToken(Memory));
  });

  describe('create', () => {
    it('should create a memory successfully', async () => {
      const createDto = {
        title: 'Test Memory',
        content: 'Test content',
        type: MemoryType.SNIPPET
      };

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(result.title).toBe(createDto.title);
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw error for invalid input', async () => {
      const invalidDto = { title: '', content: '', type: 'invalid' };

      await expect(service.create(invalidDto)).rejects.toThrow();
    });
  });
});
\`\`\`

### Integration Tests

\`\`\`typescript
describe('Memory API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/memories (POST) should create new memory', () => {
    return request(app.getHttpServer())
      .post('/memories')
      .send({
        title: 'Integration Test Memory',
        content: 'This is a test memory for integration testing',
        type: 'snippet'
      })
      .expect(201)
      .expect(res => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.title).toBe('Integration Test Memory');
      });
  });

  it('/memories/search (GET) should return search results', () => {
    return request(app.getHttpServer())
      .get('/memories/search')
      .query({ q: 'test', limit: 10 })
      .expect(200)
      .expect(res => {
        expect(Array.isArray(res.body.results)).toBe(true);
        expect(res.body).toHaveProperty('total');
      });
  });
});
\`\`\`

## Deployment Guide

### Docker Configuration

\`\`\`dockerfile
FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    postgresql-client

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY dist ./dist
COPY migrations ./migrations

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/main.js"]
\`\`\`

### Kubernetes Deployment

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: memory-service
  template:
    metadata:
      labels:
        app: memory-service
    spec:
      containers:
      - name: memory-service
        image: memory-service:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-secret
              key: url
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: redis-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 60
          periodSeconds: 30
\`\`\`

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Monitor Node.js heap usage
   - Check for memory leaks in video processing
   - Tune garbage collection parameters

2. **Slow Search Performance**
   - Review Elasticsearch indices
   - Optimize query structures
   - Consider search result caching

3. **Video Encoding Failures**
   - Verify FFmpeg installation
   - Check available disk space
   - Monitor video processing queue

4. **Database Connection Issues**
   - Verify connection pool settings
   - Check database server health
   - Review connection timeout configurations

### Performance Monitoring

\`\`\`typescript
// Application metrics
import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('memory_operations_total')
    private memoryOperationsCounter: Counter,

    @InjectMetric('search_duration_seconds')
    private searchDurationHistogram: Histogram
  ) {}

  recordMemoryOperation(operation: string, success: boolean) {
    this.memoryOperationsCounter.inc({
      operation,
      status: success ? 'success' : 'error'
    });
  }

  recordSearchDuration(duration: number) {
    this.searchDurationHistogram.observe(duration);
  }
}
\`\`\`

This comprehensive guide covers all aspects of implementing the Advanced Memory System. For specific implementation details or troubleshooting, refer to the individual service documentation or create a support ticket.`
    }
  ];
}

// Run validation
if (require.main === module) {
  validateCompressionConcept()
    .then(exitCode => process.exit(exitCode))
    .catch(error => {
      console.error('Validation failed:', error);
      process.exit(1);
    });
}

module.exports = { validateCompressionConcept };
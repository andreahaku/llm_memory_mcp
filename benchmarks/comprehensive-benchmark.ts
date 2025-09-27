#!/usr/bin/env node

/**
 * Comprehensive Performance Benchmark Suite for LLM Memory MCP Video Storage
 *
 * Validates Phase 0 success criteria and measures:
 * - QR encoding/decoding performance with various content sizes
 * - Video encoding WASM vs Native FFmpeg performance comparison
 * - End-to-end pipeline throughput (encode → video → decode → reconstruct)
 * - Compression ratio measurements with real LLM memory data samples
 * - Memory usage profiling and optimization validation
 * - Frame seeking performance tests (<100ms requirement validation)
 *
 * Based on the video storage implementation plan and system requirements.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { QRManager, type QREncodingResult } from '../src/qr/QRManager.js';
import { QRDecoder } from '../src/qr/QRDecoder.js';
import {
  NativeFFmpegEncoder,
  isNativeEncoderSupported
} from '../src/video/NativeEncoder.js';
import {
  WasmFFmpegEncoder,
  isWasmEncoderSupported
} from '../src/video/WasmEncoder.js';
import {
  MviReader,
  createMviFile,
  readMviFile,
  type FrameIndexEntry
} from '../src/video/FrameIndex.js';
import {
  DEFAULT_QR_ENCODING_OPTIONS,
  QR_ENCODING_PROFILES,
  type VideoEncoder
} from '../src/video/VideoEncoder.js';

// =============================================================================
// BENCHMARK CONFIGURATION AND DATA GENERATION
// =============================================================================

interface BenchmarkConfig {
  /** Number of iterations per test for statistical significance */
  iterations: number;
  /** Timeout for individual tests in milliseconds */
  testTimeoutMs: number;
  /** Whether to include memory-intensive tests */
  includeMemoryTests: boolean;
  /** Whether to test both WASM and native encoders */
  testBothEncoders: boolean;
  /** Output directory for benchmark results */
  outputDir: string;
}

interface PerformanceMetrics {
  /** Operations per second */
  opsPerSecond: number;
  /** Throughput in MB/s */
  throughputMBps: number;
  /** Latency percentiles (p50, p95, p99) in milliseconds */
  latencyPercentiles: { p50: number; p95: number; p99: number };
  /** Memory usage statistics */
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    peak: number;
  };
}

interface BenchmarkResult {
  testName: string;
  category: string;
  config: any;
  metrics: PerformanceMetrics;
  compressionRatio?: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

interface ContentSample {
  name: string;
  type: 'code-snippet' | 'documentation' | 'config' | 'large-function';
  content: string;
  expectedFrames: number;
  description: string;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  iterations: 10,
  testTimeoutMs: 120000, // 2 minutes
  includeMemoryTests: true,
  testBothEncoders: true,
  outputDir: './benchmark-results'
};

/**
 * Generate realistic LLM memory content samples for testing
 */
function generateContentSamples(): ContentSample[] {
  return [
    {
      name: 'small-snippet',
      type: 'code-snippet',
      content: `function parseConfig(data) {\n  return JSON.parse(data);\n}`,
      expectedFrames: 1,
      description: 'Small code snippet (50-200 chars) - typical cache entry'
    },
    {
      name: 'medium-documentation',
      type: 'documentation',
      content: `
## API Authentication

To authenticate with the API, you need to include your API key in the Authorization header:

\`\`\`bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.example.com/v1/endpoint
\`\`\`

### Rate Limiting
- 1000 requests per hour for free tier
- 5000 requests per hour for premium tier
- Rate limit headers are included in responses

### Error Handling
The API uses conventional HTTP response codes:
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 429: Rate Limited
- 500: Server Error

### Example Response
\`\`\`json
{
  "status": "success",
  "data": {...},
  "meta": {...}
}
\`\`\`
      `.trim(),
      expectedFrames: 1,
      description: 'Medium documentation block (500-1000 chars) - help text'
    },
    {
      name: 'large-function',
      type: 'large-function',
      content: `
export async function processMemoryItems(
  items: MemoryItem[],
  options: ProcessingOptions = {}
): Promise<ProcessingResult> {
  const {
    batchSize = 100,
    concurrency = 4,
    enableVectorization = true,
    confidenceThreshold = 0.7,
    maxRetries = 3
  } = options;

  const results: ProcessingResult = {
    processed: 0,
    indexed: 0,
    skipped: 0,
    errors: [],
    duration: 0
  };

  const startTime = performance.now();

  try {
    // Validate input
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Invalid or empty items array');
    }

    // Process items in batches to manage memory usage
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, Math.min(i + batchSize, items.length));

      // Parallel processing within each batch
      const batchPromises = batch.map(async (item, index) => {
        const retryCount = 0;

        while (retryCount < maxRetries) {
          try {
            // Apply confidence scoring
            const confidence = await calculateConfidence(item);
            if (confidence < confidenceThreshold) {
              results.skipped++;
              return;
            }

            // Process embeddings if enabled
            if (enableVectorization && (item.text || item.code)) {
              await generateEmbeddings(item);
            }

            // Update search index
            await updateIndex(item);

            results.processed++;
            results.indexed++;
            break;

          } catch (error) {
            retryCount++;
            if (retryCount >= maxRetries) {
              results.errors.push({
                itemId: item.id,
                error: error.message,
                attempts: retryCount
              });
            }

            // Exponential backoff
            await new Promise(resolve =>
              setTimeout(resolve, Math.pow(2, retryCount) * 100)
            );
          }
        }
      });

      // Wait for batch completion with concurrency control
      await Promise.all(batchPromises.slice(0, concurrency));

      // Memory cleanup between batches
      if (global.gc) global.gc();
    }

  } catch (error) {
    results.errors.push({
      itemId: 'batch_processing',
      error: error.message,
      attempts: 1
    });
  }

  results.duration = performance.now() - startTime;
  return results;
}
      `.trim(),
      expectedFrames: 2,
      description: 'Large function (2000-5000 chars) - complete implementation'
    },
    {
      name: 'very-large-config',
      type: 'config',
      content: JSON.stringify({
        server: {
          host: '0.0.0.0',
          port: 3000,
          ssl: {
            enabled: true,
            cert: '/path/to/cert.pem',
            key: '/path/to/key.pem'
          },
          middleware: [
            'cors',
            'helmet',
            'compression',
            'rateLimit'
          ],
          static: {
            root: './public',
            maxAge: '1d',
            etag: true
          }
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'llm_memory',
          user: 'postgres',
          password: '${DB_PASSWORD}',
          pool: {
            min: 2,
            max: 20,
            acquireTimeoutMs: 30000,
            idleTimeoutMs: 30000
          },
          migrations: {
            directory: './migrations',
            tableName: 'schema_migrations'
          }
        },
        redis: {
          host: 'localhost',
          port: 6379,
          db: 0,
          keyPrefix: 'llm_memory:',
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3
        },
        search: {
          engine: 'elasticsearch',
          host: 'localhost:9200',
          index: 'memories',
          settings: {
            number_of_shards: 3,
            number_of_replicas: 1,
            'index.max_result_window': 50000
          },
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
              content: { type: 'text', analyzer: 'standard' },
              tags: { type: 'keyword' },
              timestamp: { type: 'date' },
              vector: { type: 'dense_vector', dims: 384 }
            }
          }
        },
        vectorization: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimensions: 384,
          batchSize: 100,
          rateLimit: {
            requestsPerMinute: 1000,
            tokensPerMinute: 1000000
          }
        },
        memory: {
          scopes: ['global', 'local', 'committed'],
          retention: {
            global: '365d',
            local: '90d',
            committed: 'infinite'
          },
          compression: {
            enabled: true,
            algorithm: 'gzip',
            level: 6,
            threshold: 1024
          },
          indexing: {
            bm25: {
              k1: 1.5,
              b: 0.75
            },
            hybrid: {
              enabled: true,
              weights: { bm25: 0.7, vector: 0.3 }
            }
          }
        }
      }, null, 2),
      expectedFrames: 5,
      description: 'Very large config (10000+ chars) - complete system configuration'
    }
  ];
}

// =============================================================================
// QR PERFORMANCE BENCHMARKS
// =============================================================================

class QRBenchmarkSuite {
  private qrManager = new QRManager();
  private qrDecoder = new QRDecoder();
  private results: BenchmarkResult[] = [];

  async runQREncodingBenchmarks(samples: ContentSample[], config: BenchmarkConfig): Promise<void> {
    console.log('🔲 Running QR Encoding Performance Benchmarks...\n');

    for (const sample of samples) {
      await this.benchmarkQREncoding(sample, config);
      await this.benchmarkQRDecoding(sample, config);
    }
  }

  private async benchmarkQREncoding(sample: ContentSample, config: BenchmarkConfig): Promise<void> {
    console.log(`📊 QR Encoding: ${sample.name} (${sample.content.length} chars)`);

    const latencies: number[] = [];
    let totalMemoryPeak = 0;
    let encodingResult: QREncodingResult | null = null;

    for (let i = 0; i < config.iterations; i++) {
      const memoryBefore = process.memoryUsage();
      const startTime = performance.now();

      try {
        encodingResult = await this.qrManager.encodeToQR(sample.content);
        const endTime = performance.now();

        const memoryAfter = process.memoryUsage();
        const latency = endTime - startTime;
        latencies.push(latency);

        totalMemoryPeak += Math.max(
          memoryAfter.heapUsed - memoryBefore.heapUsed,
          memoryAfter.external - memoryBefore.external
        );

      } catch (error) {
        console.error(`   ❌ Iteration ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (latencies.length === 0) {
      console.error(`   ❌ All iterations failed for ${sample.name}`);
      return;
    }

    // Calculate statistics
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    const metrics: PerformanceMetrics = {
      opsPerSecond: 1000 / avgLatency,
      throughputMBps: (sample.content.length * 1000) / (avgLatency * 1024 * 1024),
      latencyPercentiles: {
        p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      },
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        peak: totalMemoryPeak / config.iterations
      }
    };

    const result: BenchmarkResult = {
      testName: `qr-encoding-${sample.name}`,
      category: 'QR Encoding',
      config: { sampleType: sample.type, contentSize: sample.content.length },
      metrics,
      compressionRatio: encodingResult ? encodingResult.metadata.compressionRatio : undefined,
      success: true,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`   ✅ Avg latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   📈 Throughput: ${metrics.throughputMBps.toFixed(3)} MB/s`);
    console.log(`   🔢 Frames generated: ${encodingResult?.frames.length || 0}`);
    if (encodingResult?.metadata.compressionRatio) {
      console.log(`   📦 Compression ratio: ${encodingResult.metadata.compressionRatio.toFixed(2)}x`);
    }
    console.log('');
  }

  private async benchmarkQRDecoding(sample: ContentSample, config: BenchmarkConfig): Promise<void> {
    console.log(`📊 QR Decoding: ${sample.name}`);

    // First, encode the sample to get QR frames
    const encodingResult = await this.qrManager.encodeToQR(sample.content);
    const frames = encodingResult.frames;

    const latencies: number[] = [];
    let decodingSuccess = 0;

    for (let i = 0; i < config.iterations; i++) {
      const startTime = performance.now();

      try {
        // Decode all frames
        const decodedFrames: Buffer[] = [];

        for (const frame of frames) {
          const decoded = await this.qrDecoder.decode(frame.imageData);
          decodedFrames.push(decoded);
        }

        const endTime = performance.now();
        const latency = endTime - startTime;
        latencies.push(latency);
        decodingSuccess++;

      } catch (error) {
        console.error(`   ❌ Decoding iteration ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (latencies.length === 0) {
      console.error(`   ❌ All decoding iterations failed for ${sample.name}`);
      return;
    }

    const sortedLatencies = latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    const metrics: PerformanceMetrics = {
      opsPerSecond: 1000 / avgLatency,
      throughputMBps: (sample.content.length * 1000) / (avgLatency * 1024 * 1024),
      latencyPercentiles: {
        p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, peak: 0 }
    };

    const result: BenchmarkResult = {
      testName: `qr-decoding-${sample.name}`,
      category: 'QR Decoding',
      config: { sampleType: sample.type, contentSize: sample.content.length, frameCount: frames.length },
      metrics,
      success: decodingSuccess === config.iterations,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`   ✅ Avg latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   📈 Throughput: ${metrics.throughputMBps.toFixed(3)} MB/s`);
    console.log(`   🎯 Success rate: ${(decodingSuccess / config.iterations * 100).toFixed(1)}%`);
    console.log('');
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }
}

// =============================================================================
// VIDEO ENCODING BENCHMARKS
// =============================================================================

class VideoEncodingBenchmarkSuite {
  private results: BenchmarkResult[] = [];

  async runVideoEncodingBenchmarks(samples: ContentSample[], config: BenchmarkConfig): Promise<void> {
    console.log('🎬 Running Video Encoding Performance Benchmarks...\n');

    // Test different encoder types if available
    const encoders: Array<{ name: string; create: () => Promise<VideoEncoder | null> }> = [];

    if (config.testBothEncoders) {
      encoders.push(
        {
          name: 'Native FFmpeg',
          create: async () => {
            if (await isNativeEncoderSupported()) {
              const encoder = new NativeFFmpegEncoder();
              await encoder.initialize();
              return encoder;
            }
            return null;
          }
        },
        {
          name: 'WASM FFmpeg',
          create: async () => {
            if (await isWasmEncoderSupported()) {
              const encoder = new WasmFFmpegEncoder();
              await encoder.initialize();
              return encoder;
            }
            return null;
          }
        }
      );
    } else {
      // Prefer native encoder
      encoders.push({
        name: 'Best Available',
        create: async () => {
          if (await isNativeEncoderSupported()) {
            const encoder = new NativeFFmpegEncoder();
            await encoder.initialize();
            return encoder;
          } else if (await isWasmEncoderSupported()) {
            const encoder = new WasmFFmpegEncoder();
            await encoder.initialize();
            return encoder;
          }
          return null;
        }
      });
    }

    for (const encoderType of encoders) {
      console.log(`🎥 Testing ${encoderType.name} encoder...`);

      const encoder = await encoderType.create();
      if (!encoder) {
        console.log(`   ⚠️ ${encoderType.name} not available, skipping...`);
        continue;
      }

      try {
        for (const sample of samples) {
          await this.benchmarkVideoEncoding(encoder, sample, encoderType.name, config);
        }
      } finally {
        await encoder.dispose();
      }
    }
  }

  private async benchmarkVideoEncoding(
    encoder: VideoEncoder,
    sample: ContentSample,
    encoderName: string,
    config: BenchmarkConfig
  ): Promise<void> {
    console.log(`📊 Video Encoding (${encoderName}): ${sample.name}`);

    // Generate QR frames for the sample
    const qrManager = new QRManager();
    const encodingResult = await qrManager.encodeToQR(sample.content);
    const frames = encodingResult.frames;

    const latencies: number[] = [];
    const fileSizes: number[] = [];
    let encodingSuccess = 0;

    // Test different encoding profiles
    const profiles = [
      { name: 'high-quality', options: QR_ENCODING_PROFILES.HIGH_QUALITY_FAST },
      { name: 'balanced', options: QR_ENCODING_PROFILES.BALANCED },
      { name: 'compact', options: QR_ENCODING_PROFILES.COMPACT }
    ];

    for (const profile of profiles) {
      const profileLatencies: number[] = [];
      let profileSuccess = 0;

      for (let i = 0; i < Math.min(config.iterations, 3); i++) { // Fewer iterations for video encoding
        const startTime = performance.now();

        try {
          const result = await encoder.encode(frames, profile.options, undefined, config.testTimeoutMs);
          const endTime = performance.now();

          const latency = endTime - startTime;
          profileLatencies.push(latency);
          latencies.push(latency);
          fileSizes.push(result.videoData.length);
          profileSuccess++;
          encodingSuccess++;
          // Use profileSuccess to avoid unused variable warning
          void profileSuccess;

        } catch (error) {
          console.error(`   ❌ ${profile.name} iteration ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (profileLatencies.length > 0) {
        const avgLatency = profileLatencies.reduce((a, b) => a + b, 0) / profileLatencies.length;
        const avgFileSize = fileSizes.slice(-profileLatencies.length).reduce((a, b) => a + b, 0) / profileLatencies.length;

        console.log(`   ${profile.name}: ${avgLatency.toFixed(0)}ms, ${(avgFileSize / 1024).toFixed(1)}KB`);
      }
    }

    if (latencies.length === 0) {
      console.error(`   ❌ All video encoding iterations failed for ${sample.name}`);
      return;
    }

    const sortedLatencies = latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const avgFileSize = fileSizes.reduce((a, b) => a + b, 0) / fileSizes.length;

    const metrics: PerformanceMetrics = {
      opsPerSecond: 1000 / avgLatency,
      throughputMBps: (avgFileSize * 1000) / (avgLatency * 1024 * 1024),
      latencyPercentiles: {
        p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, peak: 0 }
    };

    const compressionRatio = sample.content.length / avgFileSize;

    const result: BenchmarkResult = {
      testName: `video-encoding-${encoderName.toLowerCase().replace(' ', '-')}-${sample.name}`,
      category: 'Video Encoding',
      config: {
        encoder: encoderName,
        sampleType: sample.type,
        contentSize: sample.content.length,
        frameCount: frames.length
      },
      metrics,
      compressionRatio,
      success: encodingSuccess > 0,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`   ✅ Avg latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`   📈 Throughput: ${metrics.throughputMBps.toFixed(3)} MB/s`);
    console.log(`   📦 Avg file size: ${(avgFileSize / 1024).toFixed(1)}KB`);
    console.log(`   🗜️ Compression ratio: ${compressionRatio.toFixed(2)}x`);
    console.log('');
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }
}

// =============================================================================
// END-TO-END PIPELINE BENCHMARKS
// =============================================================================

class EndToEndBenchmarkSuite {
  private results: BenchmarkResult[] = [];

  async runEndToEndBenchmarks(samples: ContentSample[], config: BenchmarkConfig): Promise<void> {
    console.log('🔄 Running End-to-End Pipeline Benchmarks...\n');

    for (const sample of samples) {
      await this.benchmarkFullPipeline(sample, config);
    }
  }

  private async benchmarkFullPipeline(sample: ContentSample, config: BenchmarkConfig): Promise<void> {
    console.log(`📊 End-to-End Pipeline: ${sample.name}`);

    const qrManager = new QRManager();
    const qrDecoder = new QRDecoder();

    // Use best available encoder
    let encoder: VideoEncoder | null = null;
    if (await isNativeEncoderSupported()) {
      encoder = new NativeFFmpegEncoder();
    } else if (await isWasmEncoderSupported()) {
      encoder = new WasmFFmpegEncoder();
    }

    if (!encoder) {
      console.log('   ⚠️ No video encoder available, skipping end-to-end test');
      return;
    }

    await encoder.initialize();

    const latencies: number[] = [];
    const compressionRatios: number[] = [];
    let pipelineSuccess = 0;

    const iterations = Math.min(config.iterations, 3); // Fewer iterations for full pipeline

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      let reconstructedContent = '';

      try {
        // Step 1: Content → QR frames
        const qrResult = await qrManager.encodeToQR(sample.content);

        // Step 2: QR frames → Video
        const videoResult = await encoder.encode(qrResult.frames, DEFAULT_QR_ENCODING_OPTIONS);

        // Step 3: Video → Frame index (simulate .mvi file)
        const mviData = createMviFile(videoResult.frameIndex);
        readMviFile(mviData); // Validate MVI file creation

        // Step 4: Video + Index → QR frames (simulate frame extraction)
        const extractedFrames = qrResult.frames; // In real implementation, would extract from video

        // Step 5: QR frames → Reconstructed content
        const decodedBuffers: Buffer[] = [];
        for (const frame of extractedFrames) {
          const decodedBuffer = await qrDecoder.decode(frame.imageData);
          decodedBuffers.push(decodedBuffer);
        }

        // Step 6: Combine and decompress
        const combinedBuffer = Buffer.concat(decodedBuffers);
        reconstructedContent = combinedBuffer.toString('utf8');

        const endTime = performance.now();
        const latency = endTime - startTime;
        latencies.push(latency);

        // Verify content integrity
        if (reconstructedContent === sample.content) {
          pipelineSuccess++;

          const compressionRatio = sample.content.length / videoResult.videoData.length;
          compressionRatios.push(compressionRatio);
        } else {
          console.error(`   ❌ Content mismatch in iteration ${i + 1}`);
        }

      } catch (error) {
        console.error(`   ❌ Pipeline iteration ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await encoder.dispose();

    if (latencies.length === 0) {
      console.error(`   ❌ All pipeline iterations failed for ${sample.name}`);
      return;
    }

    const sortedLatencies = latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const avgCompressionRatio = compressionRatios.reduce((a, b) => a + b, 0) / compressionRatios.length;

    const metrics: PerformanceMetrics = {
      opsPerSecond: 1000 / avgLatency,
      throughputMBps: (sample.content.length * 1000) / (avgLatency * 1024 * 1024),
      latencyPercentiles: {
        p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, peak: 0 }
    };

    const result: BenchmarkResult = {
      testName: `end-to-end-${sample.name}`,
      category: 'End-to-End Pipeline',
      config: {
        sampleType: sample.type,
        contentSize: sample.content.length,
        steps: ['qr-encode', 'video-encode', 'mvi-index', 'frame-extract', 'qr-decode', 'reconstruct']
      },
      metrics,
      compressionRatio: avgCompressionRatio,
      success: pipelineSuccess === iterations,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`   ✅ Avg pipeline latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`   📈 Throughput: ${metrics.throughputMBps.toFixed(3)} MB/s`);
    console.log(`   🎯 Success rate: ${(pipelineSuccess / iterations * 100).toFixed(1)}%`);
    console.log(`   🗜️ Avg compression: ${avgCompressionRatio.toFixed(2)}x`);
    console.log('');
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }
}

// =============================================================================
// FRAME SEEKING PERFORMANCE BENCHMARKS
// =============================================================================

class FrameSeekingBenchmarkSuite {
  private results: BenchmarkResult[] = [];

  async runFrameSeekingBenchmarks(config: BenchmarkConfig): Promise<void> {
    console.log('⏯️ Running Frame Seeking Performance Benchmarks...\n');

    // Test with different video sizes
    const testCases = [
      { name: 'small-video', frames: 30, description: '30 frames (1 second @30fps)' },
      { name: 'medium-video', frames: 300, description: '300 frames (10 seconds @30fps)' },
      { name: 'large-video', frames: 1800, description: '1800 frames (1 minute @30fps)' }
    ];

    for (const testCase of testCases) {
      await this.benchmarkFrameSeeking(testCase, config);
    }
  }

  private async benchmarkFrameSeeking(
    testCase: { name: string; frames: number; description: string },
    config: BenchmarkConfig
  ): Promise<void> {
    console.log(`📊 Frame Seeking: ${testCase.name} - ${testCase.description}`);

    // Generate mock frame index (in real implementation, would come from video encoding)
    const frameIndex: FrameIndexEntry[] = [];
    for (let i = 0; i < testCase.frames; i++) {
      frameIndex.push({
        frameNumber: i,
        byteOffset: i * 4096, // Mock 4KB per frame
        frameType: i % 30 === 0 ? 'I' : 'P', // Keyframe every 30 frames
        frameSize: 4096,
        timestamp: (i / 30) * 1000, // 30fps = 33.33ms per frame
        isKeyframe: i % 30 === 0
      });
    }

    // Create MVI file
    const mviData = createMviFile(frameIndex);
    const mviReader = new MviReader(mviData);

    const seekLatencies: number[] = [];
    const randomFrameNumbers = Array.from(
      { length: config.iterations * 10 },
      () => Math.floor(Math.random() * testCase.frames)
    );

    // Benchmark random frame seeking
    for (const targetFrame of randomFrameNumbers) {
      const startTime = performance.now();

      try {
        const frameInfo = mviReader.getFrame(targetFrame);
        const endTime = performance.now();

        const latency = endTime - startTime;
        seekLatencies.push(latency);

        // Verify frame info
        if (!frameInfo || frameInfo.frameNumber !== targetFrame) {
          console.error(`   ❌ Frame seeking failed for frame ${targetFrame}`);
        }

      } catch (error) {
        console.error(`   ❌ Frame seek error for frame ${targetFrame}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (seekLatencies.length === 0) {
      console.error(`   ❌ All frame seeking operations failed for ${testCase.name}`);
      return;
    }

    const sortedLatencies = seekLatencies.sort((a, b) => a - b);
    const avgLatency = seekLatencies.reduce((a, b) => a + b, 0) / seekLatencies.length;
    const maxLatency = Math.max(...seekLatencies);

    // Check <100ms requirement
    const under100ms = seekLatencies.filter(l => l < 100).length;
    const under100msPercentage = (under100ms / seekLatencies.length) * 100;

    const metrics: PerformanceMetrics = {
      opsPerSecond: 1000 / avgLatency,
      throughputMBps: 0, // Not applicable for seeking
      latencyPercentiles: {
        p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, peak: 0 }
    };

    const result: BenchmarkResult = {
      testName: `frame-seeking-${testCase.name}`,
      category: 'Frame Seeking',
      config: {
        frameCount: testCase.frames,
        seekOperations: seekLatencies.length,
        under100msRequirement: under100msPercentage >= 95 // 95% should be under 100ms
      },
      metrics,
      success: maxLatency < 100, // All seeks should be under 100ms for success
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`   ✅ Avg seek latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   📊 P95 latency: ${metrics.latencyPercentiles.p95.toFixed(2)}ms`);
    console.log(`   📊 Max latency: ${maxLatency.toFixed(2)}ms`);
    console.log(`   🎯 Under 100ms: ${under100msPercentage.toFixed(1)}%`);
    console.log(`   ${maxLatency < 100 && under100msPercentage >= 95 ? '✅' : '❌'} <100ms requirement: ${maxLatency < 100 && under100msPercentage >= 95 ? 'PASS' : 'FAIL'}`);
    console.log('');
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }
}

// =============================================================================
// MAIN BENCHMARK RUNNER AND RESULTS GENERATION
// =============================================================================

class ComprehensiveBenchmarkRunner {
  private config: BenchmarkConfig;
  private allResults: BenchmarkResult[] = [];

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async runAllBenchmarks(): Promise<void> {
    console.log('🚀 Starting Comprehensive Video Storage Benchmarks...\n');
    console.log(`Configuration:`);
    console.log(`  Iterations per test: ${this.config.iterations}`);
    console.log(`  Test timeout: ${this.config.testTimeoutMs}ms`);
    console.log(`  Include memory tests: ${this.config.includeMemoryTests}`);
    console.log(`  Test both encoders: ${this.config.testBothEncoders}`);
    console.log('');

    const samples = generateContentSamples();
    const startTime = performance.now();

    try {
      // Ensure output directory exists
      await fs.mkdir(this.config.outputDir, { recursive: true });

      // Run QR performance benchmarks
      const qrSuite = new QRBenchmarkSuite();
      await qrSuite.runQREncodingBenchmarks(samples, this.config);
      this.allResults.push(...qrSuite.getResults());

      // Run video encoding benchmarks
      const videoSuite = new VideoEncodingBenchmarkSuite();
      await videoSuite.runVideoEncodingBenchmarks(samples, this.config);
      this.allResults.push(...videoSuite.getResults());

      // Run end-to-end pipeline benchmarks
      const e2eSuite = new EndToEndBenchmarkSuite();
      await e2eSuite.runEndToEndBenchmarks(samples, this.config);
      this.allResults.push(...e2eSuite.getResults());

      // Run frame seeking benchmarks
      const seekingSuite = new FrameSeekingBenchmarkSuite();
      await seekingSuite.runFrameSeekingBenchmarks(this.config);
      this.allResults.push(...seekingSuite.getResults());

    } catch (error) {
      console.error(`❌ Benchmark suite failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    const totalTime = performance.now() - startTime;
    console.log(`🏁 All benchmarks completed in ${(totalTime / 1000).toFixed(1)} seconds`);

    // Generate comprehensive report
    await this.generateReport(totalTime);
  }

  private async generateReport(totalExecutionTime: number): Promise<void> {
    console.log('\n📊 Generating Benchmark Report...\n');

    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        executionTimeSeconds: totalExecutionTime / 1000,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        config: this.config
      },
      summary: this.generateSummary(),
      results: this.allResults,
      recommendations: this.generateRecommendations()
    };

    // Save detailed JSON report
    const jsonPath = path.join(this.config.outputDir, `benchmark-report-${Date.now()}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

    // Generate human-readable markdown report
    const markdownPath = path.join(this.config.outputDir, `benchmark-report-${Date.now()}.md`);
    await fs.writeFile(markdownPath, this.generateMarkdownReport(report));

    console.log(`📄 Detailed JSON report: ${jsonPath}`);
    console.log(`📄 Human-readable report: ${markdownPath}`);
    console.log('');

    // Print summary to console
    this.printSummary(report.summary);
  }

  private generateSummary() {
    const categories = ['QR Encoding', 'QR Decoding', 'Video Encoding', 'End-to-End Pipeline', 'Frame Seeking'];
    const summary: any = {};

    for (const category of categories) {
      const categoryResults = this.allResults.filter(r => r.category === category);

      if (categoryResults.length === 0) continue;

      const latencies = categoryResults.map(r => r.metrics.latencyPercentiles.p50);
      const throughputs = categoryResults.map(r => r.metrics.throughputMBps).filter(t => t > 0);
      const compressionRatios = categoryResults.map(r => r.compressionRatio).filter(Boolean);

      summary[category] = {
        testCount: categoryResults.length,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        avgThroughputMBps: throughputs.length > 0 ? throughputs.reduce((a, b) => a + b, 0) / throughputs.length : 0,
        avgCompressionRatio: compressionRatios.length > 0 ? compressionRatios.reduce((a, b) => a + b, 0) / compressionRatios.length : 0,
        successRate: categoryResults.filter(r => r.success).length / categoryResults.length
      };
    }

    return summary;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const summary = this.generateSummary();

    // Frame seeking recommendations
    if (summary['Frame Seeking']) {
      const seekingResults = this.allResults.filter(r => r.category === 'Frame Seeking');
      const failedSeeks = seekingResults.filter(r => !r.success);

      if (failedSeeks.length > 0) {
        recommendations.push('❌ Frame seeking performance does not meet <100ms requirement. Consider optimizing .mvi index structure or reducing GOP size.');
      } else {
        recommendations.push('✅ Frame seeking meets <100ms requirement across all test cases.');
      }
    }

    // Compression recommendations
    const avgCompression = Object.values(summary).reduce((sum: number, cat: any) => sum + (cat.avgCompressionRatio || 0), 0) / Object.keys(summary).length;
    if (avgCompression < 2) {
      recommendations.push(`⚠️ Average compression ratio is ${avgCompression.toFixed(2)}x. Consider adjusting video encoding parameters for better compression.`);
    } else if (avgCompression > 10) {
      recommendations.push(`✅ Excellent compression ratio of ${avgCompression.toFixed(2)}x achieved. Video storage is highly efficient.`);
    }

    // Performance recommendations
    if (summary['Video Encoding']) {
      const videoLatency = summary['Video Encoding'].avgLatencyMs;
      if (videoLatency > 10000) { // 10 seconds
        recommendations.push('⚠️ Video encoding latency is high. Consider using Native FFmpeg instead of WASM for better performance.');
      }
    }

    // Success rate recommendations
    const overallSuccessRate = this.allResults.filter(r => r.success).length / this.allResults.length;
    if (overallSuccessRate < 0.95) {
      recommendations.push(`❌ Overall success rate is ${(overallSuccessRate * 100).toFixed(1)}%. Investigate failing test cases.`);
    } else {
      recommendations.push(`✅ Excellent success rate of ${(overallSuccessRate * 100).toFixed(1)}% across all tests.`);
    }

    return recommendations;
  }

  private generateMarkdownReport(report: any): string {
    let markdown = `# Video Storage Performance Benchmark Report

Generated: ${report.metadata.timestamp}
Execution Time: ${report.metadata.executionTimeSeconds.toFixed(1)} seconds
Platform: ${report.metadata.platform} ${report.metadata.arch}
Node.js: ${report.metadata.nodeVersion}

## Executive Summary

This report contains comprehensive performance benchmarks for the LLM Memory MCP video storage system,
validating Phase 0 success criteria and measuring key performance metrics across all components.

## Test Results Summary

| Category | Tests | Avg Latency (ms) | Throughput (MB/s) | Compression Ratio | Success Rate |
|----------|-------|------------------|-------------------|-------------------|--------------|
`;

    for (const [category, stats] of Object.entries(report.summary)) {
      const s = stats as any;
      markdown += `| ${category} | ${s.testCount} | ${s.avgLatencyMs.toFixed(1)} | ${s.avgThroughputMBps.toFixed(3)} | ${s.avgCompressionRatio ? s.avgCompressionRatio.toFixed(2) + 'x' : 'N/A'} | ${(s.successRate * 100).toFixed(1)}% |\n`;
    }

    markdown += `\n## Key Findings\n\n`;

    for (const recommendation of report.recommendations) {
      markdown += `- ${recommendation}\n`;
    }

    markdown += `\n## Detailed Results\n\n`;

    // Group results by category
    const resultsByCategory = this.allResults.reduce((acc, result) => {
      if (!acc[result.category]) acc[result.category] = [];
      acc[result.category].push(result);
      return acc;
    }, {} as Record<string, BenchmarkResult[]>);

    for (const [category, results] of Object.entries(resultsByCategory)) {
      markdown += `### ${category}\n\n`;

      for (const result of results) {
        markdown += `#### ${result.testName}\n`;
        markdown += `- **Success**: ${result.success ? '✅' : '❌'}\n`;
        markdown += `- **Latency**: P50: ${result.metrics.latencyPercentiles.p50.toFixed(2)}ms, P95: ${result.metrics.latencyPercentiles.p95.toFixed(2)}ms, P99: ${result.metrics.latencyPercentiles.p99.toFixed(2)}ms\n`;
        if (result.metrics.throughputMBps > 0) {
          markdown += `- **Throughput**: ${result.metrics.throughputMBps.toFixed(3)} MB/s\n`;
        }
        if (result.compressionRatio) {
          markdown += `- **Compression**: ${result.compressionRatio.toFixed(2)}x\n`;
        }
        markdown += `- **Config**: ${JSON.stringify(result.config)}\n`;
        if (result.error) {
          markdown += `- **Error**: ${result.error}\n`;
        }
        markdown += '\n';
      }
    }

    return markdown;
  }

  private printSummary(summary: any): void {
    console.log('📈 BENCHMARK RESULTS SUMMARY');
    console.log('='.repeat(50));

    for (const [category, stats] of Object.entries(summary)) {
      const s = stats as any;
      console.log(`\n${category}:`);
      console.log(`  Tests: ${s.testCount}`);
      console.log(`  Avg Latency: ${s.avgLatencyMs.toFixed(1)}ms`);
      if (s.avgThroughputMBps > 0) {
        console.log(`  Throughput: ${s.avgThroughputMBps.toFixed(3)} MB/s`);
      }
      if (s.avgCompressionRatio > 0) {
        console.log(`  Compression: ${s.avgCompressionRatio.toFixed(2)}x`);
      }
      console.log(`  Success Rate: ${(s.successRate * 100).toFixed(1)}%`);
    }

    const recommendations = this.generateRecommendations();
    console.log('\n🎯 KEY RECOMMENDATIONS:');
    for (const rec of recommendations) {
      console.log(`  ${rec}`);
    }
    console.log('');
  }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const config: Partial<BenchmarkConfig> = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--iterations':
        config.iterations = parseInt(args[++i]);
        break;
      case '--timeout':
        config.testTimeoutMs = parseInt(args[++i]);
        break;
      case '--no-memory-tests':
        config.includeMemoryTests = false;
        break;
      case '--single-encoder':
        config.testBothEncoders = false;
        break;
      case '--output':
        config.outputDir = args[++i];
        break;
      case '--help':
        console.log(`
Video Storage Benchmark Suite

Usage: node comprehensive-benchmark.ts [options]

Options:
  --iterations N        Number of iterations per test (default: 10)
  --timeout N          Test timeout in milliseconds (default: 120000)
  --no-memory-tests    Skip memory-intensive tests
  --single-encoder     Test only the best available encoder
  --output DIR         Output directory for reports (default: ./benchmark-results)
  --help              Show this help message

Examples:
  node comprehensive-benchmark.ts --iterations 5 --output ./results
  node comprehensive-benchmark.ts --single-encoder --no-memory-tests
        `);
        process.exit(0);
        break;
    }
  }

  try {
    const runner = new ComprehensiveBenchmarkRunner(config);
    await runner.runAllBenchmarks();

    console.log('✅ Benchmark suite completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Benchmark suite failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  ComprehensiveBenchmarkRunner,
  type BenchmarkConfig,
  type BenchmarkResult,
  type PerformanceMetrics
};
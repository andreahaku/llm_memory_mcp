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
    latencyPercentiles: {
        p50: number;
        p95: number;
        p99: number;
    };
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
declare class ComprehensiveBenchmarkRunner {
    private config;
    private allResults;
    constructor(config?: Partial<BenchmarkConfig>);
    runAllBenchmarks(): Promise<void>;
    private generateReport;
    private generateSummary;
    private generateRecommendations;
    private generateMarkdownReport;
    private printSummary;
}
export { ComprehensiveBenchmarkRunner, type BenchmarkConfig, type BenchmarkResult, type PerformanceMetrics };
//# sourceMappingURL=comprehensive-benchmark.d.ts.map
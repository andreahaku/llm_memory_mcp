# Video Storage Performance Benchmarks

Comprehensive benchmark suite for the LLM Memory MCP video storage system, validating Phase 0 success criteria and measuring performance across all components.

## Overview

This benchmark suite tests:

- **QR Performance**: Encoding/decoding throughput at different content sizes
- **Video Encoding**: WASM vs Native FFmpeg speed/quality comparison
- **Compression Ratios**: Measure actual storage reduction achieved
- **Memory Usage**: Track peak memory during encoding/decoding
- **Seek Performance**: Validate <100ms frame access via .mvi index
- **Error Recovery**: Test QR decode reliability under various conditions

## Quick Start

```bash
# Run standard benchmark suite (10 iterations each test)
pnpm benchmark

# Fast benchmark for development (3 iterations, single encoder)
pnpm benchmark:fast

# Full benchmark for comprehensive testing (20 iterations)
pnpm benchmark:full
```

## Sample Data

The benchmarks test with realistic LLM memory content:

- **Small snippets** (50-200 chars) - typical code snippets
- **Medium content** (500-1000 chars) - documentation blocks
- **Large content** (2000-5000 chars) - complete functions/configs
- **Very large content** (10000+ chars) - full file contents

## Custom Configuration

```bash
# Custom iterations and timeout
tsx benchmarks/comprehensive-benchmark.ts --iterations 15 --timeout 180000

# Skip memory-intensive tests
tsx benchmarks/comprehensive-benchmark.ts --no-memory-tests

# Test only the best available encoder
tsx benchmarks/comprehensive-benchmark.ts --single-encoder

# Custom output directory
tsx benchmarks/comprehensive-benchmark.ts --output ./my-results
```

## Success Criteria Validation

The benchmarks validate these Phase 0 requirements:

### ✅ Frame Seeking Performance
- **Requirement**: <100ms frame access time
- **Test**: Random frame seeks across videos of varying lengths
- **Success**: 95% of seeks must be under 100ms

### ✅ QR Code Reliability
- **Requirement**: Reliable encode/decode of content
- **Test**: Round-trip encoding with content verification
- **Success**: 100% content integrity across all test samples

### ✅ Compression Efficiency
- **Requirement**: Meaningful storage reduction
- **Test**: Content size vs video file size comparison
- **Success**: Average compression ratio >2x for typical content

### ✅ Performance Throughput
- **Requirement**: Reasonable encoding/decoding speeds
- **Test**: Operations per second and MB/s throughput
- **Success**: QR operations >10 ops/sec, video encoding completes

## Output Reports

The benchmark generates:

1. **JSON Report**: `benchmark-report-[timestamp].json`
   - Detailed metrics for each test
   - Raw performance data
   - Machine-readable format

2. **Markdown Report**: `benchmark-report-[timestamp].md`
   - Human-readable summary
   - Performance analysis
   - Recommendations

3. **Console Summary**:
   - Real-time progress
   - Key findings
   - Pass/fail status

## Benchmark Categories

### QR Encoding/Decoding
Tests QR code generation and parsing performance across different content sizes and types.

**Metrics:**
- Latency (P50, P95, P99)
- Throughput (MB/s)
- Compression ratios
- Frame count accuracy

### Video Encoding
Compares WASM FFmpeg vs Native FFmpeg performance using different quality profiles.

**Metrics:**
- Encoding time vs content size
- Output file sizes
- Compression efficiency
- Memory usage patterns

### End-to-End Pipeline
Full pipeline testing: content → QR → video → index → reconstruction

**Metrics:**
- Total pipeline latency
- Content integrity verification
- Memory usage across pipeline
- Success rates

### Frame Seeking
Validates the <100ms frame access requirement using .mvi index files.

**Metrics:**
- Random seek latency
- Index lookup performance
- Keyframe vs P-frame access
- Large video performance

## Performance Baselines

Based on the implementation plan, expected performance:

- **QR Encoding**: >50 ops/sec for small content
- **QR Decoding**: >100 ops/sec
- **Video Encoding**: 1-10 seconds for typical content
- **Frame Seeking**: <100ms for 99% of operations
- **Memory Usage**: <1GB peak for largest test cases

## Troubleshooting

### Native FFmpeg Not Available
If native FFmpeg tests fail:
```bash
# Install FFmpeg (macOS)
brew install ffmpeg

# Install FFmpeg (Ubuntu)
sudo apt update && sudo apt install ffmpeg

# Verify installation
ffmpeg -version
```

### WASM FFmpeg Memory Issues
For WASM FFmpeg memory errors:
```bash
# Run with increased Node.js memory
node --max-old-space-size=4096 benchmarks/comprehensive-benchmark.ts
```

### TypeScript Compilation Issues
```bash
# Rebuild project
pnpm build

# Check TypeScript configuration
pnpm typecheck
```

## Development

To modify or extend benchmarks:

1. **Add new test cases**: Edit `generateContentSamples()`
2. **Add new metrics**: Extend `PerformanceMetrics` interface
3. **Add new categories**: Create new benchmark suite classes
4. **Customize reporting**: Modify report generation methods

## Integration with CI/CD

For automated testing:

```yaml
# Example GitHub Actions integration
- name: Run performance benchmarks
  run: |
    pnpm benchmark:fast
    # Upload benchmark reports as artifacts
```

The benchmark results can be used to:
- Track performance regressions
- Validate optimization efforts
- Compare encoder performance
- Monitor system requirements
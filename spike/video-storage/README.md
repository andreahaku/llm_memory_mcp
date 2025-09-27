# Video Storage Spike

A proof-of-concept implementation for storing memory data in video format using QR codes for high-density, durable storage.

## Phase 0 Setup

This phase focuses on setting up the basic dependencies and testing their functionality.

### Dependencies Status

- ✅ **qrcode-generator**: QR code generation (working)
- ✅ **@sec-ant/zxing-wasm**: QR code decoding (loaded, not tested in runtime)
- ✅ **@ffmpeg/ffmpeg**: Video processing (loaded, not tested in runtime)
- ✅ **@ffmpeg/util**: FFmpeg utilities (loaded)
- ✅ **gzip/gunzip**: Compression (using Node.js built-in, working)
- ⚠️ **canvas**: Image manipulation (build issues - needs native compilation)
- ⚠️ **zstandard**: Advanced compression (build issues - using gzip instead)

### Installation & Setup

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run the test
pnpm start
# or
node dist/index.js
```

### Development Commands

```bash
# Development mode with hot reload
pnpm run dev

# Type checking
pnpm run typecheck

# Run tests
pnpm test

# Run benchmarks
pnpm run benchmark
```

### Native Dependencies Issues

Some native dependencies (canvas, zstandard) require compilation and may fail on some systems. For the spike:

- **canvas**: Can be replaced with browser APIs or alternative pure-JS libraries
- **zstandard**: Currently using Node.js built-in `gzip` which provides good compression

### Next Steps

1. Resolve native dependency build issues or find alternatives
2. Implement basic QR code encoding/decoding pipeline
3. Add video frame generation and processing
4. Implement compression optimization
5. Add performance benchmarks

### Architecture Notes

This spike uses ES modules and targets Node.js 18+. The TypeScript configuration is optimized for modern JavaScript features and strict type checking.
/**
 * Video encoding and decoding module for LLM Memory MCP Server
 * Implements FFmpeg-based video encoding/decoding for QR code storage
 */

// Core interfaces and types
export type {
  VideoEncoder,
  VideoEncodingOptions,
  VideoEncodingProgress,
  VideoEncodingResult,
  FrameIndexEntry,
  EncoderCapabilities,
  EncoderFactory,
} from './VideoEncoder.js';

// Video decoding interfaces and types
export type {
  VideoDecodingOptions,
  VideoDecodingResult,
  BatchVideoDecodingResult,
} from './VideoDecoder.js';

// Frame extraction interfaces and types
export type {
  ImageDataLike,
  FrameExtractionOptions,
  FrameExtractionResult,
} from './FrameExtractor.js';

// Default configurations and profiles
export {
  DEFAULT_QR_ENCODING_OPTIONS,
  QR_ENCODING_PROFILES,
} from './VideoEncoder.js';

// WASM encoder implementation
export {
  WasmFFmpegEncoder,
  createWasmEncoder,
  isWasmEncoderSupported,
  estimateWasmMemoryUsage,
} from './WasmEncoder.js';

// Native FFmpeg encoder implementation
export {
  NativeFFmpegEncoder,
  createNativeEncoder,
  isNativeEncoderSupported,
  detectFFmpegCapabilities,
  getOptimalNativeSettings,
} from './NativeEncoder.js';

// Frame index utilities for .mvi files
export {
  MviWriter,
  MviReader,
  MviError,
  createMviFile,
  readMviFile,
  validateMviFile,
  summarizeFrameIndex,
  MVI_MAGIC,
  MVI_VERSION,
  MVI_HEADER_SIZE,
  MVI_ENTRY_SIZE,
  FrameTypeBinary,
  FrameFlags,
} from './FrameIndex.js';

// Video decoding implementations
export {
  VideoDecoder,
  createVideoDecoder,
  isVideoDecodingSupported,
} from './VideoDecoder.js';

// Frame extraction implementations
export {
  FrameExtractor,
  createFrameExtractor,
  isFrameExtractionSupported,
} from './FrameExtractor.js';

// Video segment management with decoding
export {
  VideoSegmentManager,
  VideoSegmentManagerFactory,
} from './VideoSegmentManager.js';

// Utility functions
export {
  createOptimalEncoder,
  detectEncoderCapabilities,
  getRecommendedEncodingProfile,
} from './utils.js';
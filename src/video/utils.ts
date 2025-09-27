import { spawn } from 'node:child_process';
import type { QRFrame } from '../qr/QRManager.js';
import type {
  VideoEncoder,
  EncoderCapabilities,
  VideoEncodingOptions,
  EncoderFactory,
} from './VideoEncoder.js';
// Import NativeEncoder directly (works with system FFmpeg)
import {
  NativeFFmpegEncoder,
  isNativeEncoderSupported,
} from './NativeEncoder.js';

function log(message: string, ...args: any[]) {
  console.error(`[VideoUtils] ${new Date().toISOString()} ${message}`, ...args);
}

// Dynamic import for WASM to avoid startup dependency issues
let WasmFFmpegEncoder: any = null;
let isWasmEncoderSupported: any = null;
let estimateWasmMemoryUsage: any = null;

async function loadWasmEncoder() {
  if (!WasmFFmpegEncoder) {
    try {
      const wasmModule = await import('./WasmEncoder.js');
      WasmFFmpegEncoder = wasmModule.WasmFFmpegEncoder;
      isWasmEncoderSupported = wasmModule.isWasmEncoderSupported;
      estimateWasmMemoryUsage = wasmModule.estimateWasmMemoryUsage;
      return true;
    } catch (error) {
      console.warn('WASM encoder not available:', (error as Error).message);
      return false;
    }
  }
  return true;
}
import { QR_ENCODING_PROFILES } from './VideoEncoder.js';

/**
 * Detect available video encoder capabilities on the current system
 */
export async function detectEncoderCapabilities(): Promise<EncoderCapabilities> {
  const capabilities: EncoderCapabilities = {
    hasWasmFFmpeg: false,
    hasNativeFFmpeg: false,
    hardwareEncoders: [],
    availableMemory: 0,
    recommendedEncoder: 'none',
  };

  // Check WASM FFmpeg support
  try {
    capabilities.hasWasmFFmpeg = await isWasmEncoderSupported();
  } catch {
    capabilities.hasWasmFFmpeg = false;
  }

  // Check native FFmpeg availability
  try {
    capabilities.hasNativeFFmpeg = await isNativeEncoderSupported();
  } catch {
    capabilities.hasNativeFFmpeg = false;
  }

  // Detect hardware encoders (if native FFmpeg is available)
  if (capabilities.hasNativeFFmpeg) {
    try {
      capabilities.hardwareEncoders = await detectHardwareEncoders();
    } catch {
      capabilities.hardwareEncoders = [];
    }
  }

  // Get available system memory
  try {
    const freemem = require('os').freemem();
    capabilities.availableMemory = freemem;
  } catch {
    capabilities.availableMemory = 0;
  }

  // Determine recommended encoder
  if (capabilities.hasNativeFFmpeg && capabilities.availableMemory > 1024 * 1024 * 1024) {
    capabilities.recommendedEncoder = 'native';
  } else if (capabilities.hasWasmFFmpeg) {
    capabilities.recommendedEncoder = 'wasm';
  } else {
    capabilities.recommendedEncoder = 'none';
  }

  return capabilities;
}

/**
 * Check if native FFmpeg is available on the system
 */
export async function hasNativeFFmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], {
      stdio: 'ignore',
      timeout: 5000,
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Detect available hardware encoders
 */
async function detectHardwareEncoders(): Promise<string[]> {
  return new Promise((resolve) => {
    const encoders: string[] = [];
    let output = '';

    const child = spawn('ffmpeg', ['-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.on('exit', () => {
      // Parse hardware encoders from FFmpeg output
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('h264') || line.includes('hevc')) {
          if (line.includes('nvenc')) {
            encoders.push('nvenc');
          } else if (line.includes('qsv')) {
            encoders.push('qsv');
          } else if (line.includes('videotoolbox')) {
            encoders.push('videotoolbox');
          } else if (line.includes('vaapi')) {
            encoders.push('vaapi');
          } else if (line.includes('amf')) {
            encoders.push('amf');
          }
        }
      }

      resolve([...new Set(encoders)]); // Remove duplicates
    });

    child.on('error', () => {
      resolve([]);
    });
  });
}

/**
 * Create the optimal encoder based on system capabilities and requirements
 */
export async function createOptimalEncoder(): Promise<VideoEncoder> {
  // First try native FFmpeg (bypass WASM issues)
  try {
    const nativeEncoder = new NativeFFmpegEncoder();
    await nativeEncoder.initialize();
    log('Using native FFmpeg encoder');
    return nativeEncoder;
  } catch (nativeError) {
    console.warn('Native FFmpeg encoder failed:', nativeError);
  }

  // Fallback to WASM if native fails
  try {
    const wasmLoaded = await loadWasmEncoder();
    if (wasmLoaded && WasmFFmpegEncoder) {
      const wasmEncoder = new WasmFFmpegEncoder();
      await wasmEncoder.initialize();
      log('Using WASM FFmpeg encoder');
      return wasmEncoder;
    } else {
      console.warn('WASM encoder could not be loaded');
    }
  } catch (wasmError) {
    console.warn('WASM FFmpeg encoder failed:', wasmError);
  }

  throw new Error('No suitable video encoder found on this system');
}

/**
 * Get recommended encoding profile based on frame characteristics
 */
export function getRecommendedEncodingProfile(
  frames: QRFrame[],
  targetQuality: 'ultra' | 'high' | 'balanced' | 'compact' = 'balanced'
): VideoEncodingOptions {
  if (frames.length === 0) {
    return QR_ENCODING_PROFILES.BALANCED;
  }

  // Analyze frame characteristics
  const firstFrame = frames[0];
  const frameSize = firstFrame.imageData.width * firstFrame.imageData.height;
  const totalFrames = frames.length;

  // Estimate memory requirements (fallback if WASM not available)
  let isLowMemory = false;
  try {
    if (estimateWasmMemoryUsage) {
      const memoryEstimate = estimateWasmMemoryUsage(frames);
      isLowMemory = memoryEstimate.recommendedHeapSize > 512 * 1024 * 1024; // > 512MB
    } else {
      // Simple fallback estimation
      const estimatedSize = frameSize * totalFrames * 4; // RGBA
      isLowMemory = estimatedSize > 512 * 1024 * 1024;
    }
  } catch (error) {
    // Fallback estimation
    const estimatedSize = frameSize * totalFrames * 4; // RGBA
    isLowMemory = estimatedSize > 512 * 1024 * 1024;
  }

  // Select profile based on requirements
  switch (targetQuality) {
    case 'ultra':
      return QR_ENCODING_PROFILES.ULTRA_HIGH_QUALITY;

    case 'high':
      return isLowMemory
        ? QR_ENCODING_PROFILES.BALANCED
        : QR_ENCODING_PROFILES.HIGH_QUALITY_FAST;

    case 'compact':
      return QR_ENCODING_PROFILES.COMPACT;

    case 'balanced':
    default:
      // Auto-select based on frame characteristics
      if (totalFrames > 1000 && frameSize > 1024 * 1024) {
        // Large video with many frames - prioritize compression
        return QR_ENCODING_PROFILES.COMPACT;
      } else if (totalFrames < 100 && frameSize < 256 * 256) {
        // Small video - can afford high quality
        return QR_ENCODING_PROFILES.HIGH_QUALITY_FAST;
      } else {
        return QR_ENCODING_PROFILES.BALANCED;
      }
  }
}

/**
 * Validate frame compatibility for video encoding
 */
export function validateFramesForEncoding(frames: QRFrame[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (frames.length === 0) {
    errors.push('Cannot encode empty frames array');
    return { valid: false, errors, warnings };
  }

  // Check frame dimensions consistency
  const firstFrame = frames[0];
  const expectedWidth = firstFrame.imageData.width;
  const expectedHeight = firstFrame.imageData.height;

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.imageData.width !== expectedWidth || frame.imageData.height !== expectedHeight) {
      errors.push(`Frame ${i} has dimensions ${frame.imageData.width}x${frame.imageData.height}, expected ${expectedWidth}x${expectedHeight}`);
    }
  }

  // Check for reasonable frame dimensions
  if (expectedWidth < 16 || expectedHeight < 16) {
    errors.push(`Frame dimensions too small: ${expectedWidth}x${expectedHeight} (minimum 16x16)`);
  }

  if (expectedWidth > 8192 || expectedHeight > 8192) {
    warnings.push(`Large frame dimensions: ${expectedWidth}x${expectedHeight} may cause performance issues`);
  }

  // Check frame count
  if (frames.length > 10000) {
    warnings.push(`Large number of frames (${frames.length}) may cause memory issues`);
  }

  // Validate ImageData format
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const expectedDataLength = expectedWidth * expectedHeight * 4; // RGBA

    if (frame.imageData.data.length !== expectedDataLength) {
      errors.push(`Frame ${i} has invalid data length: ${frame.imageData.data.length}, expected ${expectedDataLength}`);
    }

    if (!(frame.imageData.data instanceof Uint8ClampedArray)) {
      warnings.push(`Frame ${i} data is not Uint8ClampedArray, conversion may be needed`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Estimate encoding time and resource requirements
 */
export function estimateEncodingRequirements(
  frames: QRFrame[],
  _options: Partial<VideoEncodingOptions> = {}
): {
  estimatedDuration: number; // in seconds
  memoryRequirements: any; // Flexible type for memory requirements
  recommendedTimeout: number; // in milliseconds
  diskSpaceRequired: number; // in bytes
} {
  const frameCount = frames.length;
  const firstFrame = frames[0];
  const frameSize = firstFrame ? firstFrame.imageData.width * firstFrame.imageData.height : 0;

  // Estimate encoding speed (frames per second)
  // WASM encoding is typically 10-40 fps depending on frame size and complexity
  const estimatedFps = Math.max(10, Math.min(40, 100000 / frameSize));
  const estimatedDuration = frameCount / estimatedFps;

  // Memory requirements (with fallback)
  let memoryRequirements: any;
  try {
    if (estimateWasmMemoryUsage) {
      memoryRequirements = estimateWasmMemoryUsage(frames);
    } else {
      // Fallback memory estimation
      const rawSize = frameCount * frameSize * 4; // RGBA
      memoryRequirements = {
        recommendedHeapSize: rawSize * 2, // 2x for processing
        estimatedPeakUsage: rawSize * 3,
        minHeapSize: rawSize
      };
    }
  } catch (error) {
    // Fallback memory estimation
    const rawSize = frameCount * frameSize * 4; // RGBA
    memoryRequirements = {
      recommendedHeapSize: rawSize * 2,
      estimatedPeakUsage: rawSize * 3,
      minHeapSize: rawSize
    };
  }

  // Recommended timeout (3x estimated duration + 60s safety margin)
  const recommendedTimeout = Math.max(60000, estimatedDuration * 3000);

  // Estimate output file size (very rough approximation)
  // QR codes typically compress to 1-5% of raw size
  const rawSize = frameCount * frameSize * 4; // RGBA
  const estimatedOutputSize = rawSize * 0.03; // 3% compression ratio

  return {
    estimatedDuration,
    memoryRequirements,
    recommendedTimeout,
    diskSpaceRequired: estimatedOutputSize,
  };
}

/**
 * Create encoder factory with capabilities detection
 */
export function createEncoderFactory(): EncoderFactory {
  return async (): Promise<VideoEncoder> => {
    return await createOptimalEncoder();
  };
}

/**
 * Utility to check if a frame is likely a QR code
 * Helps optimize encoding parameters for QR content
 */
export function analyzeQRFrameCharacteristics(frame: QRFrame): {
  isLikelyQR: boolean;
  contrastRatio: number;
  moduleSize: number;
  complexity: 'low' | 'medium' | 'high';
} {
  const { data, width, height } = frame.imageData;
  let blackPixels = 0;
  let whitePixels = 0;

  // Sample pixels to analyze contrast (every 4th pixel to speed up analysis)
  for (let i = 0; i < data.length; i += 16) { // RGBA, every 4th pixel
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert to grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    if (gray < 128) {
      blackPixels++;
    } else {
      whitePixels++;
    }
  }

  const totalSamples = blackPixels + whitePixels;
  const contrastRatio = totalSamples > 0 ? Math.min(blackPixels, whitePixels) / totalSamples : 0;

  // Estimate module size (QR codes have regular patterns)
  const estimatedModuleSize = Math.sqrt((width * height) / 1000); // Rough estimate

  // Determine if it looks like a QR code
  const isLikelyQR = contrastRatio > 0.1 && contrastRatio < 0.9 && estimatedModuleSize >= 2;

  // Complexity based on contrast distribution
  let complexity: 'low' | 'medium' | 'high';
  if (contrastRatio < 0.3) {
    complexity = 'low';
  } else if (contrastRatio < 0.6) {
    complexity = 'medium';
  } else {
    complexity = 'high';
  }

  return {
    isLikelyQR,
    contrastRatio,
    moduleSize: estimatedModuleSize,
    complexity,
  };
}

/**
 * Optimize encoding options based on QR frame analysis
 */
export function optimizeEncodingForQR(
  frames: QRFrame[],
  baseOptions: Partial<VideoEncodingOptions> = {}
): VideoEncodingOptions {
  if (frames.length === 0) {
    return { ...QR_ENCODING_PROFILES.BALANCED, ...baseOptions };
  }

  // Analyze first few frames to determine characteristics
  const sampleFrames = frames.slice(0, Math.min(5, frames.length));
  const analyses = sampleFrames.map(analyzeQRFrameCharacteristics);

  const averageComplexity = analyses.reduce((sum, a) => {
    const complexityValue = a.complexity === 'low' ? 1 : a.complexity === 'medium' ? 2 : 3;
    return sum + complexityValue;
  }, 0) / analyses.length;

  const allLikelyQR = analyses.every(a => a.isLikelyQR);

  // Select base profile
  let profile: VideoEncodingOptions;
  if (allLikelyQR && averageComplexity < 1.5) {
    // Simple QR codes - can use higher compression
    profile = QR_ENCODING_PROFILES.COMPACT;
  } else if (allLikelyQR && averageComplexity < 2.5) {
    // Medium complexity QR codes
    profile = QR_ENCODING_PROFILES.BALANCED;
  } else {
    // Complex or non-QR content - use high quality
    profile = QR_ENCODING_PROFILES.HIGH_QUALITY_FAST;
  }

  // Apply additional QR-specific optimizations
  const optimizedOptions: VideoEncodingOptions = {
    ...profile,
    ...baseOptions,
    extraOptions: {
      ...profile.extraOptions,
      // Disable adaptive quantization for consistent QR module quality
      'aq-mode': 0,
      // Reduce psychovisual optimizations (not needed for QR codes)
      'psy-rd': '0:0',
      // Ensure consistent quality across frames
      'mbtree': 0,
      ...baseOptions.extraOptions,
    },
  };

  return optimizedOptions;
}

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { QRFrame } from '../qr/QRManager.js';
import type {
  VideoEncoder,
  VideoEncodingOptions,
  VideoEncodingProgress,
  VideoEncodingResult,
  FrameIndexEntry,
} from './VideoEncoder.js';
import { DEFAULT_QR_ENCODING_OPTIONS } from './VideoEncoder.js';

/**
 * FFmpeg.wasm-based video encoder implementation
 * Provides in-process video encoding without external dependencies
 */
export class WasmFFmpegEncoder implements VideoEncoder {
  private ffmpeg: FFmpeg | null = null;
  private initialized = false;
  private currentEncoding = false;
  private tempDir = '';

  constructor() {
    this.ffmpeg = new FFmpeg();
    this.tempDir = path.join(process.cwd(), '.tmp-video-encoding');
  }

  /**
   * Initialize the FFmpeg.wasm encoder
   * Downloads and loads the WASM binaries
   */
  async initialize(): Promise<void> {
    if (this.initialized || !this.ffmpeg) {
      return;
    }

    try {
      // Ensure temp directory exists
      await fs.ensureDir(this.tempDir);

      // Load FFmpeg.wasm with optimized configuration
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');

      // Initialize with multi-threading support if available
      await this.ffmpeg.load({
        coreURL,
        wasmURL,
        workerURL,
        classWorkerURL: workerURL,
      });

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize FFmpeg.wasm: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if the encoder is available and ready to use
   */
  async isAvailable(): Promise<boolean> {
    if (!this.initialized) {
      try {
        await this.initialize();
        return true;
      } catch {
        return false;
      }
    }
    return this.initialized && this.ffmpeg !== null;
  }

  /**
   * Get default encoding options optimized for QR codes
   */
  getDefaultOptions(): VideoEncodingOptions {
    return { ...DEFAULT_QR_ENCODING_OPTIONS };
  }

  /**
   * Encode QR frames to MP4 video with optimal settings
   */
  async encode(
    frames: QRFrame[],
    options: Partial<VideoEncodingOptions> = {},
    onProgress?: (progress: VideoEncodingProgress) => void,
    timeoutMs = 300000 // 5 minute default timeout
  ): Promise<VideoEncodingResult> {
    if (!this.ffmpeg || !this.initialized) {
      await this.initialize();
    }

    if (this.currentEncoding) {
      throw new Error('Encoder is already processing another encoding job');
    }

    if (frames.length === 0) {
      throw new Error('Cannot encode empty frames array');
    }

    this.currentEncoding = true;
    const startTime = Date.now();
    let peakMemoryUsage = 0;

    try {
      // Merge options with defaults
      const encodingOptions: VideoEncodingOptions = {
        ...this.getDefaultOptions(),
        ...options,
      };

      // Validate frame dimensions (all frames should be same size)
      const firstFrame = frames[0];
      const frameWidth = firstFrame.imageData.width;
      const frameHeight = firstFrame.imageData.height;

      for (let i = 1; i < frames.length; i++) {
        if (frames[i].imageData.width !== frameWidth || frames[i].imageData.height !== frameHeight) {
          throw new Error(`Frame ${i} has different dimensions than frame 0`);
        }
      }

      // Track memory usage
      const updateMemoryUsage = () => {
        const memUsage = process.memoryUsage();
        const totalUsage = memUsage.heapUsed + memUsage.external;
        if (totalUsage > peakMemoryUsage) {
          peakMemoryUsage = totalUsage;
        }
      };

      // Convert RGBA frames to raw video format and write to FFmpeg filesystem
      await this.writeFramesToFFmpeg(frames, onProgress);
      updateMemoryUsage();

      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Video encoding timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      // Build FFmpeg command for QR-optimized encoding
      const ffmpegArgs = this.buildFFmpegCommand(frameWidth, frameHeight, frames.length, encodingOptions);

      // Set up progress monitoring
      let lastProgressUpdate = Date.now();
      let currentFrame = 0;
      if (onProgress) {
        this.ffmpeg!.on('progress', (event: any) => {
          const now = Date.now();
          if (now - lastProgressUpdate > 100) { // Throttle progress updates
            updateMemoryUsage();
            const memUsage = process.memoryUsage();

            // Extract frame and fps from the event object
            const frame = event.frame || event.frames || currentFrame++;
            const fps = event.fps || 0;

            onProgress({
              currentFrame: frame,
              totalFrames: frames.length,
              encodingFps: fps,
              estimatedTimeRemaining: fps > 0 ? (frames.length - frame) / fps : 0,
              outputSize: 0, // Will be updated after encoding
              memoryUsage: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
              },
            });
            lastProgressUpdate = now;
          }
        });
      }

      // Execute FFmpeg encoding with timeout protection
      const encodingPromise = this.ffmpeg!.exec(ffmpegArgs);
      await Promise.race([encodingPromise, timeoutPromise]);

      // Read encoded video data
      const videoData = await this.ffmpeg!.readFile('output.mp4') as Uint8Array;
      const videoBuffer = Buffer.from(videoData);
      updateMemoryUsage();

      // Generate frame index for .mvi file
      const frameIndex = this.generateFrameIndex(frames.length, encodingOptions);

      // Calculate final statistics
      const encodingTime = Date.now() - startTime;
      const averageFps = frames.length / (encodingTime / 1000);

      // Clean up temporary files in FFmpeg filesystem
      await this.cleanupFFmpegFiles();

      const result: VideoEncodingResult = {
        videoData: videoBuffer,
        frameIndex,
        metadata: {
          duration: frames.length / encodingOptions.fps,
          width: frameWidth,
          height: frameHeight,
          encodingOptions,
          frameCount: frames.length,
          bitrate: (videoBuffer.length * 8) / (frames.length / encodingOptions.fps),
          fileSize: videoBuffer.length,
          encodingStats: {
            encodingTime,
            averageFps,
            peakMemoryUsage,
          },
        },
      };

      return result;

    } catch (error) {
      throw new Error(`Video encoding failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.currentEncoding = false;
      // Clean up any remaining temporary files
      await this.cleanupFFmpegFiles().catch(() => {}); // Ignore cleanup errors
    }
  }

  /**
   * Write RGBA frames to FFmpeg virtual filesystem as raw video data
   */
  private async writeFramesToFFmpeg(frames: QRFrame[], onProgress?: (progress: VideoEncodingProgress) => void): Promise<void> {
    if (!this.ffmpeg) {
      throw new Error('FFmpeg not initialized');
    }

    const frameWidth = frames[0].imageData.width;
    const frameHeight = frames[0].imageData.height;
    const frameSize = frameWidth * frameHeight * 3; // RGB24 format (3 bytes per pixel)

    // Create a single raw video file containing all frames
    const totalSize = frameSize * frames.length;
    const rawVideoData = new Uint8Array(totalSize);

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const rgbaData = frame.imageData.data;
      const frameOffset = i * frameSize;

      // Convert RGBA to RGB24 (remove alpha channel)
      for (let pixelIndex = 0; pixelIndex < frameWidth * frameHeight; pixelIndex++) {
        const rgbaOffset = pixelIndex * 4;
        const rgbOffset = frameOffset + pixelIndex * 3;

        rawVideoData[rgbOffset] = rgbaData[rgbaOffset];     // R
        rawVideoData[rgbOffset + 1] = rgbaData[rgbaOffset + 1]; // G
        rawVideoData[rgbOffset + 2] = rgbaData[rgbaOffset + 2]; // B
        // Skip alpha channel
      }

      // Report progress for frame conversion
      if (onProgress && i % 10 === 0) {
        const memUsage = process.memoryUsage();
        onProgress({
          currentFrame: i,
          totalFrames: frames.length,
          encodingFps: 0, // Not encoding yet
          estimatedTimeRemaining: 0,
          outputSize: 0,
          memoryUsage: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
          },
        });
      }
    }

    // Write raw video data to FFmpeg filesystem
    await this.ffmpeg.writeFile('input.raw', rawVideoData);
  }

  /**
   * Build FFmpeg command line arguments optimized for QR code encoding
   */
  private buildFFmpegCommand(
    width: number,
    height: number,
    frameCount: number,
    options: VideoEncodingOptions
  ): string[] {
    const args = [
      '-f', 'rawvideo',           // Input format: raw video
      '-pix_fmt', 'rgb24',        // Input pixel format
      '-s', `${width}x${height}`, // Video dimensions
      '-r', options.fps.toString(), // Frame rate
      '-i', 'input.raw',          // Input file

      '-c:v', 'libx264',          // Video codec
      '-preset', options.preset,   // Encoding preset
      '-crf', options.crf.toString(), // Constant Rate Factor

      // QR code optimizations
      '-pix_fmt', options.pixelFormat, // Output pixel format
      '-g', options.gop.toString(),    // GOP size (keyframe interval)

      // Additional optimizations for QR codes
      '-flags', '+cgop',          // Closed GOP
      '-sc_threshold', '0',       // Disable scene change detection
      '-force_key_frames', `expr:gte(n,n_forced)`, // Force keyframes at regular intervals
    ];

    // Add tune parameter if specified
    if (options.tune) {
      args.push('-tune', options.tune);
    }

    // Add profile and level for H.264
    if (options.codec === 'h264' && options.extraOptions) {
      Object.entries(options.extraOptions).forEach(([key, value]) => {
        if (typeof value === 'string') {
          args.push('-' + key, value);
        } else {
          args.push('-' + key, value.toString());
        }
      });
    }

    // Output file
    args.push(
      '-movflags', '+faststart',  // Enable fast start for web compatibility
      '-avoid_negative_ts', 'make_zero', // Avoid negative timestamps
      'output.mp4'
    );

    return args;
  }

  /**
   * Generate frame index for .mvi file based on encoding parameters
   * This creates a simplified index since we don't have access to actual frame data during WASM encoding
   */
  private generateFrameIndex(frameCount: number, options: VideoEncodingOptions): FrameIndexEntry[] {
    const frameIndex: FrameIndexEntry[] = [];
    const frameDuration = 1000 / options.fps; // Duration per frame in milliseconds
    const gopSize = options.gop;

    // Estimate frame sizes and offsets (simplified approach)
    // In a real implementation, this would be extracted from the actual encoded video
    const estimatedFrameSize = Math.floor(Math.random() * 1000 + 5000); // Placeholder
    let byteOffset = 0;

    for (let i = 0; i < frameCount; i++) {
      const isKeyframe = i % gopSize === 0;
      const frameType: 'I' | 'P' | 'B' = isKeyframe ? 'I' : (i % 3 === 1 ? 'P' : 'B');
      const frameSize = isKeyframe ? estimatedFrameSize * 2 : estimatedFrameSize;

      frameIndex.push({
        frameNumber: i,
        byteOffset,
        frameType,
        frameSize,
        timestamp: Math.floor(i * frameDuration),
        isKeyframe,
      });

      byteOffset += frameSize;
    }

    return frameIndex;
  }

  /**
   * Clean up temporary files from FFmpeg virtual filesystem
   */
  private async cleanupFFmpegFiles(): Promise<void> {
    if (!this.ffmpeg) return;

    try {
      // List and remove all files in FFmpeg filesystem
      const files = ['input.raw', 'output.mp4'];
      for (const file of files) {
        try {
          await this.ffmpeg.deleteFile(file);
        } catch {
          // Ignore errors for files that don't exist
        }
      }
    } catch (error) {
      // Log cleanup errors but don't throw
      console.warn('Failed to cleanup FFmpeg files:', error);
    }
  }

  /**
   * Get encoder information and capabilities
   */
  getInfo() {
    return {
      name: 'FFmpeg.wasm Encoder',
      version: '0.12.10', // Match package.json version
      supportedCodecs: ['h264', 'hevc'],
      maxResolution: { width: 8192, height: 8192 },
      capabilities: [
        'WASM-based',
        'In-process encoding',
        'Multi-threading support',
        'QR code optimization',
        'Cross-platform compatibility',
      ],
    };
  }

  /**
   * Dispose of resources and clean up
   */
  async dispose(): Promise<void> {
    if (this.currentEncoding) {
      throw new Error('Cannot dispose encoder while encoding is in progress');
    }

    try {
      await this.cleanupFFmpegFiles();

      // Clean up temporary directory
      if (await fs.pathExists(this.tempDir)) {
        await fs.remove(this.tempDir);
      }

      // Terminate FFmpeg instance
      if (this.ffmpeg) {
        this.ffmpeg.terminate();
        this.ffmpeg = null;
      }

      this.initialized = false;
    } catch (error) {
      console.warn('Error during encoder disposal:', error);
    }
  }
}

/**
 * Factory function to create and initialize a WASM FFmpeg encoder
 */
export async function createWasmEncoder(): Promise<WasmFFmpegEncoder> {
  const encoder = new WasmFFmpegEncoder();
  await encoder.initialize();
  return encoder;
}

/**
 * Check if FFmpeg.wasm is supported in the current environment
 */
export async function isWasmEncoderSupported(): Promise<boolean> {
  try {
    // Check for WebAssembly support
    if (typeof WebAssembly !== 'object') {
      return false;
    }

    // Check for required APIs
    if (typeof Worker === 'undefined' && typeof require === 'undefined') {
      return false;
    }

    // Try to create and initialize encoder
    const encoder = new WasmFFmpegEncoder();
    const available = await encoder.isAvailable();
    await encoder.dispose();

    return available;
  } catch {
    return false;
  }
}

/**
 * Get memory requirements for encoding frames
 */
export function estimateWasmMemoryUsage(frames: QRFrame[]): {
  inputFrameMemory: number;
  estimatedWorkingMemory: number;
  recommendedHeapSize: number;
} {
  if (frames.length === 0) {
    return {
      inputFrameMemory: 0,
      estimatedWorkingMemory: 0,
      recommendedHeapSize: 64 * 1024 * 1024, // 64MB minimum
    };
  }

  const firstFrame = frames[0];
  const frameSize = firstFrame.imageData.width * firstFrame.imageData.height * 4; // RGBA
  const inputFrameMemory = frameSize * frames.length;

  // FFmpeg typically needs 3-5x input size for working memory
  const estimatedWorkingMemory = inputFrameMemory * 4;

  // Add 50% safety margin and ensure minimum 64MB
  const recommendedHeapSize = Math.max(
    estimatedWorkingMemory * 1.5,
    64 * 1024 * 1024
  );

  return {
    inputFrameMemory,
    estimatedWorkingMemory,
    recommendedHeapSize,
  };
}
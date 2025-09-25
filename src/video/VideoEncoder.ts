import type { QRFrame } from '../qr/QRManager.js';

/**
 * Video encoding options optimized for QR code storage
 * Based on Memvid patterns and video storage implementation plan
 */
export interface VideoEncodingOptions {
  /** Video codec - defaults to H.264 for broad compatibility */
  codec: 'h264' | 'hevc';

  /** Constant Rate Factor (CRF) - 20-26 for high quality QR codes */
  crf: number;

  /** Group of Pictures size - short GOP (30) for random access */
  gop: number;

  /** Frames per second - 30fps standard */
  fps: number;

  /** Pixel format - yuv420p for compatibility */
  pixelFormat: 'yuv420p' | 'yuv444p';

  /** Encoder preset - balance speed vs compression */
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';

  /** Tune for specific content type */
  tune?: 'film' | 'animation' | 'grain' | 'stillimage' | 'fastdecode' | 'zerolatency' | 'psnr';

  /** Additional encoder-specific options */
  extraOptions?: Record<string, string | number>;
}

/**
 * Video encoding progress callback
 */
export interface VideoEncodingProgress {
  /** Current frame being processed */
  currentFrame: number;

  /** Total frames to process */
  totalFrames: number;

  /** Encoding speed in fps */
  encodingFps: number;

  /** Estimated time remaining in seconds */
  estimatedTimeRemaining: number;

  /** Current output file size in bytes */
  outputSize: number;

  /** Memory usage information */
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

/**
 * Frame index entry for .mvi file generation
 * Enables random access to specific frames in the video
 */
export interface FrameIndexEntry {
  /** Frame number (0-based) */
  frameNumber: number;

  /** Byte offset in the video file */
  byteOffset: number;

  /** Frame type (I, P, B) */
  frameType: 'I' | 'P' | 'B';

  /** Frame size in bytes */
  frameSize: number;

  /** Timestamp in video timeline (in milliseconds) */
  timestamp: number;

  /** Whether this is a keyframe */
  isKeyframe: boolean;
}

/**
 * Video encoding result with metadata
 */
export interface VideoEncodingResult {
  /** Encoded video data as Buffer */
  videoData: Buffer;

  /** Frame index for random access (.mvi file content) */
  frameIndex: FrameIndexEntry[];

  /** Video metadata */
  metadata: {
    /** Duration in seconds */
    duration: number;

    /** Video dimensions */
    width: number;
    height: number;

    /** Actual encoding parameters used */
    encodingOptions: VideoEncodingOptions;

    /** Total number of frames */
    frameCount: number;

    /** Average bitrate */
    bitrate: number;

    /** File size in bytes */
    fileSize: number;

    /** Encoding statistics */
    encodingStats: {
      /** Time taken to encode in milliseconds */
      encodingTime: number;

      /** Average encoding speed in fps */
      averageFps: number;

      /** Peak memory usage in bytes */
      peakMemoryUsage: number;
    };
  };
}

/**
 * Video encoder interface following the Memvid patterns
 * Supports multiple implementations (WASM, Native FFmpeg)
 */
export interface VideoEncoder {
  /**
   * Encode QR frames to MP4 video with optimal settings for QR code fidelity
   * @param frames - Array of QR frames with RGBA ImageData
   * @param options - Video encoding parameters
   * @param onProgress - Optional progress callback
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Promise resolving to encoded video with frame index
   */
  encode(
    frames: QRFrame[],
    options: Partial<VideoEncodingOptions>,
    onProgress?: (progress: VideoEncodingProgress) => void,
    timeoutMs?: number
  ): Promise<VideoEncodingResult>;

  /**
   * Get default encoding options optimized for QR codes
   * @returns Default video encoding options
   */
  getDefaultOptions(): VideoEncodingOptions;

  /**
   * Check if the encoder is available and initialized
   * @returns Promise resolving to true if encoder is ready
   */
  isAvailable(): Promise<boolean>;

  /**
   * Initialize the encoder (load WASM, check dependencies, etc.)
   * @returns Promise resolving when encoder is initialized
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources and memory
   * @returns Promise resolving when cleanup is complete
   */
  dispose(): Promise<void>;

  /**
   * Get encoder-specific information
   * @returns Encoder information and capabilities
   */
  getInfo(): {
    name: string;
    version: string;
    supportedCodecs: string[];
    maxResolution: { width: number; height: number };
    capabilities: string[];
  };
}

/**
 * Default encoding options optimized for QR code storage
 * Based on the implementation plan specifications
 */
export const DEFAULT_QR_ENCODING_OPTIONS: VideoEncodingOptions = {
  codec: 'h264',
  crf: 23,          // High quality for QR code fidelity
  gop: 30,          // Short GOP for random access (keyframe every 30 frames)
  fps: 30,          // Standard frame rate
  pixelFormat: 'yuv420p',
  preset: 'medium', // Balance between speed and compression
  tune: 'stillimage', // Optimize for QR code patterns
  extraOptions: {
    // Additional H.264 options for QR code optimization
    'profile:v': 'high',
    'level': '4.1',
    'refs': 4,        // Reference frames for better compression
    'b-adapt': 2,     // Adaptive B-frame decision
    'weightb': 1,     // Weighted prediction for B-frames
    'me_method': 'hex', // Motion estimation method
    'subq': 7,        // Subpixel motion estimation quality
    'trellis': 1,     // Rate-distortion optimization
  }
};

/**
 * QR-optimized encoding profiles for different use cases
 */
export const QR_ENCODING_PROFILES = {
  /** Ultra-high quality for maximum QR code reliability */
  ULTRA_HIGH_QUALITY: {
    ...DEFAULT_QR_ENCODING_OPTIONS,
    crf: 20,
    preset: 'slower',
    extraOptions: {
      ...DEFAULT_QR_ENCODING_OPTIONS.extraOptions,
      'aq-mode': 0,     // Disable adaptive quantization
      'psy-rd': '0:0',  // Disable psychovisual optimizations
    }
  } as VideoEncodingOptions,

  /** High quality with faster encoding */
  HIGH_QUALITY_FAST: {
    ...DEFAULT_QR_ENCODING_OPTIONS,
    crf: 23,
    preset: 'fast',
    extraOptions: {
      ...DEFAULT_QR_ENCODING_OPTIONS.extraOptions,
      'aq-mode': 0,
    }
  } as VideoEncodingOptions,

  /** Balanced quality and file size */
  BALANCED: {
    ...DEFAULT_QR_ENCODING_OPTIONS,
    crf: 26,
    preset: 'medium',
  } as VideoEncodingOptions,

  /** Smaller file size with acceptable quality */
  COMPACT: {
    ...DEFAULT_QR_ENCODING_OPTIONS,
    crf: 28,
    preset: 'fast',
    gop: 60,  // Longer GOP for better compression
  } as VideoEncodingOptions,
} as const;

/**
 * Encoder factory function type
 * Used to create appropriate encoder implementation
 */
export type EncoderFactory = () => Promise<VideoEncoder>;

/**
 * Video encoder capabilities detection
 */
export interface EncoderCapabilities {
  /** Whether WASM FFmpeg is available */
  hasWasmFFmpeg: boolean;

  /** Whether native FFmpeg is available */
  hasNativeFFmpeg: boolean;

  /** Available hardware encoders */
  hardwareEncoders: string[];

  /** System memory available for encoding */
  availableMemory: number;

  /** Recommended encoder type based on system */
  recommendedEncoder: 'wasm' | 'native' | 'none';
}
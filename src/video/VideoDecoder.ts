import { QRDecoder, DecodedQRResult, ReconstructionResult, BatchDecodingOptions } from '../qr/QRDecoder.js';
import { FrameExtractor, ImageDataLike, FrameExtractionOptions } from './FrameExtractor.js';
import type { MemoryItem } from '../types/Memory.js';
import * as zlib from 'zlib';

/**
 * Video decoding options
 */
export interface VideoDecodingOptions {
  /** Timeout for frame extraction in milliseconds */
  extractionTimeoutMs?: number;
  /** Timeout for QR decoding in milliseconds */
  qrTimeoutMs?: number;
  /** Maximum concurrent frame extractions */
  maxConcurrency?: number;
  /** Skip invalid frames during batch processing */
  skipInvalidFrames?: boolean;
  /** Enable high-quality frame scaling */
  highQualityScaling?: boolean;
  /** Progress callback for batch operations */
  progressCallback?: (current: number, total: number) => void;
}

/**
 * Video decoding result
 */
export interface VideoDecodingResult {
  success: boolean;
  memoryItem?: MemoryItem;
  error?: string;
  metadata?: {
    frameExtractionTimeMs: number;
    qrDecodingTimeMs: number;
    totalTimeMs: number;
    frameIndex: number;
    isCompressed: boolean;
    originalSize: number;
  };
}

/**
 * Batch video decoding result
 */
export interface BatchVideoDecodingResult {
  success: boolean;
  results: VideoDecodingResult[];
  error?: string;
  metadata?: {
    totalFramesRequested: number;
    validFramesExtracted: number;
    successfulDecodes: number;
    totalTimeMs: number;
    averageTimePerFrame: number;
  };
}

/**
 * VideoDecoder handles decoding video-encoded memory items back to their original form
 * Combines frame extraction with QR decoding to reconstruct MemoryItem objects
 */
export class VideoDecoder {
  private frameExtractor: FrameExtractor;
  private qrDecoder: QRDecoder;
  private initialized = false;

  constructor(frameExtractor?: FrameExtractor, qrDecoder?: QRDecoder) {
    this.frameExtractor = frameExtractor || new FrameExtractor();
    this.qrDecoder = qrDecoder || new QRDecoder();
  }

  /**
   * Initialize the video decoder
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.frameExtractor.initialize();
      await this.qrDecoder.initialize();
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize video decoder: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decode a single frame from a video to reconstruct a MemoryItem with comprehensive error handling
   */
  async decodeFrame(
    videoPath: string,
    frameIndex: number,
    options: VideoDecodingOptions = {}
  ): Promise<VideoDecodingResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const {
      extractionTimeoutMs = 10000,
      qrTimeoutMs = 5000,
      highQualityScaling = false
    } = options;

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Step 1: Extract frame from video with retry logic
        const extractionStartTime = Date.now();
        const frameResult = await this.frameExtractor.extractFrame(videoPath, {
          frameIndex,
          format: 'rgba',
          highQuality: highQualityScaling || attempt > 0, // Use high quality on retries
          timeoutMs: extractionTimeoutMs * (attempt + 1) // Increase timeout on retries
        });

        const frameExtractionTimeMs = Date.now() - extractionStartTime;

        if (!frameResult.success || !frameResult.imageData) {
          const error = new Error(`Frame extraction failed: ${frameResult.error}`);
          if (attempt < maxRetries) {
            lastError = error;
            console.warn(`Frame extraction attempt ${attempt + 1} failed, retrying:`, error);
            continue;
          }
          return {
            success: false,
            error: error.message,
            metadata: {
              frameExtractionTimeMs,
              qrDecodingTimeMs: 0,
              totalTimeMs: Date.now() - startTime,
              frameIndex,
              isCompressed: false,
              originalSize: 0
            }
          };
        }

        // Step 2: Decode QR from extracted frame with multiple strategies
        const qrDecodingStartTime = Date.now();
        let qrResult = await this.qrDecoder.decodeQRFrame(frameResult.imageData);

        // If QR decoding fails, try with enhanced contrast/processing
        if (!qrResult.success && attempt === 0) {
          console.warn('Initial QR decoding failed, trying with enhanced processing...');
          const enhancedImageData = await this.enhanceImageForQRDecoding(frameResult.imageData);
          if (enhancedImageData) {
            qrResult = await this.qrDecoder.decodeQRFrame(enhancedImageData);
          }
        }

        const qrDecodingTimeMs = Date.now() - qrDecodingStartTime;

        if (!qrResult.success || !qrResult.content || !qrResult.metadata) {
          const error = new Error(`QR decoding failed: ${qrResult.error}`);
          if (attempt < maxRetries) {
            lastError = error;
            console.warn(`QR decoding attempt ${attempt + 1} failed, retrying:`, error);
            continue;
          }
          return {
            success: false,
            error: error.message,
            metadata: {
              frameExtractionTimeMs,
              qrDecodingTimeMs,
              totalTimeMs: Date.now() - startTime,
              frameIndex,
              isCompressed: false,
              originalSize: 0
            }
          };
        }

        // Step 3: Reconstruct MemoryItem from decoded content with validation
        const memoryItem = await this.reconstructMemoryItem(qrResult);

        if (!memoryItem) {
          const error = new Error('Failed to reconstruct memory item from decoded content');
          if (attempt < maxRetries) {
            lastError = error;
            console.warn(`Memory item reconstruction attempt ${attempt + 1} failed, retrying:`, error);
            continue;
          }
          return {
            success: false,
            error: error.message,
            metadata: {
              frameExtractionTimeMs,
              qrDecodingTimeMs,
              totalTimeMs: Date.now() - startTime,
              frameIndex,
              isCompressed: false,
              originalSize: 0
            }
          };
        }

        // Success - validate the reconstructed item
        const validationError = this.validateMemoryItem(memoryItem);
        if (validationError && attempt < maxRetries) {
          lastError = new Error(validationError);
          console.warn(`Memory item validation failed on attempt ${attempt + 1}, retrying:`, validationError);
          continue;
        }

        return {
          success: true,
          memoryItem,
          metadata: {
            frameExtractionTimeMs,
            qrDecodingTimeMs,
            totalTimeMs: Date.now() - startTime,
            frameIndex,
            isCompressed: this.wasContentCompressed(qrResult.content),
            originalSize: qrResult.content.length
          }
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          console.warn(`Video decoding attempt ${attempt + 1} failed, retrying:`, lastError);
          continue;
        }
      }
    }

    // All attempts failed
    return {
      success: false,
      error: `Video decoding failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message || 'Unknown error'}`,
      metadata: {
        frameExtractionTimeMs: 0,
        qrDecodingTimeMs: 0,
        totalTimeMs: Date.now() - startTime,
        frameIndex,
        isCompressed: false,
        originalSize: 0
      }
    };
  }

  /**
   * Decode multiple frames to reconstruct a multi-frame memory item
   */
  async decodeMultiFrame(
    videoPath: string,
    frameIndices: number[],
    options: VideoDecodingOptions = {}
  ): Promise<BatchVideoDecodingResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const {
      maxConcurrency = 4,
      skipInvalidFrames = true,
      progressCallback
    } = options;

    try {
      // Step 1: Extract all required frames
      const frameResults = await this.frameExtractor.extractFrames(
        videoPath,
        frameIndices,
        {
          format: 'rgba',
          highQuality: options.highQualityScaling,
          timeoutMs: options.extractionTimeoutMs
        }
      );

      // Filter successful extractions
      const validFrames = frameResults
        .map((result, index) => ({ result, originalIndex: frameIndices[index] }))
        .filter(item => item.result.success && item.result.imageData);

      if (validFrames.length === 0) {
        return {
          success: false,
          results: [],
          error: 'No frames could be extracted from video',
          metadata: {
            totalFramesRequested: frameIndices.length,
            validFramesExtracted: 0,
            successfulDecodes: 0,
            totalTimeMs: Date.now() - startTime,
            averageTimePerFrame: 0
          }
        };
      }

      // Step 2: Batch decode QR codes from extracted frames
      const imageDataArray: ImageDataLike[] = validFrames
        .map(item => item.result.imageData!)
        .filter(data => data !== undefined);

      const batchOptions: BatchDecodingOptions = {
        maxConcurrency,
        timeoutMs: options.qrTimeoutMs || 5000,
        skipInvalidFrames,
        progressCallback: progressCallback ? (processed, total) => {
          progressCallback(processed, frameIndices.length);
        } : undefined
      };

      const decodedFrames = await this.qrDecoder.batchDecode(imageDataArray, batchOptions);

      // Step 3: Reconstruct content from decoded frames
      const reconstructionResult = await this.qrDecoder.reconstructMultiFrame(decodedFrames);

      if (!reconstructionResult.success || !reconstructionResult.originalContent) {
        return {
          success: false,
          results: [],
          error: `Multi-frame reconstruction failed: ${reconstructionResult.error}`,
          metadata: {
            totalFramesRequested: frameIndices.length,
            validFramesExtracted: validFrames.length,
            successfulDecodes: 0,
            totalTimeMs: Date.now() - startTime,
            averageTimePerFrame: 0
          }
        };
      }

      // Step 4: Reconstruct MemoryItem from content
      const memoryItem = await this.reconstructMemoryItemFromBytes(reconstructionResult.originalContent);

      if (!memoryItem) {
        return {
          success: false,
          results: [],
          error: 'Failed to reconstruct memory item from multi-frame content'
        };
      }

      const totalTimeMs = Date.now() - startTime;

      // Create result for the reconstructed item
      const result: VideoDecodingResult = {
        success: true,
        memoryItem,
        metadata: {
          frameExtractionTimeMs: 0, // Distributed across frames
          qrDecodingTimeMs: 0,      // Distributed across frames
          totalTimeMs: totalTimeMs,
          frameIndex: frameIndices[0], // First frame index
          isCompressed: reconstructionResult.metadata?.isCompressed || false,
          originalSize: reconstructionResult.metadata?.originalSize || 0
        }
      };

      return {
        success: true,
        results: [result],
        metadata: {
          totalFramesRequested: frameIndices.length,
          validFramesExtracted: validFrames.length,
          successfulDecodes: 1,
          totalTimeMs,
          averageTimePerFrame: totalTimeMs / frameIndices.length
        }
      };

    } catch (error) {
      return {
        success: false,
        results: [],
        error: `Multi-frame video decoding failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          totalFramesRequested: frameIndices.length,
          validFramesExtracted: 0,
          successfulDecodes: 0,
          totalTimeMs: Date.now() - startTime,
          averageTimePerFrame: 0
        }
      };
    }
  }

  /**
   * Reconstruct MemoryItem from a single decoded QR result
   */
  private async reconstructMemoryItem(qrResult: DecodedQRResult): Promise<MemoryItem | null> {
    if (!qrResult.success || !qrResult.content) {
      return null;
    }

    try {
      // Handle decompression if needed
      let contentBytes = qrResult.content;

      // Check if content is compressed (starts with gzip magic bytes)
      if (contentBytes.length >= 2 && contentBytes[0] === 0x1f && contentBytes[1] === 0x8b) {
        try {
          const decompressed = zlib.gunzipSync(contentBytes);
          contentBytes = new Uint8Array(decompressed);
        } catch (error) {
          console.warn('Failed to decompress QR content, using original:', error);
        }
      }

      // Convert bytes to string and parse JSON
      const contentString = new TextDecoder('utf-8').decode(contentBytes);
      const parsedData = JSON.parse(contentString);

      // Reconstruct MemoryItem with full interface compliance
      const memoryItem: MemoryItem = {
        id: parsedData.id,
        type: parsedData.type,
        scope: parsedData.scope || 'local',
        title: parsedData.title,
        text: parsedData.text || undefined,
        code: parsedData.code || undefined,
        language: parsedData.language,
        facets: {
          tags: parsedData.tags || [],
          files: parsedData.files || [],
          symbols: parsedData.symbols || []
        },
        context: parsedData.context || {},
        quality: {
          confidence: parsedData.confidence || 0.8,
          reuseCount: parsedData.reuseCount || 0,
          pinned: parsedData.pinned || false
        },
        security: {
          sensitivity: parsedData.sensitivity || 'private'
        },
        vectors: parsedData.vectors,
        links: parsedData.links,
        createdAt: parsedData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(), // Always update timestamp for decoded items
        version: parsedData.version || 1
      };

      return memoryItem;

    } catch (error) {
      console.error('Failed to reconstruct memory item:', error);
      return null;
    }
  }

  /**
   * Reconstruct MemoryItem from multi-frame decoded bytes
   */
  private async reconstructMemoryItemFromBytes(content: string | Uint8Array): Promise<MemoryItem | null> {
    try {
      let contentString: string;

      if (content instanceof Uint8Array) {
        contentString = new TextDecoder('utf-8').decode(content);
      } else {
        contentString = content;
      }

      const parsedData = JSON.parse(contentString);

      // Reconstruct MemoryItem with full interface compliance
      const memoryItem: MemoryItem = {
        id: parsedData.id,
        type: parsedData.type,
        scope: parsedData.scope || 'local',
        title: parsedData.title,
        text: parsedData.text || undefined,
        code: parsedData.code || undefined,
        language: parsedData.language,
        facets: {
          tags: parsedData.tags || [],
          files: parsedData.files || [],
          symbols: parsedData.symbols || []
        },
        context: parsedData.context || {},
        quality: {
          confidence: parsedData.confidence || 0.8,
          reuseCount: parsedData.reuseCount || 0,
          pinned: parsedData.pinned || false
        },
        security: {
          sensitivity: parsedData.sensitivity || 'private'
        },
        vectors: parsedData.vectors,
        links: parsedData.links,
        createdAt: parsedData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(), // Always update timestamp for decoded items
        version: parsedData.version || 1
      };

      return memoryItem;

    } catch (error) {
      console.error('Failed to reconstruct memory item from bytes:', error);
      return null;
    }
  }

  /**
   * Check if content was compressed (simple heuristic)
   */
  private wasContentCompressed(content: Uint8Array): boolean {
    return content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b;
  }

  /**
   * Enhance image data for better QR decoding (contrast enhancement, noise reduction)
   */
  private async enhanceImageForQRDecoding(imageData: ImageDataLike): Promise<ImageDataLike | null> {
    try {
      const { data, width, height } = imageData;
      const enhancedData = new Uint8ClampedArray(data.length);

      // Apply contrast enhancement and noise reduction
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        // Convert to grayscale for analysis
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // Apply high contrast threshold
        const enhanced = gray > 128 ? 255 : 0;

        enhancedData[i] = enhanced;     // R
        enhancedData[i + 1] = enhanced; // G
        enhancedData[i + 2] = enhanced; // B
        enhancedData[i + 3] = a;        // A
      }

      return {
        data: enhancedData,
        width,
        height
      };
    } catch (error) {
      console.warn('Failed to enhance image for QR decoding:', error);
      return null;
    }
  }

  /**
   * Validate a reconstructed memory item for completeness and correctness
   */
  private validateMemoryItem(memoryItem: MemoryItem): string | null {
    try {
      // Check required fields
      if (!memoryItem.id || typeof memoryItem.id !== 'string') {
        return 'Invalid or missing memory item ID';
      }

      if (!memoryItem.type || typeof memoryItem.type !== 'string') {
        return 'Invalid or missing memory item type';
      }

      if (!memoryItem.scope || typeof memoryItem.scope !== 'string') {
        return 'Invalid or missing memory item scope';
      }

      if (!memoryItem.title || typeof memoryItem.title !== 'string') {
        return 'Invalid or missing memory item title';
      }

      // Check that we have meaningful content
      const hasText = memoryItem.text && memoryItem.text.trim().length > 0;
      const hasCode = memoryItem.code && memoryItem.code.trim().length > 0;
      const hasTitle = memoryItem.title && memoryItem.title.trim().length > 0;

      if (!hasText && !hasCode && !hasTitle) {
        return 'Memory item has no meaningful content (text, code, and title are all empty)';
      }

      // Check required complex fields
      if (!memoryItem.facets || typeof memoryItem.facets !== 'object') {
        return 'Invalid or missing memory item facets';
      }

      if (!memoryItem.context || typeof memoryItem.context !== 'object') {
        return 'Invalid or missing memory item context';
      }

      if (!memoryItem.quality || typeof memoryItem.quality !== 'object') {
        return 'Invalid or missing memory item quality';
      }

      if (!memoryItem.security || typeof memoryItem.security !== 'object') {
        return 'Invalid or missing memory item security';
      }

      // Validate facets structure
      if (!Array.isArray(memoryItem.facets.tags)) {
        return 'Memory item facets.tags must be an array';
      }

      if (!Array.isArray(memoryItem.facets.files)) {
        return 'Memory item facets.files must be an array';
      }

      if (!Array.isArray(memoryItem.facets.symbols)) {
        return 'Memory item facets.symbols must be an array';
      }

      return null; // No validation errors
    } catch (error) {
      return `Memory item validation error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Check if video decoder is ready
   */
  async isReady(): Promise<boolean> {
    if (!this.initialized) {
      try {
        await this.initialize();
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Get decoder information
   */
  getInfo() {
    return {
      name: 'Video Memory Decoder',
      version: '1.0.0',
      capabilities: [
        'Single frame decoding',
        'Multi-frame batch decoding',
        'QR code reconstruction',
        'Automatic decompression',
        'MemoryItem reconstruction',
        'Sub-100ms single frame decoding'
      ],
      frameExtractor: this.frameExtractor.getInfo(),
      qrDecoder: this.qrDecoder.getDecoderInfo()
    };
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    try {
      await this.frameExtractor.dispose();
      this.qrDecoder.dispose();
      this.initialized = false;
    } catch (error) {
      console.warn('Error during video decoder disposal:', error);
    }
  }
}

/**
 * Factory function to create and initialize a video decoder
 */
export async function createVideoDecoder(
  frameExtractor?: FrameExtractor,
  qrDecoder?: QRDecoder
): Promise<VideoDecoder> {
  const decoder = new VideoDecoder(frameExtractor, qrDecoder);
  await decoder.initialize();
  return decoder;
}

/**
 * Check if video decoding is supported in the current environment
 */
export async function isVideoDecodingSupported(): Promise<boolean> {
  try {
    const decoder = new VideoDecoder();
    const isReady = await decoder.isReady();
    await decoder.dispose();
    return isReady;
  } catch {
    return false;
  }
}
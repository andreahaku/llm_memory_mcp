import { readBarcodes, prepareZXingModule } from 'zxing-wasm';
import * as zlib from 'zlib';

/**
 * ImageData-like interface for decoder input
 */
interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decoded QR result with metadata
 */
export interface DecodedQRResult {
  success: boolean;
  content?: Uint8Array;
  metadata?: ChunkMetadata;
  error?: string;
  rawData?: Uint8Array;
}

/**
 * Chunk metadata extracted from QR frame header
 */
export interface ChunkMetadata {
  magicNumber: number;
  chunkIndex: number;
  totalChunks: number;
  dataLength: number;
  chunkIdHash: number;
  isValid: boolean;
}

/**
 * Multi-frame reconstruction result
 */
export interface ReconstructionResult {
  success: boolean;
  originalContent?: string | Uint8Array;
  metadata?: {
    totalFrames: number;
    processedFrames: number;
    missingFrames: number[];
    isCompressed: boolean;
    originalSize: number;
    contentHash: string;
  };
  error?: string;
}

/**
 * Decoded frame with validation status
 */
export interface DecodedFrame {
  frameIndex: number;
  chunkMetadata: ChunkMetadata;
  payload: Uint8Array;
  isValid: boolean;
  error?: string;
}

/**
 * Batch decoding options
 */
export interface BatchDecodingOptions {
  maxConcurrency?: number;
  timeoutMs?: number;
  skipInvalidFrames?: boolean;
  progressCallback?: (processed: number, total: number, current?: DecodedFrame) => void;
}

/**
 * QRDecoder handles decoding QR codes back to original content
 * Integrates with ZXing WASM for robust decoding under compression artifacts
 */
export class QRDecoder {
  private initialized = false;
  private readonly MAGIC_NUMBER = 0x4D454D56; // "MEMV"
  private readonly CHUNK_HEADER_SIZE = 16;

  /**
   * Initialize the ZXing WASM module
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Prepare the ZXing module for immediate use
      await prepareZXingModule({ fireImmediately: true });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize ZXing WASM module: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decode a single QR code from RGBA ImageData
   */
  public async decodeQRFrame(imageData: ImageDataLike): Promise<DecodedQRResult> {
    if (!this.initialized) {
      throw new Error('QRDecoder not initialized. Call initialize() first.');
    }

    try {
      // For better ZXing compatibility, let's convert RGBA to grayscale
      // and ensure we have high contrast
      const grayscaleData = this.convertRGBAToGrayscale(imageData);

      // Optional debug logging (can be enabled for troubleshooting)
      // console.debug('Image dimensions:', imageData.width, 'x', imageData.height);

      // Create proper ImageData for zxing-wasm
      let input: ImageData | Uint8Array;

      if (typeof globalThis.ImageData !== 'undefined') {
        // Browser environment - create grayscale ImageData by expanding to RGBA
        const rgbaData = new Uint8ClampedArray(imageData.width * imageData.height * 4);
        for (let i = 0; i < grayscaleData.length; i++) {
          const gray = grayscaleData[i];
          const rgbaIndex = i * 4;
          rgbaData[rgbaIndex] = gray;     // R
          rgbaData[rgbaIndex + 1] = gray; // G
          rgbaData[rgbaIndex + 2] = gray; // B
          rgbaData[rgbaIndex + 3] = 255;  // A
        }
        input = new globalThis.ImageData(rgbaData, imageData.width, imageData.height);
      } else {
        // Node.js - use the original RGBA data
        const properBuffer = new ArrayBuffer(imageData.data.length);
        const properData = new Uint8ClampedArray(properBuffer);
        properData.set(imageData.data);

        // Create mock ImageData for Node.js
        input = {
          data: properData,
          width: imageData.width,
          height: imageData.height,
          colorSpace: 'srgb' as PredefinedColorSpace
        } as ImageData;
      }

      // Use modern zxing-wasm API to read barcodes with more permissive settings
      // Try with all formats first to see if we can detect anything
      const results = await readBarcodes(input, {
        formats: [], // Empty array means all formats
        tryHarder: true,     // Enable more thorough scanning
        tryRotate: true,     // Try different orientations
        tryInvert: true      // Try inverted images
      });

      if (!results || results.length === 0) {
        return {
          success: false,
          error: 'No QR code found or unreadable'
        };
      }

      // Take the first (and typically only) result
      const result = results[0];

      // Optional debug logging for troubleshooting
      // console.debug('ZXing result format:', result?.format, 'bytes:', result?.bytes?.length);

      if (!result.text && !result.bytes) {
        return {
          success: false,
          error: 'QR code found but no text content or bytes'
        };
      }

      // Convert decoded result to bytes - prefer bytes over text for binary data
      let rawData: Uint8Array;
      if (result.bytes && result.bytes.length > 0) {
        rawData = new Uint8Array(result.bytes);
      } else if (result.text) {
        rawData = this.stringToUint8Array(result.text);
      } else {
        return {
          success: false,
          error: 'No decodable content found in QR result'
        };
      }

      // Extract and validate chunk metadata
      const metadata = this.extractChunkMetadata(rawData);

      if (!metadata.isValid) {
        return {
          success: false,
          error: 'Invalid chunk metadata or corrupted header',
          rawData
        };
      }

      // Extract payload (data after header)
      const payload = rawData.slice(this.CHUNK_HEADER_SIZE);

      if (payload.length !== metadata.dataLength) {
        return {
          success: false,
          error: `Payload length mismatch. Expected: ${metadata.dataLength}, Got: ${payload.length}`,
          metadata,
          rawData
        };
      }

      return {
        success: true,
        content: payload,
        metadata,
        rawData
      };

    } catch (error) {
      return {
        success: false,
        error: `Decoding failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Batch decode multiple QR frames with optimizations
   */
  public async batchDecode(
    imageDataArray: ImageDataLike[],
    options: BatchDecodingOptions = {}
  ): Promise<DecodedFrame[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      maxConcurrency = 4,
      timeoutMs = 5000,
      skipInvalidFrames = true,
      progressCallback
    } = options;

    const results: DecodedFrame[] = [];
    const totalFrames = imageDataArray.length;

    // Process frames in batches to control concurrency
    for (let i = 0; i < totalFrames; i += maxConcurrency) {
      const batch = imageDataArray.slice(i, Math.min(i + maxConcurrency, totalFrames));
      const batchPromises = batch.map(async (imageData, batchIndex) => {
        const frameIndex = i + batchIndex;

        try {
          // Add timeout to individual frame processing
          const decodePromise = this.decodeQRFrame(imageData);
          const timeoutPromise = new Promise<DecodedQRResult>((_, reject) => {
            setTimeout(() => reject(new Error('Decode timeout')), timeoutMs);
          });

          const result = await Promise.race([decodePromise, timeoutPromise]);

          if (result.success && result.content && result.metadata) {
            const decodedFrame: DecodedFrame = {
              frameIndex,
              chunkMetadata: result.metadata,
              payload: result.content,
              isValid: true
            };

            if (progressCallback) {
              progressCallback(frameIndex + 1, totalFrames, decodedFrame);
            }

            return decodedFrame;
          } else {
            const errorFrame: DecodedFrame = {
              frameIndex,
              chunkMetadata: {
                magicNumber: 0,
                chunkIndex: -1,
                totalChunks: 0,
                dataLength: 0,
                chunkIdHash: 0,
                isValid: false
              },
              payload: new Uint8Array(0),
              isValid: false,
              error: result.error || 'Unknown decode error'
            };

            if (progressCallback) {
              progressCallback(frameIndex + 1, totalFrames, errorFrame);
            }

            return skipInvalidFrames ? null : errorFrame;
          }

        } catch (error) {
          const errorFrame: DecodedFrame = {
            frameIndex,
            chunkMetadata: {
              magicNumber: 0,
              chunkIndex: -1,
              totalChunks: 0,
              dataLength: 0,
              chunkIdHash: 0,
              isValid: false
            },
            payload: new Uint8Array(0),
            isValid: false,
            error: error instanceof Error ? error.message : String(error)
          };

          if (progressCallback) {
            progressCallback(frameIndex + 1, totalFrames, errorFrame);
          }

          return skipInvalidFrames ? null : errorFrame;
        }
      });

      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null) as DecodedFrame[]);
    }

    return results;
  }

  /**
   * Reconstruct original content from multiple decoded frames
   */
  public async reconstructMultiFrame(decodedFrames: DecodedFrame[]): Promise<ReconstructionResult> {
    try {
      // Filter out invalid frames
      const validFrames = decodedFrames.filter(frame => frame.isValid);

      if (validFrames.length === 0) {
        return {
          success: false,
          error: 'No valid frames available for reconstruction'
        };
      }

      // Determine total frames from metadata
      const totalFrames = validFrames[0].chunkMetadata.totalChunks;
      const processedFrames = validFrames.length;

      // Check if we have all required frames
      const missingFrames: number[] = [];
      const frameMap = new Map<number, DecodedFrame>();

      // Map frames by chunk index
      for (const frame of validFrames) {
        frameMap.set(frame.chunkMetadata.chunkIndex, frame);
      }

      // Find missing frames
      for (let i = 0; i < totalFrames; i++) {
        if (!frameMap.has(i)) {
          missingFrames.push(i);
        }
      }

      if (missingFrames.length > 0) {
        return {
          success: false,
          error: `Missing frames: ${missingFrames.join(', ')}`,
          metadata: {
            totalFrames,
            processedFrames,
            missingFrames,
            isCompressed: false,
            originalSize: 0,
            contentHash: ''
          }
        };
      }

      // Reconstruct data by combining chunks in order
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      for (let i = 0; i < totalFrames; i++) {
        const frame = frameMap.get(i);
        if (!frame) {
          throw new Error(`Frame ${i} is missing during reconstruction`);
        }
        chunks.push(frame.payload);
        totalSize += frame.payload.length;
      }

      // Combine all chunks
      const combinedData = new Uint8Array(totalSize);
      let offset = 0;

      for (const chunk of chunks) {
        combinedData.set(chunk, offset);
        offset += chunk.length;
      }

      // Attempt decompression if needed
      const { content, isCompressed, originalSize } = await this.handleDecompression(combinedData);

      // Calculate content hash for verification
      const contentHash = this.calculateHash(content);

      return {
        success: true,
        originalContent: content,
        metadata: {
          totalFrames,
          processedFrames,
          missingFrames: [],
          isCompressed,
          originalSize,
          contentHash
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Reconstruction failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Decode QR frames and reconstruct original content in one operation
   */
  public async decodeAndReconstruct(
    imageDataArray: ImageDataLike[],
    options: BatchDecodingOptions = {}
  ): Promise<ReconstructionResult> {
    try {
      // Batch decode all frames
      const decodedFrames = await this.batchDecode(imageDataArray, options);

      // Reconstruct original content
      return await this.reconstructMultiFrame(decodedFrames);

    } catch (error) {
      return {
        success: false,
        error: `Decode and reconstruct failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }


  /**
   * Convert RGBA image data to grayscale for better QR detection
   */
  private convertRGBAToGrayscale(imageData: ImageDataLike): Uint8Array {
    const { data, width, height } = imageData;
    const grayscale = new Uint8Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      // Use luminance formula for grayscale conversion
      // Apply high contrast: make very light pixels white, very dark pixels black
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grayscale[i] = gray < 128 ? 0 : 255; // High contrast thresholding
    }

    return grayscale;
  }

  /**
   * Convert string back to Uint8Array (reverse of QRManager encoding)
   */
  private stringToUint8Array(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xFF; // Ensure byte range
    }
    return bytes;
  }

  /**
   * Extract and validate chunk metadata from raw data
   */
  private extractChunkMetadata(data: Uint8Array): ChunkMetadata {
    if (data.length < this.CHUNK_HEADER_SIZE) {
      return {
        magicNumber: 0,
        chunkIndex: -1,
        totalChunks: 0,
        dataLength: 0,
        chunkIdHash: 0,
        isValid: false
      };
    }

    const view = new DataView(data.buffer, data.byteOffset, this.CHUNK_HEADER_SIZE);

    const magicNumber = view.getUint32(0);
    const chunkIndex = view.getUint16(4);
    const totalChunks = view.getUint16(6);
    const dataLength = view.getUint32(8);
    const chunkIdHash = view.getUint32(12);

    const isValid = (
      magicNumber === this.MAGIC_NUMBER &&
      chunkIndex >= 0 &&
      totalChunks > 0 &&
      chunkIndex < totalChunks &&
      dataLength > 0 &&
      dataLength <= (data.length - this.CHUNK_HEADER_SIZE)
    );

    return {
      magicNumber,
      chunkIndex,
      totalChunks,
      dataLength,
      chunkIdHash,
      isValid
    };
  }

  /**
   * Handle decompression of data if needed
   */
  private async handleDecompression(data: Uint8Array): Promise<{
    content: Uint8Array;
    isCompressed: boolean;
    originalSize: number;
  }> {
    console.log(`🔍 [QRDecoder] handleDecompression input: ${data.length} bytes`);
    console.log(`🔍 [QRDecoder] First 16 bytes: ${Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    try {
      // Check if data looks like gzip (starts with 0x1f, 0x8b)
      const isGzip = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
      console.log(`🔍 [QRDecoder] Gzip signature detected: ${isGzip}`);

      if (isGzip) {
        console.log(`🔍 [QRDecoder] Attempting gzip decompression...`);
        // Attempt decompression
        const decompressed = zlib.gunzipSync(data);
        const decompressedArray = new Uint8Array(decompressed);

        console.log(`✅ [QRDecoder] Decompression successful: ${data.length} → ${decompressedArray.length} bytes`);
        console.log(`🔍 [QRDecoder] Decompressed first 64 chars: "${new TextDecoder('utf-8').decode(decompressedArray.slice(0, 64))}"`);

        return {
          content: decompressedArray,
          isCompressed: true,
          originalSize: decompressedArray.length
        };
      }
    } catch (error) {
      // If decompression fails, fall back to original data
      console.warn('❌ [QRDecoder] Decompression failed, using original data:', error);
      console.log(`🔍 [QRDecoder] Raw data first 64 chars: "${new TextDecoder('utf-8', {fatal: false}).decode(data.slice(0, 64))}"`);
    }

    console.log(`📝 [QRDecoder] Using uncompressed data: ${data.length} bytes`);
    return {
      content: data,
      isCompressed: false,
      originalSize: data.length
    };
  }

  /**
   * Calculate content hash for verification (matches QRManager implementation)
   */
  private calculateHash(data: Uint8Array): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Validate frame sequence and detect missing frames
   */
  public validateFrameSequence(frames: DecodedFrame[]): {
    isComplete: boolean;
    missingFrames: number[];
    duplicateFrames: number[];
    invalidFrames: number[];
    totalExpected: number;
  } {
    const validFrames = frames.filter(f => f.isValid);
    const invalidFrames = frames.filter(f => !f.isValid).map(f => f.frameIndex);

    if (validFrames.length === 0) {
      return {
        isComplete: false,
        missingFrames: [],
        duplicateFrames: [],
        invalidFrames,
        totalExpected: 0
      };
    }

    const totalExpected = validFrames[0].chunkMetadata.totalChunks;
    const chunkIndexMap = new Map<number, number[]>();

    // Group frames by chunk index
    for (const frame of validFrames) {
      const chunkIndex = frame.chunkMetadata.chunkIndex;
      if (!chunkIndexMap.has(chunkIndex)) {
        chunkIndexMap.set(chunkIndex, []);
      }
      chunkIndexMap.get(chunkIndex)!.push(frame.frameIndex);
    }

    const missingFrames: number[] = [];
    const duplicateFrames: number[] = [];

    // Check for missing and duplicate frames
    for (let i = 0; i < totalExpected; i++) {
      const frameIndices = chunkIndexMap.get(i);
      if (!frameIndices || frameIndices.length === 0) {
        missingFrames.push(i);
      } else if (frameIndices.length > 1) {
        duplicateFrames.push(...frameIndices.slice(1)); // Keep first, mark others as duplicates
      }
    }

    return {
      isComplete: missingFrames.length === 0,
      missingFrames,
      duplicateFrames,
      invalidFrames,
      totalExpected
    };
  }

  /**
   * Attempt to recover content from partially decoded frames
   */
  public async attemptPartialReconstruction(frames: DecodedFrame[]): Promise<ReconstructionResult> {
    const validation = this.validateFrameSequence(frames);

    if (validation.isComplete) {
      return await this.reconstructMultiFrame(frames);
    }

    // Try to reconstruct with available frames
    const validFrames = frames.filter(f => f.isValid);
    const availableChunks = new Map<number, DecodedFrame>();

    for (const frame of validFrames) {
      const chunkIndex = frame.chunkMetadata.chunkIndex;
      if (!availableChunks.has(chunkIndex)) {
        availableChunks.set(chunkIndex, frame);
      }
    }

    // Create partial content with gaps filled with zeros or markers
    const chunks: Uint8Array[] = [];
    let hasGaps = false;

    for (let i = 0; i < validation.totalExpected; i++) {
      const frame = availableChunks.get(i);
      if (frame) {
        chunks.push(frame.payload);
      } else {
        // Insert placeholder for missing chunk
        chunks.push(new Uint8Array(0)); // Empty chunk as placeholder
        hasGaps = true;
      }
    }

    if (hasGaps) {
      return {
        success: false,
        error: `Partial reconstruction attempted but ${validation.missingFrames.length} frames are missing`,
        metadata: {
          totalFrames: validation.totalExpected,
          processedFrames: validFrames.length,
          missingFrames: validation.missingFrames,
          isCompressed: false,
          originalSize: 0,
          contentHash: ''
        }
      };
    }

    // If no gaps, proceed with normal reconstruction
    return await this.reconstructMultiFrame(validFrames);
  }

  /**
   * Get decoder statistics and performance info
   */
  public getDecoderInfo(): {
    initialized: boolean;
    zxingVersion: string | null;
    supportedFormats: string[];
  } {
    return {
      initialized: this.initialized,
      zxingVersion: this.initialized ? '2.2.x' : null, // ZXing WASM version
      supportedFormats: ['QRCode', 'DataMatrix', 'Aztec', 'PDF417', 'Code128', 'Code39', 'ITF'] // ZXing supported formats
    };
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    // ZXing WASM module cleanup is handled automatically by the library
    this.initialized = false;
  }
}
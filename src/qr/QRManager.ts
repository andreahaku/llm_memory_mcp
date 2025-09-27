import qrcode from 'qrcode-generator';
import * as zlib from 'zlib';

/**
 * ImageData-like interface for Node.js compatibility
 * In Node.js environment, we simulate browser ImageData
 */
interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * QR code generation parameters based on content size and requirements
 */
export interface QRParameters {
  version: number;
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  maxBytes: number;
  description: string;
}

/**
 * Frame metadata structure for video storage compatibility
 */
export interface QRFrameMetadata {
  frameIndex: number;
  totalFrames: number;
  contentHash: string;
  isCompressed: boolean;
  originalSize: number;
  encodedSize: number;
  qrVersion: number;
  qrErrorCorrection: string;
  timestamp: string;
  chunkId?: string;
}

/**
 * QR frame with image data and metadata
 */
export interface QRFrame {
  imageData: ImageDataLike;
  metadata: QRFrameMetadata;
  rawData: Uint8Array;
}

/**
 * Content chunk for multi-frame encoding
 */
export interface ContentChunk {
  data: Uint8Array;
  chunkIndex: number;
  totalChunks: number;
  chunkId: string;
}

/**
 * QR encoding result containing all generated frames
 */
export interface QREncodingResult {
  frames: QRFrame[];
  metadata: {
    totalFrames: number;
    originalSize: number;
    encodedSize: number;
    compressionRatio: number;
    isCompressed: boolean;
    contentHash: string;
  };
  manifest: Array<{
    chunkId: string;
    frameIndex: number;
    byteOffset: number;
  }>;
}

/**
 * QRManager handles encoding text/binary data to QR codes for video storage
 * Implements smart parameter selection, compression, and multi-frame splitting
 */
export class QRManager {
  private readonly COMPRESSION_THRESHOLD = 0.9; // Compress if result is <90% of original
  private readonly MAX_CHUNK_SIZE = 2953; // Max bytes for QR version 40 with ECC-L

  /**
   * Size-based parameter selection following Memvid patterns
   * Updated to match actual QR code capacities from the capacity table
   */
  private readonly SIZE_PARAMETERS: QRParameters[] = [
    {
      version: 6,
      errorCorrectionLevel: 'Q',
      maxBytes: 71,
      description: 'Small content, high error correction for video compression'
    },
    {
      version: 10,
      errorCorrectionLevel: 'M',
      maxBytes: 213,
      description: 'Medium content, balanced error correction'
    },
    {
      version: 15,
      errorCorrectionLevel: 'M',
      maxBytes: 415,
      description: 'Large content, medium error correction'
    },
    {
      version: 25,
      errorCorrectionLevel: 'L',
      maxBytes: 1273,
      description: 'Very large content, low error correction'
    },
    {
      version: 40,
      errorCorrectionLevel: 'L',
      maxBytes: 2953,
      description: 'Maximum content, minimal error correction'
    }
  ];

  /**
   * Encode text or binary data to QR code frames
   */
  public async encodeToQR(content: string | Uint8Array): Promise<QREncodingResult> {
    try {
    const originalData = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;

    const originalSize = originalData.length;
    const contentHash = this.calculateHash(originalData);

    // Try compression if beneficial
    const { data: processedData, isCompressed } = await this.compressIfWorthwhile(originalData);

    // Split into chunks if needed
    const chunks = this.splitIntoChunks(processedData);

    // IMPORTANT: For video compatibility, all QR frames must have identical dimensions
    // Find the maximum QR version needed for all chunks and use it for ALL frames
    const maxChunkSize = Math.max(...chunks.map(chunk => chunk.data.length + 16)); // +16 for header
    const uniformParameters = this.selectOptimalParameters(maxChunkSize);
    console.log(`🎯 Using uniform QR version ${uniformParameters.version} for all ${chunks.length} frames (max chunk: ${maxChunkSize} bytes)`);

    // Generate QR frames for each chunk
    const frames: QRFrame[] = [];
    const manifest: Array<{ chunkId: string; frameIndex: number; byteOffset: number }> = [];
    let byteOffset = 0;

    for (const chunk of chunks) {
      const qrFrame = await this.generateQRFrame(chunk, uniformParameters, {
        frameIndex: frames.length,
        totalFrames: chunks.length,
        contentHash,
        isCompressed,
        originalSize,
        encodedSize: processedData.length
      });

      frames.push(qrFrame);
      manifest.push({
        chunkId: chunk.chunkId,
        frameIndex: frames.length - 1,
        byteOffset
      });

      byteOffset += chunk.data.length;
    }

    return {
      frames,
      metadata: {
        totalFrames: frames.length,
        originalSize,
        encodedSize: processedData.length,
        compressionRatio: originalSize / processedData.length,
        isCompressed,
        contentHash
      },
      manifest
    };
    } catch (error) {
      throw new Error(`Failed to encode content to QR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Select optimal QR parameters based on content size
   */
  private selectOptimalParameters(contentSize: number): QRParameters {
    // Account for header overhead (16 bytes)
    const totalSize = contentSize + 16;

    for (const params of this.SIZE_PARAMETERS) {
      if (totalSize <= params.maxBytes) {
        return params;
      }
    }

    // Fallback to maximum parameters
    return this.SIZE_PARAMETERS[this.SIZE_PARAMETERS.length - 1];
  }

  /**
   * Compress data using gzip if result is smaller than threshold
   */
  private async compressIfWorthwhile(data: Uint8Array): Promise<{ data: Uint8Array; isCompressed: boolean }> {
    try {
      const compressed = zlib.gzipSync(data, { level: 6 });
      const compressedArray = new Uint8Array(compressed);

      // Check if compression is beneficial (less than 90% of original)
      if (compressedArray.length < data.length * this.COMPRESSION_THRESHOLD) {
        return { data: compressedArray, isCompressed: true };
      }
    } catch (error) {
      // If compression fails, fall back to original data
      console.warn('Compression failed, using original data:', error);
    }

    return { data, isCompressed: false };
  }

  /**
   * Split content into chunks suitable for QR encoding
   */
  private splitIntoChunks(data: Uint8Array): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    const totalSize = data.length;

    // Calculate optimal chunk size based on QR capacity (account for 16-byte header)
    const chunkSize = Math.min(this.MAX_CHUNK_SIZE - 16, totalSize);
    const totalChunks = Math.ceil(totalSize / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSize);
      const chunkData = data.slice(start, end);

      chunks.push({
        data: chunkData,
        chunkIndex: i,
        totalChunks,
        chunkId: this.generateChunkId(i, totalChunks)
      });
    }

    return chunks;
  }

  /**
   * Generate a single QR frame from a content chunk
   */
  private async generateQRFrame(
    chunk: ContentChunk,
    uniformParams: QRParameters,
    baseMetadata: Partial<QRFrameMetadata>
  ): Promise<QRFrame> {
    try {
      // Use provided uniform parameters to ensure consistent dimensions
      const params = uniformParams;

      // Create QR code with selected parameters
      const qr = qrcode(params.version as any, this.mapErrorCorrectionLevel(params.errorCorrectionLevel) as any);

      // Add chunk metadata header
      const header = this.createChunkHeader(chunk);
      const combinedData = this.combineHeaderAndData(header, chunk.data);

      // Add data to QR code
      qr.addData(this.uint8ArrayToString(combinedData), 'Byte');
      qr.make();

      // Generate RGBA ImageData for video compatibility
      const imageData = this.generateImageData(qr);

    const metadata: QRFrameMetadata = {
      frameIndex: baseMetadata.frameIndex || 0,
      totalFrames: baseMetadata.totalFrames || 1,
      contentHash: baseMetadata.contentHash || '',
      isCompressed: baseMetadata.isCompressed || false,
      originalSize: baseMetadata.originalSize || chunk.data.length,
      encodedSize: baseMetadata.encodedSize || chunk.data.length,
      qrVersion: params.version,
      qrErrorCorrection: params.errorCorrectionLevel,
      timestamp: new Date().toISOString(),
      chunkId: chunk.chunkId
    };

      return {
        imageData,
        metadata,
        rawData: combinedData
      };
    } catch (error) {
      throw new Error(`Failed to generate QR frame: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create chunk header with metadata for multi-frame reconstruction
   */
  private createChunkHeader(chunk: ContentChunk): Uint8Array {
    const header = new Uint8Array(16);
    const view = new DataView(header.buffer);

    // Magic number for chunk identification
    view.setUint32(0, 0x4D454D56); // "MEMV"

    // Chunk index and total
    view.setUint16(4, chunk.chunkIndex);
    view.setUint16(6, chunk.totalChunks);

    // Data length
    view.setUint32(8, chunk.data.length);

    // CRC32 of chunk ID (simplified hash)
    view.setUint32(12, this.simpleHash(chunk.chunkId));

    return header;
  }

  /**
   * Combine header and data into single array
   */
  private combineHeaderAndData(header: Uint8Array, data: Uint8Array): Uint8Array {
    const combined = new Uint8Array(header.length + data.length);
    combined.set(header, 0);
    combined.set(data, header.length);
    return combined;
  }

  /**
   * Generate RGBA ImageData from QR code for video encoding compatibility
   */
  private generateImageData(qr: any): ImageDataLike {
    const moduleCount = qr.getModuleCount();
    const scale = 4; // 4x4 pixels per module for better video compression
    const size = moduleCount * scale;

    const canvas = new Uint8ClampedArray(size * size * 4); // RGBA

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        const isDark = qr.isDark(row, col);
        const color = isDark ? 0 : 255; // Black modules = 0, white = 255

        // Fill scale x scale block for each module
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const pixelRow = row * scale + dy;
            const pixelCol = col * scale + dx;
            const pixelIndex = (pixelRow * size + pixelCol) * 4;

            canvas[pixelIndex] = color;     // R
            canvas[pixelIndex + 1] = color; // G
            canvas[pixelIndex + 2] = color; // B
            canvas[pixelIndex + 3] = 255;   // A (fully opaque)
          }
        }
      }
    }

    return {
      data: canvas,
      width: size,
      height: size
    };
  }

  /**
   * Map error correction level to QRCode library format
   */
  private mapErrorCorrectionLevel(level: 'L' | 'M' | 'Q' | 'H'): string {
    const mapping = {
      'L': 'L', // ~7% error correction
      'M': 'M', // ~15% error correction
      'Q': 'Q', // ~25% error correction
      'H': 'H'  // ~30% error correction
    };
    return mapping[level];
  }

  /**
   * Convert Uint8Array to string for QR encoding
   */
  private uint8ArrayToString(data: Uint8Array): string {
    return Array.from(data, byte => String.fromCharCode(byte)).join('');
  }

  /**
   * Calculate SHA-256-like hash for content identification
   */
  private calculateHash(data: Uint8Array): string {
    // Simple hash implementation (in production, use crypto.subtle.digest)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Generate unique chunk ID
   */
  private generateChunkId(chunkIndex: number, totalChunks: number): string {
    const timestamp = Date.now();
    return `chunk_${chunkIndex.toString().padStart(4, '0')}_of_${totalChunks.toString().padStart(4, '0')}_${timestamp}`;
  }

  /**
   * Simple hash function for chunk IDs
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Get QR capacity information for given parameters
   */
  public getCapacityInfo(version: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): {
    version: number;
    errorCorrection: string;
    maxBytes: number;
    moduleCount: number;
  } {
    // Simplified capacity lookup based on QR code specification
    // This is a rough approximation - actual values would come from QR spec tables
    const capacityTable: { [key: number]: { [key in 'L' | 'M' | 'Q' | 'H']: number } } = {
      1: { L: 17, M: 14, Q: 11, H: 7 },
      6: { L: 118, M: 95, Q: 71, H: 47 },
      10: { L: 262, M: 213, Q: 151, H: 97 },
      15: { L: 523, M: 415, Q: 289, H: 203 },
      25: { L: 1273, M: 1021, Q: 703, H: 439 },
      40: { L: 2953, M: 2331, Q: 1663, H: 1273 }
    };

    // Find closest version in our table
    let closestVersion = 1;
    for (const v of Object.keys(capacityTable).map(Number).sort((a, b) => a - b)) {
      if (v <= version) closestVersion = v;
    }

    const maxBytes = capacityTable[closestVersion]?.[errorCorrectionLevel] || 100;
    const moduleCount = 17 + 4 * version; // QR module count formula

    return {
      version,
      errorCorrection: errorCorrectionLevel,
      maxBytes,
      moduleCount
    };
  }

  /**
   * Estimate encoding efficiency for given content
   */
  public estimateEncoding(content: string | Uint8Array): {
    originalSize: number;
    estimatedFrames: number;
    estimatedCompressedSize: number;
    recommendedParameters: QRParameters;
  } {
    const data = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;

    const originalSize = data.length;

    // Estimate compression (very rough)
    const estimatedCompressedSize = Math.floor(originalSize * 0.7); // Assume 30% compression

    // Select parameters and estimate frames
    const params = this.selectOptimalParameters(estimatedCompressedSize);
    const estimatedFrames = Math.ceil(estimatedCompressedSize / params.maxBytes);

    return {
      originalSize,
      estimatedFrames,
      estimatedCompressedSize,
      recommendedParameters: params
    };
  }
}
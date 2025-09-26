/**
 * Video Decoder Utilities for VideoStorageAdapter
 * These utilities handle frame extraction from MP4 videos and QR code decoding
 */

import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import * as fs from 'fs-extra';
import type { QRFrame, QRFrameMetadata } from '../qr/QRManager.js';

/**
 * Extracted frame from video with metadata
 */
export interface ExtractedFrame {
  frameIndex: number;
  imageBuffer: Buffer;
  timestamp: number;
  width: number;
  height: number;
}

/**
 * QR decode result from extracted frame
 */
export interface QRDecodeResult {
  success: boolean;
  data: Uint8Array | null;
  metadata: QRFrameMetadata | null;
  error?: string;
}

/**
 * Video frame extraction and QR decoding utilities
 */
export class VideoDecoder {
  private tempDir: string;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.cwd(), '.tmp-video-decoding');
  }

  /**
   * Extract specific frames from MP4 video file
   * Uses FFmpeg to extract frames at precise indices
   */
  async extractFrames(
    videoPath: string,
    frameIndices: number[],
    fps = 30
  ): Promise<ExtractedFrame[]> {
    await fs.ensureDir(this.tempDir);

    const extractedFrames: ExtractedFrame[] = [];

    for (const frameIndex of frameIndices) {
      try {
        const frame = await this.extractSingleFrame(videoPath, frameIndex, fps);
        extractedFrames.push(frame);
      } catch (error) {
        console.warn(`Failed to extract frame ${frameIndex}:`, error);
      }
    }

    return extractedFrames;
  }

  /**
   * Extract a single frame from video at specific index
   */
  private async extractSingleFrame(
    videoPath: string,
    frameIndex: number,
    fps: number
  ): Promise<ExtractedFrame> {
    const timestamp = frameIndex / fps;
    const outputPath = path.join(this.tempDir, `frame_${frameIndex}_${Date.now()}.png`);

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-ss', timestamp.toString(), // Seek to specific timestamp
        '-vframes', '1', // Extract only 1 frame
        '-f', 'image2',
        '-vcodec', 'png',
        '-y', // Overwrite output file
        outputPath
      ], { stdio: 'pipe' });

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code === 0 && await fs.pathExists(outputPath)) {
          try {
            // Read extracted frame
            const imageBuffer = await fs.readFile(outputPath);

            // Get frame dimensions from FFmpeg output or use FFprobe
            const dimensions = await this.getImageDimensions(outputPath);

            // Clean up temporary file
            await fs.remove(outputPath);

            resolve({
              frameIndex,
              imageBuffer,
              timestamp: timestamp * 1000, // Convert to milliseconds
              width: dimensions.width,
              height: dimensions.height
            });
          } catch (error) {
            reject(new Error(`Failed to read extracted frame: ${error}`));
          }
        } else {
          reject(new Error(`FFmpeg frame extraction failed (code ${code}): ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });
    });
  }

  /**
   * Get image dimensions using FFprobe
   */
  private async getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        imagePath
      ], { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';

      ffprobe.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const data = JSON.parse(stdout);
            const videoStream = data.streams.find((s: any) => s.codec_type === 'video');

            if (videoStream) {
              resolve({
                width: videoStream.width || 0,
                height: videoStream.height || 0
              });
            } else {
              reject(new Error('No video stream found in image'));
            }
          } catch (error) {
            reject(new Error(`Failed to parse FFprobe output: ${error}`));
          }
        } else {
          reject(new Error(`FFprobe failed (code ${code}): ${stderr}`));
        }
      });

      ffprobe.on('error', (error) => {
        reject(new Error(`FFprobe process error: ${error.message}`));
      });
    });
  }

  /**
   * Decode QR codes from extracted frame images
   * This is a placeholder - actual implementation would require a QR decoder library
   */
  async decodeQRFromFrames(frames: ExtractedFrame[]): Promise<QRDecodeResult[]> {
    const results: QRDecodeResult[] = [];

    for (const frame of frames) {
      try {
        // Convert frame to ImageData format expected by QR decoder
        const imageData = await this.convertFrameToImageData(frame);

        // Decode QR from ImageData
        const qrResult = await this.decodeQRFromImageData(imageData);
        results.push(qrResult);
      } catch (error) {
        results.push({
          success: false,
          data: null,
          metadata: null,
          error: `QR decode failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    return results;
  }

  /**
   * Convert extracted frame to ImageData format
   * This requires converting PNG buffer to RGBA data
   */
  private async convertFrameToImageData(frame: ExtractedFrame): Promise<ImageData> {
    // TODO: Implement PNG to RGBA conversion
    // This would typically use a library like 'sharp' or 'canvas' to:
    // 1. Decode PNG buffer to raw pixel data
    // 2. Convert to RGBA format
    // 3. Return as ImageData-like object

    throw new Error('PNG to ImageData conversion not implemented - requires image processing library');
  }

  /**
   * Decode QR code from ImageData
   * This is a placeholder for QR code detection and decoding
   */
  private async decodeQRFromImageData(imageData: ImageData): Promise<QRDecodeResult> {
    // TODO: Implement actual QR code detection and decoding
    // This would require a QR code detection library like:
    // - jsqr (for JavaScript QR decoding)
    // - qrcode-reader
    // - Or integration with OpenCV for QR detection

    // For now, return a placeholder result
    return {
      success: false,
      data: null,
      metadata: null,
      error: 'QR decoding not implemented - requires QR detection library'
    };
  }

  /**
   * Reconstruct content from multi-frame QR sequence
   */
  async reconstructContent(qrResults: QRDecodeResult[]): Promise<{
    success: boolean;
    reconstructedData: Uint8Array | null;
    metadata: {
      totalFrames: number;
      successfulDecodes: number;
      isCompressed: boolean;
      originalSize: number;
    } | null;
  }> {
    const successfulResults = qrResults.filter(r => r.success && r.data && r.metadata);

    if (successfulResults.length === 0) {
      return {
        success: false,
        reconstructedData: null,
        metadata: null
      };
    }

    try {
      // Sort frames by their index for proper reconstruction
      const sortedFrames = successfulResults.sort((a, b) => {
        const aIdx = a.metadata?.frameIndex || 0;
        const bIdx = b.metadata?.frameIndex || 0;
        return aIdx - bIdx;
      });

      // Extract chunk data and remove headers
      const chunks: Uint8Array[] = [];
      for (const result of sortedFrames) {
        if (result.data) {
          // Remove 16-byte header added by QRManager
          const chunkData = result.data.slice(16);
          chunks.push(chunkData);
        }
      }

      // Combine chunks into single data array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedData = new Uint8Array(totalLength);

      let offset = 0;
      for (const chunk of chunks) {
        combinedData.set(chunk, offset);
        offset += chunk.length;
      }

      // Check if data was compressed and decompress if needed
      const firstMetadata = sortedFrames[0].metadata!;
      let finalData = combinedData;

      if (firstMetadata.isCompressed) {
        // TODO: Implement decompression using zlib
        // finalData = await this.decompressData(combinedData);
      }

      return {
        success: true,
        reconstructedData: finalData,
        metadata: {
          totalFrames: firstMetadata.totalFrames,
          successfulDecodes: successfulResults.length,
          isCompressed: firstMetadata.isCompressed,
          originalSize: firstMetadata.originalSize
        }
      };

    } catch (error) {
      return {
        success: false,
        reconstructedData: null,
        metadata: null
      };
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanup(): Promise<void> {
    try {
      if (await fs.pathExists(this.tempDir)) {
        await fs.remove(this.tempDir);
      }
    } catch (error) {
      console.warn('Failed to cleanup video decoder temp files:', error);
    }
  }
}

/**
 * Simplified video decoder for testing/development
 * Uses placeholder content for demonstration until full QR decoding is implemented
 */
export class MockVideoDecoder extends VideoDecoder {
  async decodeContent(
    videoPath: string,
    frameIndex: number,
    contentHash: string
  ): Promise<Buffer> {
    // Mock implementation that returns test content
    // In production, this would extract and decode actual QR frames
    const mockContent = {
      text: `Decoded content from ${path.basename(videoPath)} at frame ${frameIndex}`,
      code: '// Example code content',
      links: [],
      _decodedFrom: {
        videoPath,
        frameIndex,
        contentHash,
        decodedAt: new Date().toISOString()
      }
    };

    return Buffer.from(JSON.stringify(mockContent));
  }
}

/**
 * Factory function to create appropriate video decoder
 */
export function createVideoDecoder(mock = false): VideoDecoder {
  return mock ? new MockVideoDecoder() : new VideoDecoder();
}
import * as fs from 'fs-extra';
import type { FrameIndexEntry } from './VideoEncoder.js';

// Re-export types for convenience
export type { FrameIndexEntry };

/**
 * Binary format specification for .mvi (Memvid Index) files
 * Enables efficient random access to video frames
 *
 * File format:
 * - Header (32 bytes):
 *   - Magic: "MVIX" (4 bytes)
 *   - Version: uint32 (4 bytes)
 *   - Frame count: uint32 (4 bytes)
 *   - Reserved: 20 bytes
 * - Frame entries (24 bytes each):
 *   - Frame number: uint32 (4 bytes)
 *   - Byte offset: uint64 (8 bytes)
 *   - Frame size: uint32 (4 bytes)
 *   - Timestamp: uint32 (4 bytes)
 *   - Frame type + flags: uint32 (4 bytes)
 */

export const MVI_MAGIC = 'MVIX';
export const MVI_VERSION = 1;
export const MVI_HEADER_SIZE = 32;
export const MVI_ENTRY_SIZE = 24;

/**
 * Frame type encoding for binary storage
 */
export enum FrameTypeBinary {
  I_FRAME = 0x01,
  P_FRAME = 0x02,
  B_FRAME = 0x03,
}

/**
 * Frame flags for binary storage
 */
export enum FrameFlags {
  KEYFRAME = 0x80000000,
}

/**
 * Error types for MVI operations
 */
export class MviError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MviError';
  }
}

/**
 * MVI file writer for creating binary frame index files
 */
export class MviWriter {
  private buffer: Buffer | null = null;
  private frameCount = 0;

  /**
   * Initialize writer for specified number of frames
   */
  constructor(frameCount: number) {
    this.frameCount = frameCount;
    const totalSize = MVI_HEADER_SIZE + (frameCount * MVI_ENTRY_SIZE);
    this.buffer = Buffer.allocUnsafe(totalSize);
    this.writeHeader();
  }

  /**
   * Write MVI header with metadata
   */
  private writeHeader(): void {
    if (!this.buffer) throw new MviError('Buffer not initialized', 'BUFFER_NOT_INITIALIZED');

    let offset = 0;

    // Magic number
    this.buffer.write(MVI_MAGIC, offset, 'ascii');
    offset += 4;

    // Version
    this.buffer.writeUInt32LE(MVI_VERSION, offset);
    offset += 4;

    // Frame count
    this.buffer.writeUInt32LE(this.frameCount, offset);
    offset += 4;

    // Reserved space (20 bytes) - filled with zeros
    this.buffer.fill(0, offset, offset + 20);
  }

  /**
   * Write a single frame index entry
   */
  writeFrameEntry(entry: FrameIndexEntry): void {
    if (!this.buffer) throw new MviError('Buffer not initialized', 'BUFFER_NOT_INITIALIZED');

    if (entry.frameNumber >= this.frameCount) {
      throw new MviError(
        `Frame number ${entry.frameNumber} exceeds expected count ${this.frameCount}`,
        'FRAME_NUMBER_OUT_OF_RANGE'
      );
    }

    const entryOffset = MVI_HEADER_SIZE + (entry.frameNumber * MVI_ENTRY_SIZE);
    let offset = entryOffset;

    // Frame number
    this.buffer.writeUInt32LE(entry.frameNumber, offset);
    offset += 4;

    // Byte offset (64-bit)
    this.buffer.writeBigUInt64LE(BigInt(entry.byteOffset), offset);
    offset += 8;

    // Frame size
    this.buffer.writeUInt32LE(entry.frameSize, offset);
    offset += 4;

    // Timestamp
    this.buffer.writeUInt32LE(entry.timestamp, offset);
    offset += 4;

    // Frame type and flags
    let typeAndFlags = 0;
    switch (entry.frameType) {
      case 'I':
        typeAndFlags = FrameTypeBinary.I_FRAME;
        break;
      case 'P':
        typeAndFlags = FrameTypeBinary.P_FRAME;
        break;
      case 'B':
        typeAndFlags = FrameTypeBinary.B_FRAME;
        break;
    }

    if (entry.isKeyframe) {
      typeAndFlags |= FrameFlags.KEYFRAME;
    }

    this.buffer.writeUInt32LE(typeAndFlags >>> 0, offset); // Convert to unsigned 32-bit
  }

  /**
   * Write all frame entries at once
   */
  writeFrameEntries(entries: FrameIndexEntry[]): void {
    if (entries.length !== this.frameCount) {
      throw new MviError(
        `Expected ${this.frameCount} entries, got ${entries.length}`,
        'FRAME_COUNT_MISMATCH'
      );
    }

    for (const entry of entries) {
      this.writeFrameEntry(entry);
    }
  }

  /**
   * Get the complete MVI file buffer
   */
  getBuffer(): Buffer {
    if (!this.buffer) throw new MviError('Buffer not initialized', 'BUFFER_NOT_INITIALIZED');
    return this.buffer;
  }

  /**
   * Write MVI file to disk
   */
  async writeToFile(filePath: string): Promise<void> {
    if (!this.buffer) throw new MviError('Buffer not initialized', 'BUFFER_NOT_INITIALIZED');

    try {
      await fs.ensureFile(filePath);
      await fs.writeFile(filePath, this.buffer);
    } catch (error) {
      throw new MviError(
        `Failed to write MVI file: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_WRITE_ERROR'
      );
    }
  }
}

/**
 * MVI file reader for reading binary frame index files
 */
export class MviReader {
  private buffer: Buffer | null = null;
  private frameCount = 0;
  private version = 0;

  /**
   * Load MVI file from buffer
   */
  static async fromBuffer(buffer: Buffer): Promise<MviReader> {
    const reader = new MviReader();
    await reader.loadBuffer(buffer);
    return reader;
  }

  /**
   * Load MVI file from disk
   */
  static async fromFile(filePath: string): Promise<MviReader> {
    try {
      const buffer = await fs.readFile(filePath);
      return await MviReader.fromBuffer(buffer);
    } catch (error) {
      throw new MviError(
        `Failed to read MVI file: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_READ_ERROR'
      );
    }
  }

  /**
   * Load buffer and parse header
   */
  private async loadBuffer(buffer: Buffer): Promise<void> {
    if (buffer.length < MVI_HEADER_SIZE) {
      throw new MviError('Invalid MVI file: too small', 'INVALID_FILE_SIZE');
    }

    this.buffer = buffer;

    // Verify magic number
    const magic = buffer.toString('ascii', 0, 4);
    if (magic !== MVI_MAGIC) {
      throw new MviError(`Invalid MVI magic: expected ${MVI_MAGIC}, got ${magic}`, 'INVALID_MAGIC');
    }

    // Read version
    this.version = buffer.readUInt32LE(4);
    if (this.version !== MVI_VERSION) {
      throw new MviError(`Unsupported MVI version: ${this.version}`, 'UNSUPPORTED_VERSION');
    }

    // Read frame count
    this.frameCount = buffer.readUInt32LE(8);

    // Verify file size
    const expectedSize = MVI_HEADER_SIZE + (this.frameCount * MVI_ENTRY_SIZE);
    if (buffer.length !== expectedSize) {
      throw new MviError(
        `Invalid file size: expected ${expectedSize}, got ${buffer.length}`,
        'INVALID_FILE_SIZE'
      );
    }
  }

  /**
   * Get frame count
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Get version
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Read frame index entry by frame number
   */
  getFrameEntry(frameNumber: number): FrameIndexEntry | null {
    if (!this.buffer) throw new MviError('No buffer loaded', 'NO_BUFFER');

    if (frameNumber < 0 || frameNumber >= this.frameCount) {
      return null;
    }

    const entryOffset = MVI_HEADER_SIZE + (frameNumber * MVI_ENTRY_SIZE);
    let offset = entryOffset;

    // Read fields
    const actualFrameNumber = this.buffer.readUInt32LE(offset);
    offset += 4;

    const byteOffset = Number(this.buffer.readBigUInt64LE(offset));
    offset += 8;

    const frameSize = this.buffer.readUInt32LE(offset);
    offset += 4;

    const timestamp = this.buffer.readUInt32LE(offset);
    offset += 4;

    const typeAndFlags = this.buffer.readUInt32LE(offset);

    // Parse frame type
    const frameTypeBinary = typeAndFlags & 0x0F;
    let frameType: 'I' | 'P' | 'B';
    switch (frameTypeBinary) {
      case FrameTypeBinary.I_FRAME:
        frameType = 'I';
        break;
      case FrameTypeBinary.P_FRAME:
        frameType = 'P';
        break;
      case FrameTypeBinary.B_FRAME:
        frameType = 'B';
        break;
      default:
        frameType = 'I'; // Default fallback
    }

    const isKeyframe = (typeAndFlags & FrameFlags.KEYFRAME) !== 0;

    return {
      frameNumber: actualFrameNumber,
      byteOffset,
      frameType,
      frameSize,
      timestamp,
      isKeyframe,
    };
  }

  /**
   * Read all frame entries
   */
  getAllFrameEntries(): FrameIndexEntry[] {
    const entries: FrameIndexEntry[] = [];
    for (let i = 0; i < this.frameCount; i++) {
      const entry = this.getFrameEntry(i);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /**
   * Find the nearest keyframe at or before the given frame number
   */
  findNearestKeyframe(frameNumber: number): FrameIndexEntry | null {
    if (frameNumber < 0 || frameNumber >= this.frameCount) {
      return null;
    }

    // Search backwards for the nearest keyframe
    for (let i = frameNumber; i >= 0; i--) {
      const entry = this.getFrameEntry(i);
      if (entry && entry.isKeyframe) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Get statistics about the frame index
   */
  getStatistics(): {
    totalFrames: number;
    keyframes: number;
    averageFrameSize: number;
    totalVideoSize: number;
    duration: number;
  } {
    const entries = this.getAllFrameEntries();
    const keyframes = entries.filter(e => e.isKeyframe).length;
    const totalSize = entries.reduce((sum, e) => sum + e.frameSize, 0);
    const averageFrameSize = entries.length > 0 ? totalSize / entries.length : 0;
    const lastEntry = entries[entries.length - 1];
    const duration = lastEntry ? lastEntry.timestamp + (1000 / 30) : 0; // Assume 30fps

    return {
      totalFrames: entries.length,
      keyframes,
      averageFrameSize,
      totalVideoSize: totalSize,
      duration,
    };
  }
}

/**
 * Utility functions for MVI file operations
 */

/**
 * Create an MVI file from frame index entries
 */
export async function createMviFile(
  entries: FrameIndexEntry[],
  outputPath: string
): Promise<void> {
  const writer = new MviWriter(entries.length);
  writer.writeFrameEntries(entries);
  await writer.writeToFile(outputPath);
}

/**
 * Read an MVI file and return all frame entries
 */
export async function readMviFile(filePath: string): Promise<FrameIndexEntry[]> {
  const reader = await MviReader.fromFile(filePath);
  return reader.getAllFrameEntries();
}

/**
 * Validate an MVI file format
 */
export async function validateMviFile(filePath: string): Promise<{
  valid: boolean;
  error?: string;
  stats?: ReturnType<MviReader['getStatistics']>;
}> {
  try {
    const reader = await MviReader.fromFile(filePath);
    const stats = reader.getStatistics();
    return { valid: true, stats };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convert frame entries to a human-readable summary
 */
export function summarizeFrameIndex(entries: FrameIndexEntry[]): string {
  if (entries.length === 0) return 'Empty frame index';

  const keyframes = entries.filter(e => e.isKeyframe).length;
  const totalSize = entries.reduce((sum, e) => sum + e.frameSize, 0);
  const duration = entries[entries.length - 1]?.timestamp || 0;

  return [
    `Frames: ${entries.length}`,
    `Keyframes: ${keyframes} (${((keyframes / entries.length) * 100).toFixed(1)}%)`,
    `Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`,
    `Duration: ${(duration / 1000).toFixed(2)}s`,
    `Average frame size: ${(totalSize / entries.length / 1024).toFixed(1)} KB`,
  ].join(', ');
}
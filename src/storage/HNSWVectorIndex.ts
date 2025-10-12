// HNSW-based vector index for high-performance approximate nearest neighbor search
// Provides O(log n) search complexity using Hierarchical Navigable Small World graphs
// Drop-in replacement for VectorIndex.ts with significantly better performance on large datasets

import * as fs from 'node:fs';
import * as path from 'node:path';
import { HierarchicalNSW } from 'hnswlib-node';

interface HNSWMeta {
  dim?: number;
  count?: number;
  updatedAt?: string;
  maxElements?: number;
  M?: number;            // Number of bi-directional links per node (default: 16)
  efConstruction?: number; // Size of dynamic candidate list (default: 200)
  efSearch?: number;      // Size of search candidate list (default: 50)
}

interface IdMapping {
  idToLabel: Record<string, number>;  // string id -> numeric label
  labelToId: Record<number, string>;  // numeric label -> string id
  nextLabel: number;
}

const DEFAULT_MAX_ELEMENTS = 10000;
const DEFAULT_M = 16;              // Higher = better recall, more memory
const DEFAULT_EF_CONSTRUCTION = 200; // Higher = better index quality, slower build
const DEFAULT_EF_SEARCH = 50;       // Higher = better recall, slower search

export class HNSWVectorIndex {
  private dir: string;
  private indexPath: string;
  private metaPath: string;
  private mappingPath: string;
  private loaded = false;
  private index: HierarchicalNSW | null = null;
  private meta: HNSWMeta = {};
  private mapping: IdMapping = { idToLabel: {}, labelToId: {}, nextLabel: 0 };
  private persisting = false;
  private persistQueue: Array<() => void> = [];

  constructor(indexDir: string) {
    this.dir = indexDir;
    this.indexPath = path.join(indexDir, 'vectors.hnsw');
    this.metaPath = path.join(indexDir, 'vectors.meta.json');
    this.mappingPath = path.join(indexDir, 'vectors.mapping.json');
  }

  private ensure(): void {
    if (this.loaded) return;

    // Load metadata
    try {
      const raw = fs.readFileSync(this.metaPath, 'utf8');
      this.meta = JSON.parse(raw);
    } catch {
      this.meta = {};
    }

    // Load ID mapping
    try {
      const raw = fs.readFileSync(this.mappingPath, 'utf8');
      this.mapping = JSON.parse(raw);
    } catch {
      this.mapping = { idToLabel: {}, labelToId: {}, nextLabel: 0 };
    }

    // Load or create HNSW index
    if (this.meta.dim && this.meta.dim > 0) {
      try {
        this.index = new HierarchicalNSW('cosine', this.meta.dim);

        // Try to load existing index
        if (fs.existsSync(this.indexPath)) {
          this.index.readIndex(this.indexPath);

          // Validate index was loaded correctly
          const currentCount = this.index.getCurrentCount();
          const mappingCount = Object.keys(this.mapping.idToLabel).length;
          if (currentCount !== mappingCount) {
            console.warn(`[HNSWVectorIndex] Index count mismatch: index has ${currentCount}, mapping has ${mappingCount}. This may indicate corruption. Rebuilding may be needed.`);
          }

          this.index.setEf(this.meta.efSearch || DEFAULT_EF_SEARCH);
        } else {
          // Initialize new index
          this.index.initIndex(
            this.meta.maxElements || DEFAULT_MAX_ELEMENTS,
            this.meta.M || DEFAULT_M,
            this.meta.efConstruction || DEFAULT_EF_CONSTRUCTION,
            Math.floor(Math.random() * 10000)
          );
          this.index.setEf(this.meta.efSearch || DEFAULT_EF_SEARCH);
        }
      } catch (error) {
        console.error('[HNSWVectorIndex] Failed to load index:', error);
        // Reset everything to clean state on corruption
        this.index = null;
        this.meta = {};
        this.mapping = { idToLabel: {}, labelToId: {}, nextLabel: 0 };
      }
    }

    this.loaded = true;
  }

  private initializeIndex(dim: number): void {
    if (this.index) return;

    this.meta.dim = dim;
    this.meta.maxElements = this.meta.maxElements || DEFAULT_MAX_ELEMENTS;
    this.meta.M = this.meta.M || DEFAULT_M;
    this.meta.efConstruction = this.meta.efConstruction || DEFAULT_EF_CONSTRUCTION;
    this.meta.efSearch = this.meta.efSearch || DEFAULT_EF_SEARCH;

    this.index = new HierarchicalNSW('cosine', dim);
    this.index.initIndex(
      this.meta.maxElements,
      this.meta.M,
      this.meta.efConstruction,
      Math.floor(Math.random() * 10000)
    );
    this.index.setEf(this.meta.efSearch);
  }

  private persist(): void {
    if (!this.index) return;

    // If already persisting, queue this request
    if (this.persisting) {
      return; // Silently skip, will be persisted by next operation
    }

    this.persisting = true;

    try {
      // Ensure the directory structure exists for all file paths
      fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
      fs.mkdirSync(path.dirname(this.metaPath), { recursive: true });
      fs.mkdirSync(path.dirname(this.mappingPath), { recursive: true });

      // Save HNSW index (binary format)
      const tmpIndex = this.indexPath + '.tmp';
      this.index.writeIndex(tmpIndex);

      // Only rename if target doesn't exist or we can safely overwrite
      if (fs.existsSync(this.indexPath)) {
        fs.unlinkSync(this.indexPath);
      }
      fs.renameSync(tmpIndex, this.indexPath);

      // Save metadata
      this.meta.count = Object.keys(this.mapping.idToLabel).length;
      this.meta.updatedAt = new Date().toISOString();
      const tmpMeta = this.metaPath + '.tmp';
      fs.writeFileSync(tmpMeta, JSON.stringify(this.meta, null, 2));

      if (fs.existsSync(this.metaPath)) {
        fs.unlinkSync(this.metaPath);
      }
      fs.renameSync(tmpMeta, this.metaPath);

      // Save ID mapping
      const tmpMapping = this.mappingPath + '.tmp';
      fs.writeFileSync(tmpMapping, JSON.stringify(this.mapping, null, 2));

      if (fs.existsSync(this.mappingPath)) {
        fs.unlinkSync(this.mappingPath);
      }
      fs.renameSync(tmpMapping, this.mappingPath);
    } catch (error) {
      console.error('[HNSWVectorIndex] Failed to persist:', error);
      // Don't throw, just log - persistence failure shouldn't break the operation
    } finally {
      this.persisting = false;

      // Process any queued persist requests
      if (this.persistQueue.length > 0) {
        const next = this.persistQueue.shift();
        if (next) next();
      }
    }
  }

  private getOrCreateLabel(id: string): number {
    if (this.mapping.idToLabel[id] !== undefined) {
      return this.mapping.idToLabel[id];
    }
    const label = this.mapping.nextLabel++;
    this.mapping.idToLabel[id] = label;
    this.mapping.labelToId[label] = id;
    return label;
  }

  set(id: string, vec: number[]): void {
    this.ensure();

    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error('vector must be non-empty numeric array');
    }

    const dim = vec.length;

    // Initialize index if first vector
    if (!this.index) {
      this.initializeIndex(dim);
    }

    // Verify index is initialized
    if (!this.index) {
      throw new Error('Failed to initialize HNSW index');
    }

    // Check dimension consistency
    if (this.meta.dim !== dim) {
      throw new Error(`vector dimension mismatch: expected ${this.meta.dim}, got ${dim}`);
    }

    // Check if this is an update (label already exists) or new insertion
    const existingLabel = this.mapping.idToLabel[id];
    const isUpdate = existingLabel !== undefined;

    // Get or create numeric label for this ID
    const label = isUpdate ? existingLabel : this.getOrCreateLabel(id);

    // Check if we need to resize the index
    if (this.mapping.nextLabel >= (this.meta.maxElements || DEFAULT_MAX_ELEMENTS)) {
      // Double the capacity
      const newMaxElements = (this.meta.maxElements || DEFAULT_MAX_ELEMENTS) * 2;
      console.log(`[HNSWVectorIndex] Resizing index from ${this.meta.maxElements} to ${newMaxElements} elements`);
      this.index.resizeIndex(newMaxElements);
      this.meta.maxElements = newMaxElements;
    }

    // Add or replace vector
    try {
      if (isUpdate && this.index.getCurrentCount() > 0) {
        // Update existing vector (delete and re-add with same label)
        // Only try to delete if the label actually exists in the index
        try {
          this.index.markDelete(label);
        } catch (deleteError) {
          // Label might not exist in index yet, that's okay - we'll just add it
          console.log(`[HNSWVectorIndex] Could not delete label ${label}, will add as new: ${deleteError}`);
        }
      }
      this.index.addPoint(vec, label);
    } catch (error) {
      throw new Error(`Failed to add vector: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.persist();
  }

  remove(id: string): void {
    this.ensure();

    if (!this.index) return;

    const label = this.mapping.idToLabel[id];
    if (label === undefined) return;

    // Mark as deleted in HNSW index
    try {
      this.index.markDelete(label);
    } catch {
      // Ignore if already deleted or doesn't exist
    }

    // Remove from mapping
    delete this.mapping.labelToId[label];
    delete this.mapping.idToLabel[id];

    this.persist();
  }

  setBulk(
    items: Array<{ id: string; vector: number[] }>,
    dimOverride?: number
  ): { ok: number; skipped: Array<{ id: string; reason: string }> } {
    this.ensure();

    const skipped: Array<{ id: string; reason: string }> = [];
    let ok = 0;

    const hasExisting = this.index !== null && this.meta.dim !== undefined;

    // Determine target dimension
    let targetDim = dimOverride;
    if (targetDim == null) {
      if (hasExisting && this.meta.dim) {
        targetDim = this.meta.dim;
      } else if (items.length > 0 && Array.isArray(items[0].vector)) {
        targetDim = items[0].vector.length;
      } else if (this.meta.dim) {
        targetDim = this.meta.dim;
      }
    }

    if (!targetDim || targetDim <= 0) {
      return {
        ok: 0,
        skipped: items.map(i => ({ id: i.id, reason: 'unknown target dimension' }))
      };
    }

    // If dimension mismatch with existing index, reject all
    if (hasExisting && this.meta.dim && this.meta.dim !== targetDim) {
      return {
        ok: 0,
        skipped: items.map(i => ({
          id: i.id,
          reason: `dimension ${targetDim} != existing ${this.meta.dim}`
        }))
      };
    }

    // Initialize index if needed
    if (!this.index) {
      this.initializeIndex(targetDim);
    }

    // Add items
    for (const item of items) {
      if (!Array.isArray(item.vector) || item.vector.length !== this.meta.dim) {
        skipped.push({
          id: item.id,
          reason: `vector dim ${item.vector?.length} != ${this.meta.dim}`
        });
        continue;
      }

      try {
        this.set(item.id, item.vector);
        ok++;
      } catch (e: any) {
        skipped.push({ id: item.id, reason: e?.message || 'invalid' });
      }
    }

    return { ok, skipped };
  }

  search(query: number[], k: number = 100): Array<{ id: string; score: number }> {
    this.ensure();

    if (!this.index || !this.meta.dim) {
      return [];
    }

    if (query.length !== this.meta.dim) {
      return [];
    }

    try {
      // Search returns { neighbors: number[], distances: number[] }
      const result = this.index.searchKnn(query, k);

      if (!result || !result.neighbors || !result.distances) {
        return [];
      }

      const out: Array<{ id: string; score: number }> = [];

      for (let i = 0; i < result.neighbors.length; i++) {
        const label = result.neighbors[i];
        const distance = result.distances[i];
        const id = this.mapping.labelToId[label];

        if (id !== undefined) {
          // Convert cosine distance to similarity score
          // hnswlib-node returns cosine distance: d = 1 - cosine_similarity
          // So similarity = 1 - distance
          const similarity = 1 - distance;

          // Only include positive similarities
          if (similarity > 0) {
            out.push({ id, score: similarity });
          }
        }
      }

      // Results should already be sorted by distance (ascending), which means by score (descending)
      // But let's ensure it for consistency
      out.sort((a, b) => b.score - a.score);

      return out;
    } catch (error) {
      console.error('[HNSWVectorIndex] Search failed:', error);
      return [];
    }
  }

  /**
   * Get index statistics
   */
  getStats(): { count: number; dimension: number | undefined; maxElements: number } {
    this.ensure();
    return {
      count: Object.keys(this.mapping.idToLabel).length,
      dimension: this.meta.dim,
      maxElements: this.meta.maxElements || DEFAULT_MAX_ELEMENTS
    };
  }

  /**
   * Set search quality parameter (higher = better recall, slower search)
   */
  setEfSearch(ef: number): void {
    this.ensure();
    if (this.index) {
      this.index.setEf(ef);
      this.meta.efSearch = ef;
      this.persist();
    }
  }

  /**
   * Get current search quality parameter
   */
  getEfSearch(): number {
    this.ensure();
    return this.meta.efSearch || DEFAULT_EF_SEARCH;
  }

  /**
   * Check if index is loaded
   */
  isLoaded(): boolean {
    return this.loaded && this.index !== null;
  }
}

// Local embedding generation using transformers.js
// Provides offline vector embeddings for hybrid search without external API calls

import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowLocalModels = true;
env.allowRemoteModels = true;

// Cache directory for models
env.cacheDir = process.env.TRANSFORMERS_CACHE || './.cache/transformers';

export interface EmbeddingModel {
  name: string;
  dimension: number;
  maxTokens: number;
  description: string;
}

export const AVAILABLE_MODELS: Record<string, EmbeddingModel> = {
  'all-MiniLM-L6-v2': {
    name: 'Xenova/all-MiniLM-L6-v2',
    dimension: 384,
    maxTokens: 256,
    description: 'Fast, lightweight model for general text (384D)',
  },
  'all-mpnet-base-v2': {
    name: 'Xenova/all-mpnet-base-v2',
    dimension: 768,
    maxTokens: 384,
    description: 'Higher quality model for semantic similarity (768D)',
  },
  'bge-small-en-v1.5': {
    name: 'Xenova/bge-small-en-v1.5',
    dimension: 384,
    maxTokens: 512,
    description: 'Optimized for code and technical text (384D)',
  },
};

export class LocalEmbedder {
  private pipeline: any = null;
  private modelName: string;
  private modelInfo: EmbeddingModel;
  private isLoading = false;
  private loadPromise: Promise<void> | null = null;

  constructor(modelKey: string = 'all-MiniLM-L6-v2') {
    if (!AVAILABLE_MODELS[modelKey]) {
      throw new Error(`Unknown model: ${modelKey}. Available: ${Object.keys(AVAILABLE_MODELS).join(', ')}`);
    }
    this.modelInfo = AVAILABLE_MODELS[modelKey];
    this.modelName = this.modelInfo.name;
  }

  /**
   * Initialize the embedding model (downloads on first use)
   */
  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    this.isLoading = true;
    this.loadPromise = (async () => {
      try {
        console.log(`[LocalEmbedder] Loading model: ${this.modelName}`);
        console.log(`[LocalEmbedder] Cache directory: ${env.cacheDir}`);

        this.pipeline = await pipeline('feature-extraction', this.modelName, {
          quantized: true, // Use quantized model for better performance
        });

        console.log(`[LocalEmbedder] Model loaded: ${this.modelName} (${this.modelInfo.dimension}D)`);
      } catch (error) {
        console.error(`[LocalEmbedder] Failed to load model:`, error);
        throw new Error(`Failed to load embedding model: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.isLoading = false;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize();

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      // Truncate text to model's max tokens (rough estimate: ~4 chars per token)
      const maxChars = this.modelInfo.maxTokens * 4;
      const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text;

      // Generate embedding
      const output = await this.pipeline(truncatedText, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to regular array
      const embedding = Array.from(output.data as Float32Array);

      return embedding;
    } catch (error) {
      console.error(`[LocalEmbedder] Failed to generate embedding:`, error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      // Truncate texts
      const maxChars = this.modelInfo.maxTokens * 4;
      const truncatedTexts = texts.map(text =>
        text.length > maxChars ? text.slice(0, maxChars) : text
      );

      // Generate embeddings in batch
      const results: number[][] = [];
      for (const text of truncatedTexts) {
        const embedding = await this.embed(text);
        results.push(embedding);
      }

      return results;
    } catch (error) {
      console.error(`[LocalEmbedder] Failed to generate batch embeddings:`, error);
      throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get model information
   */
  getModelInfo(): EmbeddingModel {
    return this.modelInfo;
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.modelInfo.dimension;
  }

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Unload model to free memory
   */
  async unload(): Promise<void> {
    if (this.pipeline) {
      this.pipeline = null;
      console.log(`[LocalEmbedder] Model unloaded: ${this.modelName}`);
    }
  }
}

// Singleton instance for easy reuse
let defaultEmbedder: LocalEmbedder | null = null;

/**
 * Get or create the default embedder instance
 */
export function getDefaultEmbedder(modelKey?: string): LocalEmbedder {
  if (!defaultEmbedder || (modelKey && defaultEmbedder.getModelInfo().name !== AVAILABLE_MODELS[modelKey]?.name)) {
    defaultEmbedder = new LocalEmbedder(modelKey);
  }
  return defaultEmbedder;
}

/**
 * Helper function to generate embedding with default embedder
 */
export async function generateEmbedding(text: string, modelKey?: string): Promise<number[]> {
  const embedder = getDefaultEmbedder(modelKey);
  return embedder.embed(text);
}

/**
 * Helper function to generate batch embeddings with default embedder
 */
export async function generateEmbeddings(texts: string[], modelKey?: string): Promise<number[][]> {
  const embedder = getDefaultEmbedder(modelKey);
  return embedder.embedBatch(texts);
}

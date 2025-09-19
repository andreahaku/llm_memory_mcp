export function estimateTokens(text: string): number {
  // Fast, model-agnostic heuristic: ~4 chars per token
  // Good enough for budgeting without heavy tokenizers
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function allowedCharsForTokens(tokens: number): number {
  if (!isFinite(tokens)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(tokens * 4));
}


import crypto from 'node:crypto';

const patterns: RegExp[] = [
  /sk-[A-Za-z0-9]{32,}/g, // common API style keys
  /(?:xox[baprs]-[A-Za-z0-9-]+)/g, // slack tokens
  /AIza[0-9A-Za-z\-_]{35}/g, // Google API keys
  /ghp_[0-9A-Za-z]{36}/g, // GitHub PAT
  /AWS(?:SECRET|ACCESS)[A-Z_]*?=[A-Za-z0-9\/+]{20,}/gi,
];

function hash(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function redactSecrets(input: string | undefined): { text: string | undefined; refs: string[] } {
  if (!input) return { text: input, refs: [] };
  let text = input;
  const refs = new Set<string>();
  for (const re of patterns) {
    text = text.replace(re, (m) => {
      refs.add(hash(m));
      return '<redacted-secret>';
    });
  }
  return { text, refs: Array.from(refs) };
}


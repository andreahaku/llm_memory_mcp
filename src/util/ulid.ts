// Minimal ULID-like generator (monotonic-ish within single process)
// Avoids external deps for offline environments

import crypto from 'node:crypto';

const Crock = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Precomputed lookup table for O(1) character decoding
const CrockLookup: { [key: string]: number } = {};
for (let i = 0; i < Crock.length; i++) {
  CrockLookup[Crock[i]] = i;
}

function encodeTime(t: number, len: number) {
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    const mod = t % 32;
    out = Crock[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function encodeRandom(len: number) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += Crock[bytes[i] % 32];
  }
  return out;
}

let lastTime = 0;
let lastRandom = '';

export function ulid(): string {
  const time = Date.now();
  if (time === lastTime) {
    // bump random if same ms to preserve monotonic-ish ordering
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastRandom = encodeRandom(16);
    lastTime = time;
  }
  return encodeTime(time, 10) + lastRandom;
}

function bumpRandom(r: string): string {
  if (!r) return encodeRandom(16);
  const arr = r.split('');
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = Crock.indexOf(arr[i]);
    if (idx < 31) {
      arr[i] = Crock[idx + 1];
      for (let j = i + 1; j < arr.length; j++) arr[j] = Crock[0];
      return arr.join('');
    }
  }
  return encodeRandom(16);
}

/**
 * Extract timestamp from a ULID string
 * @param ulidString - The ULID string to extract time from
 * @returns The timestamp in milliseconds
 * @throws Error if the input is not a valid ULID string
 */
export function extractTime(ulidString: string): number {
  // Type check for null/undefined/non-string
  if (typeof ulidString !== 'string') {
    throw new Error(`Invalid ULID input: expected string, got ${typeof ulidString}`);
  }

  if (ulidString.length !== 26) {
    throw new Error('Invalid ULID format: expected 26 characters');
  }

  let time = 0;
  for (let i = 0; i < 10; i++) {
    const char = ulidString[i];
    const index = CrockLookup[char];
    if (index === undefined) {
      throw new Error(`Invalid ULID character at position ${i}: ${char}`);
    }

    // For strict ULID conformance, enforce first char range 0-7
    if (i === 0 && index > 7) {
      throw new Error(`Invalid ULID: first character '${char}' exceeds timestamp range (must be 0-7)`);
    }

    time = time * 32 + index;
  }

  return time;
}

/**
 * Validate if a string is a valid ULID
 * @param ulidString - The string to validate
 * @returns True if valid ULID, false otherwise
 */
export function isValidULID(ulidString: string): boolean {
  // Rely on extractTime() for all validation to avoid redundancy
  try {
    extractTime(ulidString);

    // Validate remaining 16 random characters
    for (let i = 10; i < 26; i++) {
      if (CrockLookup[ulidString[i]] === undefined) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}


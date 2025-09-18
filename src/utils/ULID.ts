/**
 * Simple ULID implementation for time-ordered unique IDs
 * Format: 26 characters, lexicographically sortable
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's Base32
const ENCODING_LEN = ENCODING.length;
const TIME_MAX = Math.pow(2, 48) - 1;
const RANDOM_LEN = 16;

let lastTime = 0;
let lastRandom: number[] = [];

export function ulid(seedTime?: number): string {
  const now = seedTime || Date.now();

  if (now === lastTime) {
    // Increment random part if same millisecond
    let carry = 1;
    for (let i = RANDOM_LEN - 1; i >= 0 && carry; i--) {
      lastRandom[i] = (lastRandom[i] + carry) % ENCODING_LEN;
      if (lastRandom[i] !== 0) carry = 0;
    }
  } else {
    // Generate new random part
    lastTime = now;
    lastRandom = [];
    for (let i = 0; i < RANDOM_LEN; i++) {
      lastRandom[i] = Math.floor(Math.random() * ENCODING_LEN);
    }
  }

  if (now > TIME_MAX) {
    throw new Error('ULID time component exceeds maximum');
  }

  // Encode time part (10 chars)
  let timeStr = '';
  let time = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = ENCODING[time % ENCODING_LEN] + timeStr;
    time = Math.floor(time / ENCODING_LEN);
  }

  // Encode random part (16 chars)
  let randomStr = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    randomStr += ENCODING[lastRandom[i]];
  }

  return timeStr + randomStr;
}

export function extractTime(ulid: string): number {
  if (ulid.length !== 26) {
    throw new Error('Invalid ULID format');
  }

  let time = 0;
  for (let i = 0; i < 10; i++) {
    const char = ulid[i];
    const index = ENCODING.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid ULID character');
    }
    time = time * ENCODING_LEN + index;
  }

  return time;
}

export function isValidULID(ulid: string): boolean {
  try {
    extractTime(ulid);
    return ulid.length === 26;
  } catch {
    return false;
  }
}
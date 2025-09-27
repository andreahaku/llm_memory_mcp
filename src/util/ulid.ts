// Minimal ULID-like generator (monotonic-ish within single process)
// Avoids external deps for offline environments

import crypto from 'node:crypto';

const Crock = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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


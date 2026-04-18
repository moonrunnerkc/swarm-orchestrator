/**
 * In-memory URL shortener primitives with URL validation, base62 short codes, and hit statistics.
 */
import { createHash } from 'crypto';
import { DEFAULT_SHORT_CODE_MIN_LENGTH, DEFAULT_URL_MAX_LENGTH } from './defaults';

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface URLShortenerOptions {
  codeMinLength?: number;
  maxURLLength?: number;
}

export function validateURL(value: string, maxLength = DEFAULT_URL_MAX_LENGTH): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedURL = value.trim();
  if (normalizedURL.length === 0 || normalizedURL.length > maxLength) {
    return false;
  }

  try {
    const parsedURL = new URL(normalizedURL);
    return parsedURL.protocol === 'http:' || parsedURL.protocol === 'https:';
  } catch {
    return false;
  }
}

export class StatisticsTracker {
  private readonly hitCounts = new Map<string, number>();

  recordHit(shortCode: string): number {
    const normalizedCode = shortCode.trim();
    if (normalizedCode.length === 0) {
      throw new Error('Short code is required.');
    }

    const nextCount = this.getHits(normalizedCode) + 1;
    this.hitCounts.set(normalizedCode, nextCount);
    return nextCount;
  }

  getHits(shortCode: string): number {
    return this.hitCounts.get(shortCode.trim()) ?? 0;
  }

  reset(shortCode?: string): void {
    if (typeof shortCode === 'string') {
      const normalizedCode = shortCode.trim();
      if (normalizedCode.length === 0) {
        throw new Error('Short code is required.');
      }

      this.hitCounts.delete(normalizedCode);
      return;
    }

    this.hitCounts.clear();
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.hitCounts.entries());
  }
}

export class URLShortener {
  private readonly shortToURL = new Map<string, string>();
  private readonly urlToShort = new Map<string, string>();
  private readonly maxURLLength: number;
  private readonly codeMinLength: number;
  readonly statistics: StatisticsTracker;

  constructor(options: URLShortenerOptions = {}) {
    this.maxURLLength = options.maxURLLength ?? DEFAULT_URL_MAX_LENGTH;
    this.codeMinLength = options.codeMinLength ?? DEFAULT_SHORT_CODE_MIN_LENGTH;
    this.statistics = new StatisticsTracker();
  }

  shorten(url: string): string {
    const normalizedURL = this.normalizeURL(url);
    const existingCode = this.urlToShort.get(normalizedURL);
    if (existingCode) {
      return existingCode;
    }

    let attempt = 0;
    while (true) {
      const shortCode = this.generateShortCode(normalizedURL, attempt);
      const existingURL = this.shortToURL.get(shortCode);
      if (!existingURL) {
        this.shortToURL.set(shortCode, normalizedURL);
        this.urlToShort.set(normalizedURL, shortCode);
        return shortCode;
      }

      if (existingURL === normalizedURL) {
        this.urlToShort.set(normalizedURL, shortCode);
        return shortCode;
      }

      attempt += 1;
    }
  }

  resolve(shortCode: string): string | null {
    const normalizedCode = shortCode.trim();
    if (normalizedCode.length === 0) {
      throw new Error('Short code is required.');
    }

    const url = this.shortToURL.get(normalizedCode) ?? null;
    if (url) {
      this.statistics.recordHit(normalizedCode);
    }

    return url;
  }

  getHitCount(shortCode: string): number {
    return this.statistics.getHits(shortCode);
  }

  has(shortCode: string): boolean {
    return this.shortToURL.has(shortCode.trim());
  }

  private normalizeURL(url: string): string {
    const normalizedURL = url.trim();
    if (!validateURL(normalizedURL, this.maxURLLength)) {
      throw new Error('A valid HTTP or HTTPS URL is required.');
    }

    return normalizedURL;
  }

  private generateShortCode(url: string, attempt: number): string {
    const hashInput = attempt === 0 ? url : `${url}:${attempt}`;
    const hashHex = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
    const numericHash = BigInt(`0x${hashHex}`);
    return this.encodeBase62(numericHash).padStart(this.codeMinLength, '0');
  }

  private encodeBase62(value: bigint): string {
    if (value === 0n) {
      return '0';
    }

    let remaining = value;
    let encoded = '';
    const radix = BigInt(BASE62_ALPHABET.length);

    while (remaining > 0n) {
      const index = Number(remaining % radix);
      encoded = BASE62_ALPHABET[index] + encoded;
      remaining /= radix;
    }

    return encoded;
  }
}

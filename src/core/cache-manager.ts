/**
 * Cache Manager — Simple in-memory cache with configurable TTL.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private ttlMinutes: number,
    private enabled: boolean = true,
  ) {}

  /**
   * Get a cached value. Returns null if expired or not found.
   */
  get<T>(key: string): T | null {
    if (!this.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Store a value in the cache.
   */
  set<T>(key: string, data: T): void {
    if (!this.enabled) return;

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMinutes * 60 * 1000,
    });
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}

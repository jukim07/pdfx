const BUDGET_BYTES = 300 * 1024 * 1024 // 300 MB

interface Entry {
  pageId: string
  bytes: number
  evict: () => void
  lastUsed: number
}

let seq = 0

const pool = new Map<string, Entry>()
let totalBytes = 0

export const rasterPool = {
  /** Register a page as rasterized. evict() will be called if eviction is needed. */
  register(pageId: string, width: number, height: number, evict: () => void): void {
    if (pool.has(pageId)) {
      rasterPool.touch(pageId)
      return
    }
    const bytes = width * height * 4
    pool.set(pageId, { pageId, bytes, evict, lastUsed: ++seq })
    totalBytes += bytes
    rasterPool.evictIfNeeded()
  },

  /** Call when a page is scrolled out and its raster has been cleared. */
  deregister(pageId: string): void {
    const entry = pool.get(pageId)
    if (!entry) return
    totalBytes -= entry.bytes
    pool.delete(pageId)
  },

  /** Mark a page as recently used (push it to back of eviction queue). */
  touch(pageId: string): void {
    const entry = pool.get(pageId)
    if (entry) entry.lastUsed = ++seq
  },

  evictIfNeeded(): void {
    if (totalBytes <= BUDGET_BYTES) return
    // Sort by lastUsed ascending — evict the LRU entry first
    const entries = [...pool.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of entries) {
      if (totalBytes <= BUDGET_BYTES) break
      entry.evict()
      // deregister is called by the evict callback (inside PageView's cleanup)
    }
  },

  /** Exposed for testing only — returns current total bytes tracked by the pool. */
  _totalBytes(): number {
    return totalBytes
  },

  /** Exposed for testing only — resets pool state. */
  _reset(): void {
    pool.clear()
    totalBytes = 0
    seq = 0
  }
}

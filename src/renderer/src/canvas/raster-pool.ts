const BUDGET_BYTES = 300 * 1024 * 1024 // 300 MB

interface Entry {
  pageId: string
  bytes: number
  evict: () => void
  lastUsed: number
  pinned: boolean
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
    pool.set(pageId, { pageId, bytes, evict, lastUsed: ++seq, pinned: false })
    totalBytes += bytes
    // The entry just registered is exempt from its own eviction pass — evict others
    // first; if still over budget, accept soft-over (visible page must render).
    rasterPool._evictIfNeeded(pageId)
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

  /**
   * Pin a page so it is skipped during eviction. Call when the page enters the
   * viewport; call unpin when it leaves. Pinning an unregistered id is a no-op.
   */
  pin(pageId: string): void {
    const entry = pool.get(pageId)
    if (entry) entry.pinned = true
  },

  /**
   * Release a pin. Unpinning an unknown/unregistered id is a no-op.
   * After unpin, the entry participates in normal LRU eviction.
   */
  unpin(pageId: string): void {
    const entry = pool.get(pageId)
    if (entry) entry.pinned = false
  },

  evictIfNeeded(): void {
    rasterPool._evictIfNeeded(null)
  },

  /** Internal: evict passing an exempt id (null = no exemption). */
  _evictIfNeeded(exemptId: string | null): void {
    if (totalBytes <= BUDGET_BYTES) return
    // Sort by lastUsed ascending — evict the LRU entry first
    const entries = [...pool.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of entries) {
      if (totalBytes <= BUDGET_BYTES) break
      // Skip pinned entries and the entry currently being registered
      if (entry.pinned || entry.pageId === exemptId) continue
      entry.evict()
      // deregister is called by the evict callback (inside PageView's cleanup)
    }
    // If still over budget (all remaining entries pinned or exempt): accept soft-over.
    // Visible pages always win.
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

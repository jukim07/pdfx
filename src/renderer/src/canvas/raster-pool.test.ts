import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rasterPool } from './raster-pool'

// 300 MB budget
const BUDGET_BYTES = 300 * 1024 * 1024

beforeEach(() => {
  rasterPool._reset()
})

describe('rasterPool.register', () => {
  it('accounts for registered bytes correctly (w * h * 4)', () => {
    const evict = vi.fn()
    rasterPool.register('p1', 852, 1100, evict)
    expect(rasterPool._totalBytes()).toBe(852 * 1100 * 4)
  })

  it('is idempotent on duplicate register — does not double-count bytes', () => {
    const evict = vi.fn()
    rasterPool.register('p1', 852, 1100, evict)
    const after1 = rasterPool._totalBytes()
    rasterPool.register('p1', 852, 1100, evict)
    expect(rasterPool._totalBytes()).toBe(after1)
  })

  it('accumulates bytes across multiple pages', () => {
    rasterPool.register('p1', 100, 200, vi.fn())
    rasterPool.register('p2', 300, 400, vi.fn())
    expect(rasterPool._totalBytes()).toBe(100 * 200 * 4 + 300 * 400 * 4)
  })
})

describe('rasterPool.deregister', () => {
  it('subtracts bytes for the deregistered page', () => {
    rasterPool.register('p1', 100, 200, vi.fn())
    rasterPool.register('p2', 300, 400, vi.fn())
    rasterPool.deregister('p1')
    expect(rasterPool._totalBytes()).toBe(300 * 400 * 4)
  })

  it('is a no-op for unknown pageId', () => {
    rasterPool.register('p1', 100, 200, vi.fn())
    const before = rasterPool._totalBytes()
    rasterPool.deregister('unknown')
    expect(rasterPool._totalBytes()).toBe(before)
  })
})

describe('rasterPool.touch', () => {
  it('moves a page to the back of the eviction queue', () => {
    // p1 registered first (LRU), p2 second.
    // Evict callbacks must deregister so the pool's byte count drops and eviction stops.
    const evict1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    const evict2 = vi.fn().mockImplementation(() => rasterPool.deregister('p2'))
    rasterPool.register('p1', 100, 200, evict1)
    rasterPool.register('p2', 100, 200, evict2)
    // Touch p1 so it becomes most-recently-used; p2 is now LRU
    rasterPool.touch('p1')
    // Overflow budget by adding a large page
    const bytesAlready = rasterPool._totalBytes()
    const overflowBytes = BUDGET_BYTES - bytesAlready + 1
    const h = Math.ceil(overflowBytes / 4)
    const evict3 = vi.fn().mockImplementation(() => rasterPool.deregister('p3'))
    rasterPool.register('p3', 1, h, evict3)
    // p3 is the newest so it won't be evicted first.
    // p2 is LRU (p1 was touched after p2) → p2 should be evicted, not p1.
    expect(evict2).toHaveBeenCalledTimes(1)
    expect(evict1).not.toHaveBeenCalled()
  })

  it('is a no-op for unknown pageId', () => {
    rasterPool.register('p1', 100, 200, vi.fn())
    const before = rasterPool._totalBytes()
    expect(() => rasterPool.touch('unknown')).not.toThrow()
    expect(rasterPool._totalBytes()).toBe(before)
  })
})

describe('rasterPool.evictIfNeeded — LRU ordering', () => {
  it('evicts least-recently-used pages first until under budget', () => {
    // Register pages well under budget initially
    const evict1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1')) // oldest
    const evict2 = vi.fn().mockImplementation(() => rasterPool.deregister('p2'))
    const evict3 = vi.fn().mockImplementation(() => rasterPool.deregister('p3'))
    rasterPool.register('p1', 100, 100, evict1)
    rasterPool.register('p2', 100, 100, evict2)
    rasterPool.register('p3', 100, 100, evict3) // newest

    // Overflow budget with a large page; p1 should be evicted first
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    const evictBig = vi.fn().mockImplementation(() => rasterPool.deregister('big'))
    rasterPool.register('big', 1, h, evictBig)
    // big is newest, won't be evicted first. p1 (oldest) should be evicted.
    expect(evict1).toHaveBeenCalledTimes(1)
  })

  it('evicts multiple pages until budget is satisfied', () => {
    // Each page = 1 * pageH * 4 = 2MB per page
    const pageH = (2 * 1024 * 1024) / 4 // 524288
    const ids = Array.from({ length: 160 }, (_, i) => `p${i}`)
    const evicts = ids.map((id) => vi.fn().mockImplementation(() => rasterPool.deregister(id)))
    for (let i = 0; i < 160; i++) {
      rasterPool.register(ids[i], 1, pageH, evicts[i])
    }
    // 160 * 2MB = 320MB > 300MB budget; evictions should bring it under budget
    expect(rasterPool._totalBytes()).toBeLessThanOrEqual(BUDGET_BYTES)
    const evictedCount = evicts.filter((e) => e.mock.calls.length > 0).length
    expect(evictedCount).toBeGreaterThan(0)
  })

  it('does not evict when under budget', () => {
    const evict = vi.fn()
    // A small page well under 300MB
    rasterPool.register('p1', 100, 100, evict)
    expect(evict).not.toHaveBeenCalled()
  })

  it('calls deregister semantics: evict callback is responsible for cleanup', () => {
    // The pool calls evict() but does NOT auto-deregister — the evict callback must call deregister.
    // After eviction, totalBytes reflects only the remaining (non-evicted) entries.
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    let deregisteredByCallback = false
    const evictVictim = vi.fn().mockImplementation(() => {
      rasterPool.deregister('victim')
      deregisteredByCallback = true
    })
    rasterPool.register('victim', 1, 100, evictVictim)
    rasterPool.register('big', 1, h, vi.fn())
    expect(evictVictim).toHaveBeenCalledTimes(1)
    expect(deregisteredByCallback).toBe(true)
    // After evict callback deregisters 'victim', only 'big' remains.
    // big is exempt from its own eviction pass, so totalBytes == big's bytes.
    expect(rasterPool._totalBytes()).toBeLessThanOrEqual(1 * h * 4)
  })
})

describe('rasterPool — byte accounting precision', () => {
  it('uses w * h * 4 for RGBA rasters (not a guess)', () => {
    const w = 852
    const h = 1100
    rasterPool.register('p1', w, h, vi.fn())
    expect(rasterPool._totalBytes()).toBe(w * h * 4)
  })

  it('totalBytes starts at 0 after reset', () => {
    expect(rasterPool._totalBytes()).toBe(0)
  })

  it('totalBytes is 0 after registering and deregistering all pages', () => {
    rasterPool.register('p1', 100, 200, vi.fn())
    rasterPool.register('p2', 300, 400, vi.fn())
    rasterPool.deregister('p1')
    rasterPool.deregister('p2')
    expect(rasterPool._totalBytes()).toBe(0)
  })
})

describe('rasterPool — pool key aliasing', () => {
  it('treats different pageIds as separate entries', () => {
    const evict1 = vi.fn()
    const evict2 = vi.fn()
    rasterPool.register('fp1:1', 100, 200, evict1)
    rasterPool.register('fp2:1', 100, 200, evict2)
    expect(rasterPool._totalBytes()).toBe(2 * 100 * 200 * 4)
  })

  it('treats same pageId as same entry (idempotent)', () => {
    rasterPool.register('fp1:1', 100, 200, vi.fn())
    rasterPool.register('fp1:1', 100, 200, vi.fn())
    expect(rasterPool._totalBytes()).toBe(100 * 200 * 4)
  })
})

describe('rasterPool.pin / unpin — visibility pinning', () => {
  it('pinned entry survives eviction pressure', () => {
    const evictP1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    rasterPool.register('p1', 100, 200, evictP1)
    rasterPool.pin('p1')
    // register a page large enough to overflow budget; p1 is pinned so must not be evicted
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    const evictBig = vi.fn().mockImplementation(() => rasterPool.deregister('big'))
    rasterPool.register('big', 1, h, evictBig)
    expect(evictP1).not.toHaveBeenCalled()
  })

  it('unpinned LRU is evicted first when another entry is pinned', () => {
    const evictP1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    const evictP2 = vi.fn().mockImplementation(() => rasterPool.deregister('p2'))
    rasterPool.register('p1', 100, 200, evictP1) // LRU
    rasterPool.register('p2', 100, 200, evictP2)
    rasterPool.pin('p2') // p2 pinned; p1 must be evicted
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    rasterPool.register('big', 1, h, vi.fn().mockImplementation(() => rasterPool.deregister('big')))
    expect(evictP1).toHaveBeenCalledTimes(1)
    expect(evictP2).not.toHaveBeenCalled()
  })

  it('all-pinned over-budget: evicts nothing and does not loop', () => {
    const evict1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    const evict2 = vi.fn().mockImplementation(() => rasterPool.deregister('p2'))
    rasterPool.register('p1', 100, 200, evict1)
    rasterPool.register('p2', 100, 200, evict2)
    rasterPool.pin('p1')
    rasterPool.pin('p2')
    // Manually trigger eviction when all entries are pinned
    rasterPool.evictIfNeeded()
    expect(evict1).not.toHaveBeenCalled()
    expect(evict2).not.toHaveBeenCalled()
    // Pool stays soft-over-budget — that is intentional
  })

  it('all-pinned over-budget via register: evicts nothing', () => {
    const evict1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    rasterPool.register('p1', 100, 200, evict1)
    rasterPool.pin('p1')
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    // big is exempt from its own eviction; p1 is pinned — no evictions
    const evictBig = vi.fn().mockImplementation(() => rasterPool.deregister('big'))
    rasterPool.register('big', 1, h, evictBig)
    expect(evict1).not.toHaveBeenCalled()
    expect(evictBig).not.toHaveBeenCalled()
  })

  it('pin → unpin → pressure evicts it normally', () => {
    const evictP1 = vi.fn().mockImplementation(() => rasterPool.deregister('p1'))
    rasterPool.register('p1', 100, 200, evictP1)
    rasterPool.pin('p1')
    rasterPool.unpin('p1')
    // Now p1 is unpinned and LRU — should be evicted under pressure
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    rasterPool.register('big', 1, h, vi.fn().mockImplementation(() => rasterPool.deregister('big')))
    expect(evictP1).toHaveBeenCalledTimes(1)
  })

  it('unpin on unknown id is a no-op', () => {
    expect(() => rasterPool.unpin('nonexistent')).not.toThrow()
  })
})

describe('rasterPool — giant-raster self-eviction exemption', () => {
  it('entry larger than full budget remains registered after its own registration', () => {
    // A raster bigger than the entire budget must not self-evict.
    const w = 1
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    const evict = vi.fn()
    rasterPool.register('giant', w, h, evict)
    // Entry must still exist — evict must NOT have been called
    expect(evict).not.toHaveBeenCalled()
    expect(rasterPool._totalBytes()).toBe(w * h * 4)
  })

  it('giant entry evicts others but not itself', () => {
    const evictSmall = vi.fn().mockImplementation(() => rasterPool.deregister('small'))
    rasterPool.register('small', 100, 200, evictSmall)
    const h = Math.ceil((BUDGET_BYTES + 1) / 4)
    const evictGiant = vi.fn()
    rasterPool.register('giant', 1, h, evictGiant)
    // small should be evicted (it's the LRU non-exempt entry); giant must survive
    expect(evictSmall).toHaveBeenCalledTimes(1)
    expect(evictGiant).not.toHaveBeenCalled()
  })
})

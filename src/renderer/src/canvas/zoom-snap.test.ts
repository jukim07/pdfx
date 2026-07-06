import { describe, it, expect, vi, afterEach } from 'vitest'
import { isWithinSnapThreshold, snapToFit } from './create-zoom-behavior'
import type { ZoomBehavior } from 'd3-zoom'

describe('isWithinSnapThreshold', () => {
  it('returns true when currentK equals fitK (0% deviation)', () => {
    expect(isWithinSnapThreshold(1.0, 1.0)).toBe(true)
  })

  it('returns true when currentK is 7.9% above fitK (just inside threshold)', () => {
    expect(isWithinSnapThreshold(1.079, 1.0)).toBe(true)
  })

  it('returns true when currentK is 7.9% below fitK (just inside threshold)', () => {
    expect(isWithinSnapThreshold(0.921, 1.0)).toBe(true)
  })

  it('returns true when deviation is within threshold (4%)', () => {
    expect(isWithinSnapThreshold(1.04, 1.0)).toBe(true)
  })

  it('returns false when currentK is just over 8% above fitK', () => {
    // 8.01% deviation
    expect(isWithinSnapThreshold(1.0801, 1.0)).toBe(false)
  })

  it('returns false when currentK is just over 8% below fitK', () => {
    expect(isWithinSnapThreshold(0.9199, 1.0)).toBe(false)
  })

  it('returns false when deviation is large (20%)', () => {
    expect(isWithinSnapThreshold(1.2, 1.0)).toBe(false)
  })

  it('works correctly with a non-unit fitK (0.5)', () => {
    // 7% of 0.5 = 0.035; 0.535 is within threshold
    expect(isWithinSnapThreshold(0.535, 0.5)).toBe(true)
    // 9% of 0.5 = 0.045; 0.545 exceeds threshold
    expect(isWithinSnapThreshold(0.545, 0.5)).toBe(false)
  })

  it('works correctly with a large fitK (2.0)', () => {
    // 7% of 2.0 = 0.14; 2.14 is within threshold
    expect(isWithinSnapThreshold(2.14, 2.0)).toBe(true)
    // 9% of 2.0 = 0.18; 2.18 exceeds threshold
    expect(isWithinSnapThreshold(2.18, 2.0)).toBe(false)
  })
})

describe('snapToFit cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancel() calls cancelAnimationFrame with the pending rAF id', () => {
    // Stub rAF/cAF so the animation loop never actually runs. rAF returns a
    // stable id (42) that the cancel path must forward to cancelAnimationFrame.
    const RAF_ID = 42
    const rafSpy = vi.fn(() => RAF_ID)
    const cafSpy = vi.fn()
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', cafSpy)
    vi.stubGlobal('performance', { now: () => 0 })

    // Minimal fake zoom — transform is never called because rAF is stubbed out
    // (the callback is registered but never invoked in this synchronous test).
    const fakeZoom = { transform: vi.fn() } as unknown as ZoomBehavior<HTMLDivElement, unknown>
    const fakeVp = {} as HTMLDivElement // zoomTransform falls back to zoomIdentity (k=1)

    // fitScale=1.0 with current k=1.0 means 0% deviation: within threshold, animation starts.
    const handle = snapToFit(fakeVp, fakeZoom, 1.0, 0, 0)

    // rAF was called once to schedule the first tick.
    expect(rafSpy).toHaveBeenCalledTimes(1)
    // cancelAnimationFrame not yet called.
    expect(cafSpy).not.toHaveBeenCalled()

    // Simulate a user gesture interrupting the snap.
    handle.cancel()

    // cancelAnimationFrame must receive the id that rAF returned.
    expect(cafSpy).toHaveBeenCalledTimes(1)
    expect(cafSpy).toHaveBeenCalledWith(RAF_ID)
  })

  it('cancel() on an already-threshold-missed handle is a no-op', () => {
    const cafSpy = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cafSpy)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('performance', { now: () => 0 })

    const fakeZoom = { transform: vi.fn() } as unknown as ZoomBehavior<HTMLDivElement, unknown>
    const fakeVp = {} as HTMLDivElement

    // fitScale=2.0 with current k=1.0 → 50% deviation, above threshold → no animation started.
    const handle = snapToFit(fakeVp, fakeZoom, 2.0, 0, 0)

    handle.cancel()
    // No rAF was scheduled, so cancelAnimationFrame should not be called.
    expect(cafSpy).not.toHaveBeenCalled()
  })
})

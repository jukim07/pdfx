/**
 * Logic tests for the watermark state machine.
 *
 * useWatermark is a React hook (useState/useCallback) and cannot be called
 * outside a component without a renderer. Instead we test the async
 * side-effect logic that the hook delegates to window.api, verifying the
 * IPC calls are made with the right arguments and that the WatermarkStep
 * type contract is sound.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Candidate } from '@pdfx/core'
import type { WatermarkStep } from './useWatermark'

// ---------------------------------------------------------------------------
// WatermarkStep type guard (exercises the exported type)
// ---------------------------------------------------------------------------

function isWatermarkStep(v: unknown): v is WatermarkStep {
  return (
    v === 'idle' ||
    v === 'scanning' ||
    v === 'preview' ||
    v === 'stripping' ||
    v === 'done'
  )
}

describe('WatermarkStep', () => {
  it('valid values pass guard', () => {
    const steps: WatermarkStep[] = ['idle', 'scanning', 'preview', 'stripping', 'done']
    for (const s of steps) {
      expect(isWatermarkStep(s)).toBe(true)
    }
  })

  it('invalid values fail guard', () => {
    expect(isWatermarkStep('unknown')).toBe(false)
    expect(isWatermarkStep(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Simulate the async logic that scan() and strip() delegate to window.api
// These mirror useWatermark's internal callbacks exactly — if the hook
// implementation changes, these tests will need updating too.
// ---------------------------------------------------------------------------

const CANDIDATE_A: Candidate = {
  id: 'cand-a',
  kind: 'xobject',
  pageCoverage: 0.8,
  preview: [{ page: 0, bbox: [0, 0, 100, 100] }],
  description: 'Logo watermark'
}

const FAKE_BYTES = new Uint8Array([1, 2, 3])
const STRIPPED_BYTES = new Uint8Array([4, 5, 6])

/**
 * Simulates the async body of useWatermark.scan() in isolation.
 * Returns the final step value so callers can assert on it.
 */
async function runScan(
  bytes: Uint8Array | null,
  findFn: (b: Uint8Array) => Promise<Candidate[]>
): Promise<{ step: WatermarkStep; candidates: Candidate[]; selected: string | null; error: string | null }> {
  if (!bytes) return { step: 'idle', candidates: [], selected: null, error: null }
  try {
    const found = await findFn(bytes)
    return {
      step: 'preview',
      candidates: found,
      selected: found[0]?.id ?? null,
      error: null
    }
  } catch (e) {
    return { step: 'idle', candidates: [], selected: null, error: String(e) }
  }
}

/**
 * Simulates the async body of useWatermark.strip() in isolation.
 */
async function runStrip(
  bytes: Uint8Array | null,
  selected: string | null,
  stripFn: (b: Uint8Array, id: string) => Promise<Uint8Array>,
  onBytesUpdated: (b: Uint8Array) => void
): Promise<{ step: WatermarkStep; error: string | null }> {
  if (!bytes || !selected) return { step: 'idle', error: null }
  try {
    const stripped = await stripFn(bytes, selected)
    onBytesUpdated(stripped)
    return { step: 'done', error: null }
  } catch (e) {
    return { step: 'preview', error: String(e) }
  }
}

describe('scan logic', () => {
  it('returns preview + candidates on success', async () => {
    const findFn = vi.fn().mockResolvedValue([CANDIDATE_A])
    const result = await runScan(FAKE_BYTES, findFn)
    expect(result.step).toBe<WatermarkStep>('preview')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].id).toBe('cand-a')
    expect(result.selected).toBe('cand-a')
    expect(result.error).toBeNull()
    expect(findFn).toHaveBeenCalledWith(FAKE_BYTES)
  })

  it('returns idle when bytes are null', async () => {
    const findFn = vi.fn()
    const result = await runScan(null, findFn)
    expect(result.step).toBe<WatermarkStep>('idle')
    expect(findFn).not.toHaveBeenCalled()
  })

  it('returns idle + error when find throws', async () => {
    const findFn = vi.fn().mockRejectedValue(new Error('scan fail'))
    const result = await runScan(FAKE_BYTES, findFn)
    expect(result.step).toBe<WatermarkStep>('idle')
    expect(result.error).toMatch('scan fail')
    expect(result.candidates).toEqual([])
  })

  it('selected is null when no candidates returned', async () => {
    const findFn = vi.fn().mockResolvedValue([])
    const result = await runScan(FAKE_BYTES, findFn)
    expect(result.step).toBe<WatermarkStep>('preview')
    expect(result.selected).toBeNull()
  })
})

describe('strip logic', () => {
  it('calls stripFn with bytes and id, invokes onBytesUpdated', async () => {
    const stripFn = vi.fn().mockResolvedValue(STRIPPED_BYTES)
    const onBytesUpdated = vi.fn()
    const result = await runStrip(FAKE_BYTES, 'cand-a', stripFn, onBytesUpdated)
    expect(result.step).toBe<WatermarkStep>('done')
    expect(result.error).toBeNull()
    expect(stripFn).toHaveBeenCalledWith(FAKE_BYTES, 'cand-a')
    expect(onBytesUpdated).toHaveBeenCalledWith(STRIPPED_BYTES)
  })

  it('returns idle without calling stripFn when bytes is null', async () => {
    const stripFn = vi.fn()
    const onBytesUpdated = vi.fn()
    const result = await runStrip(null, 'cand-a', stripFn, onBytesUpdated)
    expect(result.step).toBe<WatermarkStep>('idle')
    expect(stripFn).not.toHaveBeenCalled()
    expect(onBytesUpdated).not.toHaveBeenCalled()
  })

  it('returns idle without calling stripFn when selected is null', async () => {
    const stripFn = vi.fn()
    const onBytesUpdated = vi.fn()
    const result = await runStrip(FAKE_BYTES, null, stripFn, onBytesUpdated)
    expect(result.step).toBe<WatermarkStep>('idle')
    expect(stripFn).not.toHaveBeenCalled()
    expect(onBytesUpdated).not.toHaveBeenCalled()
  })

  it('returns preview + error when stripFn throws', async () => {
    const stripFn = vi.fn().mockRejectedValue(new Error('strip fail'))
    const onBytesUpdated = vi.fn()
    const result = await runStrip(FAKE_BYTES, 'cand-a', stripFn, onBytesUpdated)
    expect(result.step).toBe<WatermarkStep>('preview')
    expect(result.error).toMatch('strip fail')
    expect(onBytesUpdated).not.toHaveBeenCalled()
  })
})

describe('candidate shape', () => {
  it('Candidate has required fields', () => {
    const c: Candidate = CANDIDATE_A
    expect(typeof c.id).toBe('string')
    expect(c.kind === 'xobject' || c.kind === 'text').toBe(true)
    expect(typeof c.pageCoverage).toBe('number')
    expect(Array.isArray(c.preview)).toBe(true)
    expect(typeof c.description).toBe('string')
  })

  it('preview page is 0-based', () => {
    // The brief specifies preview[].page is 0-BASED.
    const c: Candidate = CANDIDATE_A
    expect(c.preview[0].page).toBe(0) // 0-based: first page
  })
})

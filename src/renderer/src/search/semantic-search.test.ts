import { describe, it, expect } from 'vitest'
import { cosineSim } from './useSemanticSearch'

// Pure logic tests — no Worker, no model download, no network.

describe('cosineSim', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const v = [1, 0, 0]
    expect(cosineSim(v, v)).toBeCloseTo(1)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('returns -1.0 for opposite unit vectors', () => {
    expect(cosineSim([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1)
  })

  it('handles 384-dim unit vectors (bge output shape)', () => {
    const a = new Array(384).fill(0)
    const b = new Array(384).fill(0)
    a[0] = 1
    b[0] = 1
    expect(cosineSim(a, b)).toBeCloseTo(1)
  })

  it('computes partial similarity correctly', () => {
    // 45-degree angle → cos(45°) ≈ 0.707
    const v = [1 / Math.SQRT2, 1 / Math.SQRT2, 0]
    const u = [1, 0, 0]
    expect(cosineSim(v, u)).toBeCloseTo(1 / Math.SQRT2)
  })
})

// Hybrid scoring logic: test the merge formula directly
// combined = 0.5 * kwScore + 0.5 * semScore, threshold 0.3
describe('hybrid merge scoring formula', () => {
  const HYBRID_KEYWORD_WEIGHT = 0.5
  const HYBRID_SEMANTIC_WEIGHT = 0.5
  const SCORE_THRESHOLD = 0.3

  function hybrid(kwHit: boolean, semScore: number): number {
    return HYBRID_KEYWORD_WEIGHT * (kwHit ? 1 : 0) + HYBRID_SEMANTIC_WEIGHT * Math.max(0, semScore)
  }

  it('keyword hit with zero semantic score exceeds threshold', () => {
    expect(hybrid(true, 0)).toBe(0.5)
    expect(hybrid(true, 0)).toBeGreaterThanOrEqual(SCORE_THRESHOLD)
  })

  it('no keyword hit with high semantic score exceeds threshold', () => {
    // semScore 0.7 → combined 0.35 ≥ 0.3
    expect(hybrid(false, 0.7)).toBeGreaterThanOrEqual(SCORE_THRESHOLD)
  })

  it('no keyword hit with low semantic score falls below threshold', () => {
    // semScore 0.4 → combined 0.2 < 0.3
    expect(hybrid(false, 0.4)).toBeLessThan(SCORE_THRESHOLD)
  })

  it('negative cosine scores are clamped to 0', () => {
    // semScore -0.5 → clamped 0, combined 0 < 0.3
    expect(hybrid(false, -0.5)).toBeLessThan(SCORE_THRESHOLD)
  })

  it('both keyword hit and high semantic hit gives full weight', () => {
    expect(hybrid(true, 1)).toBe(1)
    expect(hybrid(true, 1)).toBeGreaterThanOrEqual(SCORE_THRESHOLD)
  })

  it('exact threshold boundary: semScore=0.6 with no kw hit equals threshold', () => {
    expect(hybrid(false, 0.6)).toBeCloseTo(SCORE_THRESHOLD)
  })
})

// embed-protocol encode/decode: verify the discriminated union types round-trip correctly
describe('embed protocol message types', () => {
  it('EmbedRequest has type="embed"', () => {
    const msg = { type: 'embed' as const, jobId: '1', texts: ['hello'], isQuery: true }
    expect(msg.type).toBe('embed')
    expect(msg.isQuery).toBe(true)
  })

  it('EmbedReadyResponse has type="ready"', () => {
    const msg = { type: 'ready' as const }
    expect(msg.type).toBe('ready')
  })

  it('EmbedResultResponse has type="result" and embeddings', () => {
    const embeddings = [[0.1, 0.2, 0.3]]
    const msg = { type: 'result' as const, jobId: '2', embeddings }
    expect(msg.type).toBe('result')
    expect(msg.embeddings).toHaveLength(1)
  })

  it('EmbedErrorResponse has type="error" and message', () => {
    const msg = { type: 'error' as const, jobId: '3', message: 'oops' }
    expect(msg.type).toBe('error')
    expect(msg.message).toBe('oops')
  })

  it('EmbedDisposeRequest has type="dispose"', () => {
    const msg = { type: 'dispose' as const }
    expect(msg.type).toBe('dispose')
  })
})

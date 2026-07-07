import { useCallback, useEffect, useRef } from 'react'
import { createEmbedClient, type EmbedClient } from './embed-client'
import type { SearchResult } from './engine'
import type { DocEntry } from '../types'

export interface SemanticSearchResult extends SearchResult {
  semanticActive: boolean
}

const EMPTY: SemanticSearchResult = {
  pageIds: new Set(),
  docIds: new Set(),
  pages: 0,
  occurrences: 0,
  semanticActive: false
}

const HYBRID_KEYWORD_WEIGHT = 0.5
const HYBRID_SEMANTIC_WEIGHT = 0.5
const SCORE_THRESHOLD = 0.3

/**
 * Dot product of two unit-length vectors == cosine similarity.
 * bge-small-en-v1.5 with normalize:true guarantees unit vectors.
 */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/**
 * Hybrid semantic+keyword search over the page text index.
 *
 * @param pageTexts  Map<pageId, text> — exposed via SearchEngine.getPageTexts()
 * @param keywordSearch  The existing synchronous engine.search(query) function
 * @param docs  Current docs (for docId resolution)
 */
export function useSemanticSearch(
  pageTexts: ReadonlyMap<string, string>,
  keywordSearch: (q: string) => SearchResult,
  docs: DocEntry[]
): {
  semanticSearch: (query: string) => Promise<SemanticSearchResult>
  dispose: () => void
} {
  const clientRef = useRef<EmbedClient | null>(null)

  if (!clientRef.current) {
    clientRef.current = createEmbedClient()
  }

  const semanticSearch = useCallback(
    async (query: string): Promise<SemanticSearchResult> => {
      if (!query.trim()) return EMPTY
      const client = clientRef.current!

      // 1. Keyword arm (synchronous)
      const kwResult = keywordSearch(query)

      // 2. Semantic arm — embed query and all page texts
      const pageEntries = [...pageTexts.entries()] // [pageId, text][]
      if (pageEntries.length === 0) return { ...kwResult, semanticActive: true }

      let queryEmbed: number[][]
      let passageEmbeds: number[][]
      try {
        ;[queryEmbed, passageEmbeds] = await Promise.all([
          client.embed([query], true),
          client.embed(
            pageEntries.map(([, text]) => text.slice(0, 512)),
            false
          )
        ])
      } catch {
        // Model unavailable (offline, worker terminated) — fall back to keyword-only
        return { ...kwResult, semanticActive: false }
      }

      const qVec = queryEmbed[0]

      // 3. Score each page and include those at or above threshold
      const scoredPageIds = new Set<string>()
      for (let i = 0; i < pageEntries.length; i++) {
        const [pageId] = pageEntries[i]
        const kwScore = kwResult.pageIds.has(pageId) ? 1 : 0
        // Cosine is in [-1, 1] for normalized vecs; clamp negatives to 0
        const semScore = Math.max(0, cosineSim(qVec, passageEmbeds[i]))
        const combined = HYBRID_KEYWORD_WEIGHT * kwScore + HYBRID_SEMANTIC_WEIGHT * semScore
        if (combined >= SCORE_THRESHOLD) scoredPageIds.add(pageId)
      }

      const docIds = new Set<string>()
      for (const doc of docs) {
        if (doc.pages.some((p) => scoredPageIds.has(p.id))) docIds.add(doc.id)
      }

      return {
        pageIds: scoredPageIds,
        docIds,
        pages: scoredPageIds.size,
        occurrences: kwResult.occurrences,
        semanticActive: true
      }
    },
    [pageTexts, keywordSearch, docs]
  )

  const dispose = useCallback(() => {
    clientRef.current?.dispose()
    clientRef.current = null
  }, [])

  useEffect(() => () => dispose(), [dispose])

  return { semanticSearch, dispose }
}

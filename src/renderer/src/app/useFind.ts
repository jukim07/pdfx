import { useCallback, useEffect, useState } from 'react'
import type { SearchResult } from '../search/useSearchIndex'
import type { SemanticSearchResult } from '../search/useSemanticSearch'

const EMPTY_RESULT: SearchResult = {
  pageIds: new Set(),
  docIds: new Set(),
  pages: 0,
  occurrences: 0
}

const DEBOUNCE_MS = 150

export interface Find {
  open: boolean
  query: string
  result: SearchResult
  matchedQuery: string
  active: boolean
  isSearching: boolean
  setQuery: (query: string) => void
  openFind: () => void
  closeFind: () => void
}

export function useFind(
  search: (query: string) => SearchResult,
  version: number,
  semanticSearchFn?: (query: string) => Promise<SemanticSearchResult>
): Find {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult>(EMPTY_RESULT)
  const [matchedQuery, setMatchedQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  const active = open && query.trim().length > 0

  // Primary search effect: re-runs on query/active change or when semanticSearchFn changes
  useEffect(() => {
    if (!active) {
      setResult(EMPTY_RESULT)
      setMatchedQuery('')
      setIsSearching(false)
      return
    }
    if (semanticSearchFn) {
      // Async path: show keyword results immediately, then upgrade to hybrid
      const kwResult = search(query)
      setResult(kwResult)
      setMatchedQuery(query)
      setIsSearching(true)
      let cancelled = false
      const timer = setTimeout(() => {
        void semanticSearchFn(query).then((r) => {
          if (cancelled) return
          setResult(r)
          setMatchedQuery(query)
          setIsSearching(false)
        }).catch(() => {
          if (cancelled) return
          setIsSearching(false)
        })
      }, DEBOUNCE_MS)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
    // Synchronous keyword path
    const timer = setTimeout(() => {
      setResult(search(query))
      setMatchedQuery(query)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [active, query, search, semanticSearchFn])

  // Re-run on index version bump (new OCR text available)
  useEffect(() => {
    if (!active) return
    if (semanticSearchFn) {
      setIsSearching(true)
      let cancelled = false
      const timer = setTimeout(() => {
        void semanticSearchFn(query).then((r) => {
          if (cancelled) return
          setResult(r)
          setMatchedQuery(query)
          setIsSearching(false)
        }).catch(() => {
          if (cancelled) return
          // Fall back to keyword
          setResult(search(query))
          setMatchedQuery(query)
          setIsSearching(false)
        })
      }, DEBOUNCE_MS)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
    const timer = setTimeout(() => {
      setResult(search(query))
      setMatchedQuery(query)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const openFind = useCallback(() => setOpen(true), [])
  const closeFind = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  return { open, query, result, matchedQuery, active, isSearching, setQuery, openFind, closeFind }
}

import { useEffect, useRef } from 'react'

interface WorkspaceState {
  openPaths: string[]
}

const DEBOUNCE_MS = 2000

/**
 * Autosaves the list of open file paths to userData/pdfx-settings.json on a
 * 2s debounce, and restores them on first mount by calling onRestore.
 *
 * openPaths: reactive list maintained by useImport (passed from App.tsx).
 * onRestore: called once on mount with the paths read from disk, so the caller
 *   can re-open them via addFiles. Missing paths are silently skipped (the
 *   caller decides — expandDropPaths on main will filter non-existent files).
 */
export function useWorkspace(
  openPaths: string[],
  onRestore: (paths: string[]) => void
): void {
  const restoredRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore on mount — runs once; restoredRef prevents double-fire in StrictMode.
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    void (async () => {
      try {
        const raw = await window.api.readSettings()
        if (!raw) return
        const state = JSON.parse(raw) as WorkspaceState
        if (Array.isArray(state.openPaths) && state.openPaths.length > 0) {
          onRestore(state.openPaths.filter((p) => typeof p === 'string'))
        }
      } catch {
        // Malformed JSON or missing file — start fresh
      }
    })()
    // onRestore is stable (useCallback in App.tsx); eslint-disable intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave whenever openPaths changes (debounced 2s).
  // The cleanup cancels any pending timer on unmount, preventing a write-after-free.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const state: WorkspaceState = { openPaths }
      void window.api
        .writeSettings(JSON.stringify(state))
        .catch(() => {
          /* ignore transient write errors */
        })
    }, DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [openPaths])
}

import { useState, useCallback } from 'react'
import type { Candidate } from '@pdfx/core'

export type WatermarkStep = 'idle' | 'scanning' | 'preview' | 'stripping' | 'done'

export function useWatermark(
  getActiveDocBytes: () => Uint8Array | null,
  onBytesUpdated: (bytes: Uint8Array) => void
) {
  const [step, setStep] = useState<WatermarkStep>('idle')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    const bytes = getActiveDocBytes()
    if (!bytes) return
    setStep('scanning')
    setError(null)
    try {
      const found = await window.api.findWatermarkCandidates(bytes)
      setCandidates(found)
      setSelected(found[0]?.id ?? null)
      setStep('preview')
    } catch (e) {
      setError(String(e))
      setStep('idle')
    }
  }, [getActiveDocBytes])

  const strip = useCallback(async () => {
    const bytes = getActiveDocBytes()
    if (!bytes || !selected) return
    setStep('stripping')
    setError(null)
    try {
      const stripped = await window.api.stripWatermark(bytes, selected)
      onBytesUpdated(stripped)
      setCandidates([])
      setSelected(null)
      setStep('done')
    } catch (e) {
      setError(String(e))
      setStep('preview')
    }
  }, [getActiveDocBytes, selected, onBytesUpdated])

  const dismiss = useCallback(() => {
    setCandidates([])
    setSelected(null)
    setStep('idle')
    setError(null)
  }, [])

  return { step, candidates, selected, setSelected, error, scan, strip, dismiss }
}

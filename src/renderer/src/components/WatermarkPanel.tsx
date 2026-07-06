import React from 'react'
import type { Candidate } from '@pdfx/core'
import type { WatermarkStep } from '../app/useWatermark'

interface WatermarkPanelProps {
  step: WatermarkStep
  candidates: Candidate[]
  selected: string | null
  onSelect: (id: string) => void
  onStrip: () => void
  onDismiss: () => void
  error: string | null
}

export function WatermarkPanel({
  step,
  candidates,
  selected,
  onSelect,
  onStrip,
  onDismiss,
  error
}: WatermarkPanelProps): React.ReactElement | null {
  if (step === 'idle') return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 320,
        background: 'var(--color-bg, #fff)',
        border: '1px solid var(--color-border, #ccc)',
        borderRadius: 8,
        padding: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        zIndex: 100
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Watermark</strong>
        <button onClick={onDismiss} aria-label="Close" style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 18 }}>×</button>
      </div>

      {step === 'scanning' && <p style={{ marginTop: 8 }}>Scanning…</p>}
      {step === 'stripping' && <p style={{ marginTop: 8 }}>Removing…</p>}
      {step === 'done' && <p style={{ marginTop: 8, color: 'green' }}>Watermark removed.</p>}

      {(step === 'preview') && candidates.length === 0 && (
        <p style={{ marginTop: 8 }}>No watermark candidates detected.</p>
      )}

      {(step === 'preview') && candidates.length > 0 && (
        <>
          <p style={{ marginTop: 8, marginBottom: 4, fontSize: 13 }}>
            Select a candidate to remove:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {candidates.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: selected === c.id ? 'var(--color-accent, #e0eaff)' : 'transparent',
                  fontSize: 13
                }}
                onClick={() => onSelect(c.id)}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>
                  {c.kind}
                </span>{' '}
                {c.description}
                <br />
                <span style={{ fontSize: 11, opacity: 0.5 }}>
                  {(c.pageCoverage * 100).toFixed(0)}% of pages
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={onStrip}
            disabled={!selected}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '8px 0',
              cursor: selected ? 'pointer' : 'not-allowed',
              borderRadius: 4,
              border: 'none',
              background: selected ? 'var(--color-accent, #3b82f6)' : '#ccc',
              color: '#fff',
              fontWeight: 600
            }}
          >
            Remove watermark
          </button>
        </>
      )}

      {error && (
        <p style={{ marginTop: 8, color: 'red', fontSize: 12 }}>{error}</p>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { StoredSignature } from '../../../preload'
import { SignaturePad } from './SignaturePad'

interface SignaturePickerProps {
  /** Called with the selected PNG bytes; caller enters placement mode. */
  onPick: (png: Uint8Array) => void
  /** Called to close the picker without a selection. */
  onClose: () => void
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function SignaturePicker({ onPick, onClose }: SignaturePickerProps): React.JSX.Element {
  const [sigs, setSigs] = useState<StoredSignature[]>([])
  const [addingNew, setAddingNew] = useState(false)
  const [saveName, setSaveName] = useState('')

  const reload = useCallback(() => {
    void window.api.signatures.list().then(setSigs)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handlePick = useCallback(
    (s: StoredSignature) => {
      onPick(base64ToBytes(s.pngBase64))
    },
    [onPick]
  )

  const handleSaveNew = useCallback(
    async (png: Uint8Array) => {
      const name = saveName.trim() || 'Signature'
      await window.api.signatures.add(name, png)
      setAddingNew(false)
      setSaveName('')
      reload()
      // Immediately place: pick the just-saved signature bytes
      onPick(png)
    },
    [saveName, reload, onPick]
  )

  const handleRemove = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await window.api.signatures.remove(id)
      reload()
    },
    [reload]
  )

  if (addingNew) {
    return (
      <div className="signature-picker-modal">
        <div className="signature-picker">
          <div className="signature-picker-header">
            <span>Draw your signature</span>
            <button className="icon-btn" onClick={() => setAddingNew(false)}>
              ✕
            </button>
          </div>
          <div className="signature-picker-name-row">
            <input
              className="signature-picker-name-input"
              placeholder="Signature name (optional)"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </div>
          <SignaturePad
            onSave={(png) => void handleSaveNew(png)}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="signature-picker-modal">
      <div className="signature-picker">
        <div className="signature-picker-header">
          <span>Choose signature</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="signature-picker-list">
          {sigs.map((s) => (
            <button key={s.id} className="signature-chip" onClick={() => handlePick(s)}>
              <img src={`data:image/png;base64,${s.pngBase64}`} alt={s.name} />
              <span className="signature-chip-name">{s.name}</span>
              <span
                className="signature-chip-remove"
                role="button"
                tabIndex={0}
                onClick={(e) => void handleRemove(s.id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void handleRemove(s.id, e as unknown as React.MouseEvent)
                }}
                title="Delete signature"
              >
                ✕
              </span>
            </button>
          ))}
          <button className="signature-chip add" onClick={() => setAddingNew(true)}>
            + New signature
          </button>
        </div>
      </div>
    </div>
  )
}

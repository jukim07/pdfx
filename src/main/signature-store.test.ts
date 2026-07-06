import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignatureStore } from './signature-store'

describe('SignatureStore', () => {
  it('adds, lists, removes signatures persisted to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-sig-test-'))
    try {
      const store = new SignatureStore(dir)
      expect(store.list()).toHaveLength(0)

      const png = new Uint8Array([137, 80, 78, 71]) // minimal PNG header bytes
      const sig = store.add('My Signature', png)
      expect(sig.id).toMatch(/^sig_/)
      expect(sig.name).toBe('My Signature')
      expect(sig.pngBase64).toBe(Buffer.from(png).toString('base64'))
      expect(sig.createdAt).toBeGreaterThan(0)

      // persistence: new store instance reads same file
      const store2 = new SignatureStore(dir)
      const list = store2.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(sig.id)

      store2.remove(sig.id)
      expect(store2.list()).toHaveLength(0)

      // another new instance confirms removal persisted
      expect(new SignatureStore(dir).list()).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('multiple adds accumulate, remove is id-specific', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-sig-test-'))
    try {
      const store = new SignatureStore(dir)
      const a = store.add('Alice', new Uint8Array([1]))
      const b = store.add('Bob', new Uint8Array([2]))
      expect(store.list()).toHaveLength(2)
      store.remove(a.id)
      const remaining = store.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(b.id)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('constructor creates dir if it does not exist', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pdfx-sig-test-'))
    const nested = join(parent, 'nested', 'deep')
    try {
      const store = new SignatureStore(nested)
      store.add('Test', new Uint8Array([0]))
      expect(store.list()).toHaveLength(1)
    } finally {
      rmSync(parent, { recursive: true })
    }
  })

  it('handles corrupt signatures.json gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-sig-test-'))
    try {
      const { writeFileSync } = require('node:fs')
      writeFileSync(join(dir, 'signatures.json'), 'NOT JSON')
      const store = new SignatureStore(dir)
      expect(store.list()).toHaveLength(0)
      // can still add after corruption
      store.add('Recovered', new Uint8Array([9]))
      expect(store.list()).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})

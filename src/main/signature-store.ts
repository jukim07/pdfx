import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StoredSignature {
  id: string
  name: string
  pngBase64: string
  createdAt: number
}

export class SignatureStore {
  private readonly file: string

  /** dir defaults to Electron userData in production; injectable in tests. */
  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'signatures.json')
  }

  private read(): StoredSignature[] {
    if (!existsSync(this.file)) return []
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoredSignature[]
    } catch {
      return []
    }
  }

  private write(sigs: StoredSignature[]): void {
    writeFileSync(this.file, JSON.stringify(sigs, null, 2))
  }

  list(): StoredSignature[] {
    return this.read()
  }

  add(name: string, png: Uint8Array): StoredSignature {
    const sig: StoredSignature = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      pngBase64: Buffer.from(png).toString('base64'),
      createdAt: Date.now()
    }
    const all = this.read()
    all.push(sig)
    this.write(all)
    return sig
  }

  remove(id: string): void {
    this.write(this.read().filter((s) => s.id !== id))
  }
}

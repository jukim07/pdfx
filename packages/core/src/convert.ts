import type { PageSize } from './model.js'

export interface Converter {
  match: (name: string, data: Uint8Array) => boolean
  toPdf: (name: string, data: Uint8Array, fit?: PageSize, path?: string) => Promise<Uint8Array>
  rename: (name: string) => string
}

// Mutable registry: environments register their own converters (the Electron
// renderer registers image + markup converters at startup; headless callers
// register none in Phase 1). Order matters — first match wins.
const converters: Converter[] = []

export function registerConverter(converter: Converter): void {
  converters.push(converter)
}

export const findConverter = (name: string, data: Uint8Array): Converter | null =>
  converters.find((c) => c.match(name, data)) ?? null

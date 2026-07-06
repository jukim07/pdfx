import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Annot, StampAnnot, RedactRegion, RedactMode } from '@pdfx/core'

export interface OpenedFile {
  name: string
  data: Uint8Array
  path?: string
  sha256?: string
  importedAt?: string
}

export type ZoomAction = 'in' | 'out' | 'reset'

export type MenuAction = 'open' | 'export-pdfx' | 'export-pdf' | 'export-zip' | 'export-legible' | 'watermark-panel'

export interface SaveFilter {
  name: string
  extensions: string[]
}

export interface StoredSignature {
  id: string
  name: string
  pngBase64: string
  createdAt: number
}

const api = {
  // Env-only gate (preload can't see app.isPackaged): safe because the bridge is read-only and main's dialog queues stay double-gated.
  isTestMode: process.env.PDFX_TEST_MODE === '1',
  platform: process.platform,
  rendererReady: (): Promise<void> => ipcRenderer.invoke('pdfx:renderer-ready'),
  chooseSavePath: (defaultName: string, filter?: SaveFilter): Promise<string | null> =>
    ipcRenderer.invoke('pdfx:choose-save-path', defaultName, filter),
  readClipboardImage: (): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('pdfx:read-clipboard-image'),
  readClipboardFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('pdfx:read-clipboard-files'),
  clearClipboard: (): Promise<void> => ipcRenderer.invoke('pdfx:clipboard-clear'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  expandDropPaths: (paths: string[]): Promise<OpenedFile[]> =>
    ipcRenderer.invoke('pdfx:expand-drop-paths', paths),
  readResource: (
    htmlPath: string,
    ref: string
  ): Promise<{ data: Uint8Array; mime: string } | null> =>
    ipcRenderer.invoke('pdfx:read-resource', htmlPath, ref),
  markupToPdf: (html: string, fitPageHeightPx?: number): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:markup-to-pdf', html, fitPageHeightPx),
  writeFile: (path: string, data: Uint8Array): Promise<string> =>
    ipcRenderer.invoke('pdfx:write-file', path, data),
  writeAnnots: (bytes: Uint8Array, annots: Annot[]): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:write-annots', bytes, annots),
  writeStampAnnots: (bytes: Uint8Array, stamps: StampAnnot[]): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:write-stamp-annots', bytes, stamps),
  redactDoc: (
    bytes: Uint8Array,
    regions: RedactRegion[],
    mode: RedactMode
  ): Promise<Uint8Array | { surgeryFailed: true; page: number }> =>
    ipcRenderer.invoke('pdfx:redact', bytes, regions, mode),
  signatures: {
    list: (): Promise<StoredSignature[]> => ipcRenderer.invoke('pdfx:sig-list'),
    add: (name: string, png: Uint8Array): Promise<StoredSignature> =>
      ipcRenderer.invoke('pdfx:sig-add', name, png),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('pdfx:sig-remove', id)
  },
  openFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('pdfx:open-files'),
  onFilesOpened: (callback: (files: OpenedFile[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, files: OpenedFile[]): void =>
      callback(files)
    ipcRenderer.on('pdfx:files-opened', listener)
    return () => ipcRenderer.removeListener('pdfx:files-opened', listener)
  },
  onZoom: (callback: (action: ZoomAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: ZoomAction): void =>
      callback(action)
    ipcRenderer.on('pdfx:zoom', listener)
    return () => ipcRenderer.removeListener('pdfx:zoom', listener)
  },
  onMenu: (callback: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: MenuAction): void =>
      callback(action)
    ipcRenderer.on('pdfx:menu', listener)
    return () => ipcRenderer.removeListener('pdfx:menu', listener)
  },
  findWatermarkCandidates: (bytes: Uint8Array): Promise<import('@pdfx/core').Candidate[]> =>
    ipcRenderer.invoke('pdfx:watermark-op', 'find', bytes),
  stripWatermark: (bytes: Uint8Array, candidateId: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:watermark-op', 'strip', bytes, candidateId),
  rebuildLegible: (bytes: Uint8Array): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:watermark-op', 'legible', bytes)
}

export type PdfxApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}

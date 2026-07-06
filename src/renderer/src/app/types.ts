export interface IncomingFile {
  name: string
  data: Uint8Array
  path?: string
  sha256?: string
  importedAt?: string
}

export interface PageRef {
  docId: string
  pageId: string
}

export interface FullViewTarget extends PageRef {
  originRect: { left: number; top: number; width: number; height: number } | null
}

export type AnnotType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'text'
  | 'ink'
  | 'stamp'

/** Four corners in PDF user space (origin bottom-left), ordered per PDF /QuadPoints:
 * (x1,y1)=upper-left, (x2,y2)=upper-right, (x3,y3)=lower-left, (x4,y4)=lower-right. */
export interface Quad {
  x1: number
  y1: number
  x2: number
  y2: number
  x3: number
  y3: number
  x4: number
  y4: number
}

/** PDF user space, origin bottom-left. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** RGB components each in range 0..1. */
export interface RGB {
  r: number
  g: number
  b: number
}

export interface MarkupAnnot {
  type: 'highlight' | 'underline' | 'strikeout'
  page: number
  quads: Quad[]
  color: RGB
  opacity?: number
  contents?: string
}

export interface NoteAnnot {
  type: 'note'
  page: number
  rect: Rect
  color: RGB
  contents: string
  open?: boolean
}

export interface FreeTextAnnot {
  type: 'text'
  page: number
  rect: Rect
  contents: string
  fontSize: number
  color: RGB
}

export interface InkAnnot {
  type: 'ink'
  page: number
  /** Each path is flat [x1,y1,x2,y2,...] polyline in PDF user space. */
  paths: number[][]
  color: RGB
  borderWidth: number
}

export interface StampAnnot {
  type: 'stamp'
  page: number
  rect: Rect
  png: Uint8Array
}

export type Annot = MarkupAnnot | NoteAnnot | FreeTextAnnot | InkAnnot | StampAnnot

export interface PageAnnots {
  page: number
  annots: Annot[]
}

export function isMarkup(a: Annot): a is MarkupAnnot {
  return a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout'
}

export const EMPTY_PAGE_ANNOTS = (page: number): PageAnnots => ({ page, annots: [] })

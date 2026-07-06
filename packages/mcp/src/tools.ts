import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import {
  parseManifest,
  pullPages,
  deletePages,
  rotatePages,
  cropPages,
  splitPdfx,
  mergeInputs
} from '@pdfx/core'
import type { Box, MergeInput } from '@pdfx/core'
import { extractArtifacts, extractAssets } from '@pdfx/core/extract'
import type { ArtifactManifest, AssetsManifest, ExtractArtifactsOptions } from '@pdfx/core/extract'

// JSON result shapes mirroring CLI --json output
export interface InfoResult {
  file: string
  bytes: number
  sha256: string
  pageCount: number
  title: string | null
  docs: { name: string; pages: number }[]
  manifest: object | null
}

export interface ExtractResult {
  outDir: string
  manifest: ArtifactManifest
}

export interface SplitResult {
  outputs: { name: string; path: string }[]
}

export interface WriteResult {
  outputPath: string
  pageCount: number
}

export interface AssetsResult {
  outDir: string
  manifest: AssetsManifest
}

async function loadBytes(inputPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(inputPath))
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return pdf.getPageCount()
}

async function writeOut(outputPath: string, bytes: Uint8Array): Promise<WriteResult> {
  await writeFile(outputPath, bytes)
  return { outputPath, pageCount: await pageCountOf(bytes) }
}

export async function toolInfo(args: { inputPath: string }): Promise<InfoResult> {
  const bytes = await loadBytes(args.inputPath)
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const manifest = await parseManifest(bytes)
  const docs = manifest
    ? manifest.documents.map((d) => ({ name: d.name, pages: d.pages }))
    : [{ name: path.basename(args.inputPath, path.extname(args.inputPath)), pages: pdf.getPageCount() }]
  return {
    file: args.inputPath,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: pdf.getPageCount(),
    title: manifest?.title ?? null,
    docs,
    manifest: manifest as object | null
  }
}

export async function toolExtract(args: {
  inputPath: string
  outDir: string
  ocr?: boolean
  dpi?: number
}): Promise<ExtractResult> {
  const bytes = await loadBytes(args.inputPath)
  await mkdir(args.outDir, { recursive: true })
  const opts: ExtractArtifactsOptions = {}
  if (args.ocr !== undefined) opts.ocr = args.ocr
  if (args.dpi !== undefined) opts.dpi = args.dpi
  const manifest = await extractArtifacts(bytes, args.outDir, opts)
  return { outDir: args.outDir, manifest }
}

export async function toolSplit(args: {
  inputPath: string
  outDir: string
}): Promise<SplitResult> {
  const bytes = await loadBytes(args.inputPath)
  await mkdir(args.outDir, { recursive: true })
  const parts = await splitPdfx(bytes)
  const outputs: { name: string; path: string }[] = []
  for (const part of parts) {
    const outPath = path.join(args.outDir, `${part.name}.pdf`)
    await writeFile(outPath, part.pdf)
    outputs.push({ name: part.name, path: outPath })
  }
  return { outputs }
}

export async function toolMerge(args: {
  inputs: { path: string; ranges?: string; name?: string }[]
  outputPath: string
  kind: 'pdf' | 'pdfx'
}): Promise<WriteResult> {
  const inputs: MergeInput[] = await Promise.all(
    args.inputs.map(async (i) => ({
      bytes: await loadBytes(i.path),
      ranges: i.ranges,
      name: i.name
    }))
  )
  const merged = await mergeInputs(inputs, args.kind)
  return writeOut(args.outputPath, merged)
}

export async function toolPull(args: {
  inputPath: string
  ranges: string
  outputPath: string
}): Promise<WriteResult> {
  const bytes = await loadBytes(args.inputPath)
  const out = await pullPages(bytes, args.ranges)
  return writeOut(args.outputPath, out)
}

export async function toolDelete(args: {
  inputPath: string
  ranges: string
  outputPath: string
}): Promise<WriteResult> {
  const bytes = await loadBytes(args.inputPath)
  const out = await deletePages(bytes, args.ranges)
  return writeOut(args.outputPath, out)
}

export async function toolRotate(args: {
  inputPath: string
  degrees: 90 | 180 | 270
  ranges?: string
  outputPath: string
}): Promise<WriteResult> {
  const bytes = await loadBytes(args.inputPath)
  // rotatePages signature: (bytes, angleDeg, ranges?) — NOT (bytes, ranges, degrees)
  const out = await rotatePages(bytes, args.degrees, args.ranges)
  return writeOut(args.outputPath, out)
}

export async function toolCrop(args: {
  inputPath: string
  box: Box
  ranges?: string
  outputPath: string
}): Promise<WriteResult> {
  const bytes = await loadBytes(args.inputPath)
  const out = await cropPages(bytes, args.box, args.ranges)
  return writeOut(args.outputPath, out)
}

export async function toolAssets(args: {
  inputPath: string
  outDir: string
}): Promise<AssetsResult> {
  const bytes = await loadBytes(args.inputPath)
  await mkdir(args.outDir, { recursive: true })
  const manifest = await extractAssets(bytes, args.outDir)
  return { outDir: args.outDir, manifest }
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  toolInfo,
  toolExtract,
  toolSplit,
  toolMerge,
  toolPull,
  toolDelete,
  toolRotate,
  toolCrop,
  toolAssets
} from './tools.js'

// Wraps a typed tool function in the ok/error envelope expected by MCP clients.
// Errors are returned as isError:true content rather than thrown, so the LLM
// can see and self-correct from tool failures.
function wrapTool<T>(fn: (args: T) => Promise<object>) {
  return async (args: T): Promise<CallToolResult> => {
    try {
      const result = await fn(args)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, result }) }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true
      }
    }
  }
}

// Shared schema atoms reused across tool registrations
const inputPath = z.string().describe('Absolute path to input file')
const outputPath = z.string().describe('Absolute path to output file')
const outDir = z.string().describe('Absolute path to output directory')
const ranges = z.string().describe("Page range spec, e.g. '1-3,7' (1-based, inclusive)")

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'pdfx', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.tool(
    'pdfx_info',
    'Return metadata (page count, manifest, sha256) for a PDF or PDFX file',
    { inputPath },
    wrapTool(toolInfo)
  )

  server.tool(
    'pdfx_extract',
    'Extract text/image artifacts from a PDF or PDFX to a directory (returns ArtifactManifest)',
    {
      inputPath,
      outDir,
      ocr: z.boolean().optional().describe('Enable OCR for image-only pages (default true)'),
      dpi: z.number().int().positive().optional().describe('Render DPI for PNG output (default 150)')
    },
    wrapTool(toolExtract)
  )

  server.tool(
    'pdfx_split',
    'Split a PDFX bundle into its member PDFs, writing each to outDir',
    { inputPath, outDir },
    wrapTool(toolSplit)
  )

  server.tool(
    'pdfx_merge',
    'Merge PDFs/PDFX files (with optional per-input page ranges) into one PDF or PDFX bundle',
    {
      inputs: z
        .array(
          z.object({
            path: z.string().describe('Absolute path to an input file'),
            ranges: ranges.optional(),
            name: z.string().optional().describe('Document name in the PDFX manifest')
          })
        )
        .min(1)
        .describe('Input files to merge (at least one required)'),
      outputPath,
      kind: z.enum(['pdf', 'pdfx']).describe("Output format: 'pdf' for flat PDF, 'pdfx' for bundle")
    },
    wrapTool(toolMerge)
  )

  server.tool(
    'pdfx_pull',
    'Extract a page range from a PDF into a new PDF',
    { inputPath, ranges, outputPath },
    wrapTool(toolPull)
  )

  server.tool(
    'pdfx_delete',
    'Delete pages from a PDF',
    { inputPath, ranges, outputPath },
    wrapTool(toolDelete)
  )

  server.tool(
    'pdfx_rotate',
    'Rotate pages by 90, 180, or 270 degrees',
    {
      inputPath,
      degrees: z
        .union([z.literal(90), z.literal(180), z.literal(270)])
        .describe('Rotation angle in degrees (clockwise)'),
      ranges: ranges.optional(),
      outputPath
    },
    wrapTool(toolRotate)
  )

  server.tool(
    'pdfx_crop',
    'Crop pages to a bounding box (sets CropBox; MediaBox is preserved)',
    {
      inputPath,
      box: z.object({
        x: z.number().describe('Left edge in PDF points'),
        y: z.number().describe('Bottom edge in PDF points'),
        width: z.number().positive().describe('Box width in PDF points'),
        height: z.number().positive().describe('Box height in PDF points')
      }),
      ranges: ranges.optional(),
      outputPath
    },
    wrapTool(toolCrop)
  )

  server.tool(
    'pdfx_assets',
    'Extract embedded images, attachments, and font names to a directory',
    { inputPath, outDir },
    wrapTool(toolAssets)
  )

  // Phase IV verbs (pdfx_stamp, pdfx_flatten, pdfx_redact) are added once Phase IV lands.

  return server
}

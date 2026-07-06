<div align="center">

# PDFx

**One file. Many documents. Still a PDF.**

<br>

<a href="https://pub-2f99e567a5f04aefb5e8cb75acb90ef7.r2.dev/PDFx.zip">
  <img src="https://img.shields.io/badge/Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download" height="44">
</a>

<br>
<br>

[![License: MIT](https://img.shields.io/badge/License-MIT-2e7d32?style=flat-square)](LICENSE)
&nbsp;
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-555?style=flat-square)](#)
&nbsp;
[![Format spec](https://img.shields.io/badge/format-spec-e08a00?style=flat-square)](SPEC.md)

<br>

<img src="assets/pdfx.png" alt="PDFx viewer" width="820">

</div>

<br>

## What it is

PDFx is an open, backwards compatible extension of PDF that bundles many documents into a single file, plus a minimal desktop viewer for macOS, Windows, and Linux.

A `.pdfx` file is a fully valid PDF: open it anywhere and every page shows in sequence. Open it in PDFx and it splits back into the original documents. Plain single PDFs work as they are.

Drag and drop `.pdf` or `.pdfx` files anywhere in the window. Each document renders as a horizontal strip of pages, and documents stack vertically. Reorder or remove them, then **Export PDF** to save the whole collection as one file.

See [SPEC.md](SPEC.md) for the format. It is short: the entire trick is one embedded JSON manifest.

## How to run

Built with Electron, Vite, TypeScript, and React. PDF rendering by [pdf.js](https://mozilla.github.io/pdf.js/), assembly by [pdf-lib](https://pdf-lib.js.org/).

```bash
yarn              # install
yarn dev          # run in development
yarn build:mac    # package for macOS
yarn build:win    # package for Windows
yarn build:linux  # package for Linux
```

*Linux packaging notes (formats, Flatpak, prerequisites) live in [docs/LINUX_SETUP.md](docs/LINUX_SETUP.md).*

## MCP Server (Claude Code integration)

`packages/mcp` provides a stdio MCP server exposing nine `pdfx_*` tools that
import `@pdfx/core` directly (no shell-out). Register it in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "pdfx": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/packages/mcp/dist/index.js"]
    }
  }
}
```

Replace `<absolute-path-to-repo>` with the local checkout path, then build first:

```bash
yarn workspace @pdfx/mcp build
```

Available tools: `pdfx_info`, `pdfx_extract`, `pdfx_split`, `pdfx_merge`,
`pdfx_pull`, `pdfx_delete`, `pdfx_rotate`, `pdfx_crop`, `pdfx_assets`.

(`pdfx_stamp` / `pdfx_redact` MCP tools arrive in a later phase; both verbs are available in the CLI today. The CLI `flatten` verb is also available but `pdfx_flatten` is not yet exposed as an MCP tool.)

## CLI

`packages/cli` builds the `pdfx` binary (`yarn workspace @pdfx/cli build`).
Running bare `pdfx` prints the full usage. Verbs:

```
pdfx info <file.pdf|file.pdfx> [--json]
pdfx extract <file.pdf|file.pdfx> -o <outDir> [--format md,png] [--dpi 150] [--pages 1-3,5] [--lang eng] [--no-ocr] [--json]
pdfx extract --watch <dir> -o <outRoot>
pdfx split <file.pdfx> -o <outDir> [-f] [--json]
pdfx merge <input[#sel]>... -o <out.pdf|out.pdfx> [--kind pdf|pdfx] [-f] [--json]
pdfx pull <file> --pages <ranges> -o <out.pdf> [-f] [--json]
pdfx delete <file> --pages <ranges> -o <out.pdf> [-f] [--json]
pdfx rotate <file> --angle <deg> [--pages <ranges>] -o <out.pdf> [-f] [--json]
pdfx crop <file> --box x,y,w,h [--pages <ranges>] [--reset] -o <out.pdf> [-f] [--json]
pdfx assets <file> -o <outDir> [--json]
pdfx flatten <file.pdf> [-o <out.pdf>] [-f]
pdfx stamp <file.pdf> --image <png> --page <n> --at <x,y> --w <width> [-o <out.pdf>]
pdfx redact <file.pdf> (--find <text>|--regex <re>|--box <page:x,y,w,h>...) [--mode black|blur|rasterize] [-p <ranges>] [-o <out.pdf>]
```

### `pdfx redact`

- `--find <text>` — redact every occurrence of the literal string.
- `--regex <re>` — redact every match of the regular expression.
- `--box <page:x,y,w,h>` — redact an explicit rectangle on a page (1-based page number, PDF point units). Repeatable.
- `--mode black|blur|rasterize` — fill style; default `black`. `blur` applies a blur overlay (cosmetic only — the underlying text is still removed from the stream). `rasterize` converts affected pages to images: slower but robust against complex layouts.
- `-p / --pages <ranges>` — restrict `--find` / `--regex` matching to these pages (e.g. `1-3,5`). Does not apply to `--box` (each box already names its page).
- `-o <out.pdf>` — output path; defaults to `<input>.redacted.pdf` next to the input (`pdfx stamp` likewise defaults to `<input>.stamped.pdf`).

Complex layouts — multi-column text, dense character spacing, or non-standard encoding — often cause stream surgery to fail closed. If redaction exits with an error telling you to rasterize, re-run with `--mode rasterize`: it is the robust fallback and rasterizes only the affected pages.

## Signatures

`pdfx stamp` and the GUI signature pad add a **visual** signature — an image
stamp annotation (PDF `/Stamp`). This is NOT a cryptographic digital signature:
it does not create a `/Sig` field, does not sign the document with a certificate,
and provides no tamper-evidence or identity verification. Cryptographic signing
(PKCS#7, certificate chains) is deliberately out of scope and deferred
indefinitely. If you need a legally-binding digital signature, use a dedicated
signing tool.

## License

MIT

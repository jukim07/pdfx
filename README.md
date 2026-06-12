# PDFX

**One file. Many documents. Still a PDF.**

PDFX is an open, backwards-compatible extension of PDF for bundling multiple
documents into a single file — plus this minimal desktop viewer for macOS and
Windows.

- **Horizontal** — scroll through the pages of one document.
- **Vertical** — move between the documents of the collection.

A `.pdfx` file is a fully valid PDF: open it anywhere and you see all pages
sequentially. Open it in a PDFX viewer and it splits back into the original
documents. Plain single PDFs work as-is.

See [SPEC.md](SPEC.md) for the format specification (it's short — the whole
trick is one embedded JSON manifest).

## The viewer

- Drag & drop `.pdf` / `.pdfx` files anywhere in the window
- Each document renders as a horizontal strip of pages; documents stack vertically
- Reorder or remove documents, then **Export .pdfx** to save the collection as a single file
- Re-importing a `.pdfx` restores every document

## Development

Built with Electron, Vite, TypeScript, and React. PDF rendering by
[pdf.js](https://mozilla.github.io/pdf.js/), PDF assembly by
[pdf-lib](https://pdf-lib.js.org/).

```bash
yarn          # install
yarn dev      # run in development
yarn build:mac    # package for macOS
yarn build:win    # package for Windows
```

## License

MIT

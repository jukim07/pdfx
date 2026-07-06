import { resolve } from 'path'
import type { Plugin } from 'vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Node-only modules that appear in the @pdfx/core barrel (watermark.ts, redact.ts)
// but are NEVER called by the renderer — all heavy ops run in main over IPC.
// We cannot simply `external`-ize them here: Rollup would emit bare `import "zlib"`
// statements in the renderer bundle, which Electron's browser-context module loader
// cannot resolve (failed-to-resolve-specifier).
// Instead, provide empty-object virtual shims so tree-shaking eliminates dead code
// and no bare node-module import statement reaches the renderer's final output.
const NODE_ONLY_STUBS: string[] = ['zlib', 'fs', 'path', 'url', 'module', '@pdf-lib/fontkit']

function nodeStubPlugin(): Plugin {
  const PREFIX = '\0node-stub:'
  return {
    name: 'pdfx-node-stub',
    // 'pre' so this runs before Vite's own built-in node-compat resolver which
    // provides __vite-browser-external shims (those shims lack e.g. fileURLToPath).
    enforce: 'pre',
    resolveId(id: string) {
      if (NODE_ONLY_STUBS.includes(id)) return PREFIX + id
      return undefined
    },
    load(id: string) {
      if (!id.startsWith(PREFIX)) return undefined
      // Export a no-op function as default and re-export via a Proxy so any named
      // import resolves to undefined rather than a "not exported" Rollup error.
      // These modules are never called in the renderer; stubs satisfy the static
      // import graph without emitting bare node-module import statements.
      return [
        'const _noop = () => undefined',
        'const _proxy = new Proxy({}, { get: () => _noop })',
        'export default _proxy',
        'export const inflateSync = _noop',
        'export const deflateSync = _noop',
        'export const readFileSync = _noop',
        'export const join = _noop',
        'export const dirname = _noop',
        'export const fileURLToPath = _noop',
        'export const createRequire = _noop',
      ].join('\n')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@pdfx/core': resolve('packages/core/src/index.ts'),
        'tesseract.js': 'tesseract.js/dist/tesseract.esm.min.js'
      }
    },
    build: {
      rollupOptions: {
        // @napi-rs/canvas ships a native .node binary that cannot be bundled or
        // stubbed at module level — externalize it so Rollup drops the import edge.
        // All other Node-only modules are handled by nodeStubPlugin above, which
        // provides empty shims so no bare `import "zlib"` leaks into the renderer.
        external: ['@napi-rs/canvas']
      }
    },
    // Exclude @pdfx/core from Vite dep pre-bundling: it pulls in @napi-rs/canvas
    // (a native .node addon) and Node-only built-ins which Vite's esbuild-based
    // optimizeDeps scanner cannot handle. nodeStubPlugin handles the build;
    // this exclusion covers the dev-mode dep-scan path.
    optimizeDeps: {
      exclude: ['@pdfx/core', '@napi-rs/canvas', '@pdf-lib/fontkit']
    },
    worker: {
      format: 'es'
    },
    plugins: [nodeStubPlugin(), react()]
  }
})

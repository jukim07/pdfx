/**
 * Builds the macOS-only native glass addon (native/).
 *
 * No-op on other platforms so `install` / `postinstall` stays cross-platform —
 * the renderer and main process both degrade gracefully when the addon is
 * absent (see src/main/native/glass.ts).
 *
 * On macOS it produces a universal (arm64 + x86_64) binary so the addon loads
 * on Apple Silicon, Intel, and `electron-builder --universal` output alike. If
 * the cross-arch toolchain is unavailable, it falls back to a host-arch build
 * so installs never break.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

if (process.platform !== 'darwin') {
  console.log('[build-native] Skipping native glass addon (macOS only).')
  process.exit(0)
}

const nativeDir = fileURLToPath(new URL('../native/', import.meta.url))
const outAbs = join(nativeDir, 'build/Release/glass.node')

const gyp = (...args) => execFileSync('node-gyp', args, { cwd: nativeDir, stdio: 'inherit' })

try {
  // `node-gyp rebuild` wipes build/ each time, so stash each arch's slice in
  // the temp dir before building the next, then fuse them.
  const slices = ['arm64', 'x64'].map((arch) => {
    gyp('rebuild', `--arch=${arch}`)
    const slice = join(tmpdir(), `pdfx-glass-${arch}.node`)
    copyFileSync(outAbs, slice)
    return slice
  })
  execFileSync('lipo', ['-create', ...slices, '-output', outAbs], { stdio: 'inherit' })
  console.log('[build-native] Built universal glass addon (arm64 + x86_64).')
} catch (error) {
  console.warn(
    `[build-native] Universal build failed (${error.message}); falling back to host arch.`
  )
  gyp('rebuild')
}

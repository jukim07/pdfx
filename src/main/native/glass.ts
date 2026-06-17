/**
 * Native liquid-glass window backdrop for macOS.
 *
 * Thin wrapper over the custom Objective-C++ N-API addon in `native/`, which:
 *   1. Configures the NSWindow with an empty unified toolbar (→ rounded
 *      corners) and a transparent, clear-background titlebar.
 *   2. Layers an NSGlassEffectView / NSVisualEffectView behind the web
 *      contents so the window background is the system glass material.
 *
 * IMPORTANT: the BrowserWindow must NOT be frameless. `titleBarStyle: 'hidden'`
 * is required so Electron enables -webkit-app-region drag processing, and
 * `transparent: true` lets the native glass show through the web contents.
 */
import type { BrowserWindow } from 'electron'
import { join } from 'path'

const isMac = process.platform === 'darwin'

/** Solid window background for platforms without the native glass backdrop. */
export const FALLBACK_BG = { dark: '#1c1c1e', light: '#f7f7f5' }

/**
 * BrowserWindow options that make the window eligible for the native glass
 * backdrop. On macOS the window is transparent with a hidden title bar and
 * offset traffic lights so the native glass shows through; other platforms get
 * a solid background instead (set by the caller from the system theme).
 */
export const GLASS_CONFIG = isMac
  ? {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: { x: 20, y: 19 },
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: true
    }
  : {}

interface GlassAddon {
  applyGlass(handle: Buffer): void
  isGlassSupported(): boolean
}

function loadAddon(): GlassAddon | null {
  if (!isMac) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(join(__dirname, '../../native/build/Release/glass.node'))
  } catch (error) {
    // The backdrop is optional; surface why it didn't load (addon not built,
    // arch mismatch, …) rather than failing silently.
    console.warn('[glass] native addon unavailable:', error)
    return null
  }
}

/**
 * Apply the native liquid-glass backdrop to the window. No-op on non-macOS or
 * when the native addon is unavailable. Deferred to the first paint so the
 * window has a native handle and the web contents are ready to layer over.
 */
export function applyNativeGlass(win: BrowserWindow): void {
  if (!isMac) return

  const addon = loadAddon()
  if (!addon) return

  win.webContents.once('did-finish-load', () => {
    try {
      addon.applyGlass(win.getNativeWindowHandle())
    } catch {
      // Glass is purely cosmetic — never let it break window creation.
    }
  })
}

import { select } from 'd3-selection'
import { zoom as d3zoom, type ZoomBehavior, zoomIdentity, zoomTransform } from 'd3-zoom'
import { reversibleConstrain } from './constrain'
import { MIN_SCALE, MAX_SCALE } from './zoom-constants'

const SNAP_THRESHOLD = 0.08 // 8% of fit scale
const SNAP_DURATION_MS = 200

/** Pure predicate: is `currentK` within ±8% of `fitK`? */
export function isWithinSnapThreshold(currentK: number, fitK: number): boolean {
  return Math.abs(currentK - fitK) / fitK <= SNAP_THRESHOLD
}

/**
 * Returned by snapToFit so the caller can abort the animation.
 * Calling cancel() mid-flight stops the rAF loop without firing onComplete.
 */
export interface SnapHandle {
  cancel: () => void
}

export function snapToFit(
  vp: HTMLDivElement,
  zoom: ZoomBehavior<HTMLDivElement, unknown>,
  fitScale: number,
  fitX: number,
  fitY: number,
  onComplete?: () => void
): SnapHandle {
  const current = zoomTransform(vp)
  if (!isWithinSnapThreshold(current.k, fitScale)) {
    onComplete?.()
    return { cancel: () => {} }
  }

  const sel = select(vp)
  const start = performance.now()
  const from = { k: current.k, x: current.x, y: current.y }
  let rafId = 0
  let cancelled = false

  const tick = (): void => {
    if (cancelled) return
    const elapsed = performance.now() - start
    const progress = Math.min(elapsed / SNAP_DURATION_MS, 1)
    // ease-out cubic
    const t = 1 - Math.pow(1 - progress, 3)
    const interpolated = zoomIdentity
      .translate(from.x + (fitX - from.x) * t, from.y + (fitY - from.y) * t)
      .scale(from.k + (fitScale - from.k) * t)
    zoom.transform(sel, interpolated)
    if (progress < 1) {
      rafId = requestAnimationFrame(tick)
    } else {
      onComplete?.()
    }
  }
  rafId = requestAnimationFrame(tick)

  return {
    cancel: () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }
}

interface ZoomHandlerRefs {
  vp: HTMLDivElement
  worldRef: { current: HTMLDivElement | null }
  overlayRef: { current: HTMLDivElement | null }
  userMovedRef: { current: boolean }
  idleTimer: { current: ReturnType<typeof setTimeout> | null }
  lastTick: { current: number }
  onScaleRef: { current: ((scale: number) => void) | undefined }
  onSettleRef: { current: (() => void) | undefined }
  onSnapRef: { current: (() => { k: number; x: number; y: number } | null) }
}

export interface ZoomBehaviorResult {
  zoom: ZoomBehavior<HTMLDivElement, unknown>
  /** Cancel any in-flight snap animation. Safe to call when no snap is running. */
  cancelSnap: () => void
}

export function createZoomBehavior(refs: ZoomHandlerRefs): ZoomBehaviorResult {
  const {
    vp,
    worldRef,
    overlayRef,
    userMovedRef,
    idleTimer,
    lastTick,
    onScaleRef,
    onSettleRef,
    onSnapRef
  } = refs
  // Set to true while a snap animation rAF loop is running so the idle timer
  // (which is also reset by each programmatic zoom.transform call during snap)
  // does not re-enter snapToFit.
  let snapRunning = false
  // Handle returned by snapToFit; used to cancel a running snap when a new
  // user gesture arrives or the behavior is torn down.
  let snapHandle: SnapHandle | null = null

  const zoom = d3zoom<HTMLDivElement, unknown>()
    .scaleExtent([MIN_SCALE, MAX_SCALE])
    .constrain(reversibleConstrain)
    .filter((event) => {
      if (event.type === 'wheel') return false
      if ((event as MouseEvent).button) return false
      const target = event.target as Element | null
      return !target?.closest('.page, button, input, textarea, .doc-actions, .doc-header')
    })
    .on('start', () => vp.classList.add('panning'))
    .on('end', () => vp.classList.remove('panning'))
    .on('zoom', (event) => {
      // Cancel any running snap immediately when a real user gesture arrives.
      // Programmatic frames (sourceEvent === null, including the snap's own
      // rAF ticks) must NOT cancel — the snap's own frames are programmatic
      // and self-cancelling would abort the animation mid-flight.
      if (event.sourceEvent !== null && snapRunning) {
        snapHandle?.cancel()
        snapHandle = null
        snapRunning = false
      }
      if (event.sourceEvent) userMovedRef.current = true
      const t = event.transform
      const world = worldRef.current
      if (world) {
        world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
        world.style.willChange = 'transform'
      }
      const overlayEl = overlayRef.current
      if (overlayEl) {
        overlayEl.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
        overlayEl.style.setProperty('--k', String(t.k))
      }
      const now = performance.now()
      if (now - lastTick.current >= 90) {
        lastTick.current = now
        onScaleRef.current?.(t.k)
      }
      if (idleTimer.current) clearTimeout(idleTimer.current)
      const k = t.k
      // Only schedule snap when the triggering event is a real user gesture
      // (sourceEvent != null). Programmatic zoom calls (buttons, snap rAF) have
      // sourceEvent === null, so snap never re-fires itself or fights button zooms.
      const scheduleSnap = event.sourceEvent !== null
      idleTimer.current = setTimeout(() => {
        if (world) world.style.willChange = 'auto'
        onScaleRef.current?.(k)
        onSettleRef.current?.()
        if (scheduleSnap && !snapRunning) {
          const fitParams = onSnapRef.current?.()
          if (fitParams) {
            snapRunning = true
            snapHandle = snapToFit(vp, zoom, fitParams.k, fitParams.x, fitParams.y, () => {
              snapRunning = false
              snapHandle = null
            })
          }
        }
      }, 200)
    })
  const cancelSnap = (): void => {
    if (snapHandle) {
      snapHandle.cancel()
      snapHandle = null
      snapRunning = false
    }
  }

  return { zoom, cancelSnap }
}

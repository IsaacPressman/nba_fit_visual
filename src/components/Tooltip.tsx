/**
 * The hover readout. Tooltips enhance and never gate: everything they say is
 * also in the roster list, the breakdown rows and the table views, which is why
 * the readout is hidden from assistive tech rather than announced on every
 * pointer move.
 *
 * Its state lives in a tiny external store rather than in React state at the
 * top of the app, so following the pointer re-renders the tooltip alone and not
 * every board, chart and panel above it.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

export interface TipState {
  x: number
  y: number
  content: ReactNode
}

let current: TipState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const tooltip = {
  show(content: ReactNode, at?: { x: number; y: number }) {
    current = { x: at?.x ?? current?.x ?? 0, y: at?.y ?? current?.y ?? 0, content }
    emit()
  },
  /** Follow the pointer without rebuilding the content. */
  move(at: { x: number; y: number }) {
    if (!current || (current.x === at.x && current.y === at.y)) return
    current = { ...current, ...at }
    emit()
  },
  hide() {
    if (!current) return
    current = null
    emit()
  },
}

export type TooltipApi = typeof tooltip

export function useTooltip(): TooltipApi {
  return tooltip
}

export function Tooltip() {
  const tip = useSyncExternalStore(subscribe, () => current)

  // a readout pinned to where the pointer was is wrong the moment the page moves
  useEffect(() => {
    const off = () => tooltip.hide()
    window.addEventListener('scroll', off, { passive: true })
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('scroll', off)
      window.removeEventListener('blur', off)
    }
  }, [])

  if (!tip) return null
  const pad = 14
  const flipX = tip.x > window.innerWidth - 320
  const flipY = tip.y > window.innerHeight - 200
  return (
    <div
      className="tip"
      aria-hidden="true"
      style={{
        left: flipX ? undefined : tip.x + pad,
        right: flipX ? window.innerWidth - tip.x + pad : undefined,
        top: flipY ? undefined : tip.y + pad,
        bottom: flipY ? window.innerHeight - tip.y + pad : undefined,
      }}
    >
      {tip.content}
    </div>
  )
}

export { tooltip }

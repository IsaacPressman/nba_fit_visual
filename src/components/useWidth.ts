import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Rendered width of an element, tracked; 0 until the first measurement.
 *
 * Measured once synchronously before paint, so the first frame is already the
 * right shape, then kept current by a ResizeObserver — which only reports on
 * rendering frames, and so never fires at all in a background tab.
 */
export function useWidth<T extends Element>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

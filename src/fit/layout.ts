/**
 * Deterministic board layout, section 4.2.
 *
 * The prototype packed pieces with a randomized search, which invited three
 * misreadings: that neighbors matter, that a notch's paint comes from the piece
 * beside it, and that packing gaps are waste. Here the same rotation always
 * produces the same board, the biggest piece always lands in the same corner,
 * and the cells tile the board exactly — the only empty-looking thing on the
 * board is a stripe.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Cell extends Rect {
  id: string
  value: number
}

const worstRatio = (row: number[], length: number, scale: number) => {
  if (length <= 0) return Infinity
  const sum = row.reduce((a, b) => a + b, 0) * scale
  if (sum <= 0) return Infinity
  const side = sum / length
  let worst = 0
  for (const v of row) {
    const other = (v * scale) / side
    worst = Math.max(worst, Math.max(side / other, other / side))
  }
  return worst
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Items are laid out in the
 * order given — sort by load descending before calling, so the largest piece
 * always occupies the same corner.
 */
export function squarify(
  items: Array<{ id: string; value: number }>,
  frame: Rect,
): Cell[] {
  const live = items.filter((i) => i.value > 0)
  if (live.length === 0) return []

  const total = live.reduce((s, i) => s + i.value, 0)
  const area = frame.w * frame.h
  const scale = area / total

  const out: Cell[] = []
  let rect: Rect = { ...frame }
  let queue = [...live]

  while (queue.length > 0) {
    const row: typeof queue = []
    let shortest = Math.min(rect.w, rect.h)
    let best = Infinity

    while (queue.length > 0) {
      const candidate = [...row.map((r) => r.value), queue[0].value]
      const ratio = worstRatio(candidate, shortest, scale)
      if (row.length > 0 && ratio > best) break
      best = ratio
      row.push(queue.shift()!)
      shortest = Math.min(rect.w, rect.h)
    }

    const rowArea = row.reduce((s, i) => s + i.value, 0) * scale
    const horizontal = rect.w >= rect.h
    // the row runs along the shorter side; its thickness eats into the longer one
    const thickness = shortest > 0 ? rowArea / shortest : 0

    let offset = horizontal ? rect.y : rect.x
    for (const item of row) {
      const span = rowArea > 0 ? (item.value * scale) / thickness : 0
      out.push(
        horizontal
          ? { id: item.id, value: item.value, x: rect.x, y: offset, w: thickness, h: span }
          : { id: item.id, value: item.value, x: offset, y: rect.y, w: span, h: thickness },
      )
      offset += span
    }

    rect = horizontal
      ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
      : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness }

    queue = queue.filter((i) => !row.includes(i))
    if (rect.w <= 0.01 || rect.h <= 0.01) break
  }

  return out
}

/**
 * Exploded layout: true squares, side proportional to sqrt(load) so area still
 * reads as possession share, laid out in a grid on a common scale. This is where
 * a single player's shape is legible on its own.
 */
export function explode(
  items: Array<{ id: string; value: number }>,
  frame: Rect,
  columns = 4,
): Cell[] {
  if (items.length === 0) return []
  const rows = Math.ceil(items.length / columns)
  const cellW = frame.w / columns
  const cellH = frame.h / rows
  const maxValue = Math.max(...items.map((i) => i.value))
  // the largest piece fills 82% of its grid cell; the rest scale against it
  const maxSide = Math.min(cellW, cellH) * 0.82

  return items.map((item, i) => {
    const side = maxSide * Math.sqrt(item.value / maxValue)
    const col = i % columns
    const row = Math.floor(i / columns)
    return {
      id: item.id,
      value: item.value,
      x: frame.x + col * cellW + (cellW - side) / 2,
      y: frame.y + row * cellH + (cellH - side) / 2,
      w: side,
      h: side,
    }
  })
}

export const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
})

/** Ease used by the one orchestrated moment in the app, the assembly. */
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

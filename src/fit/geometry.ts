/**
 * Piece geometry, section 4.1. A cell and each notch's share of the piece in,
 * an outline path and one rectangle per notch out. Nothing here knows about
 * color or coverage.
 *
 *              S        I                 S  shooting          (top edge)
 *          ┌──┐ ┌────┐ ┌──┐               I  interior          (top edge)
 *          │  └─┘    └─┘  │               C  needs a creator   (left edge)
 *        C ┌┐             │               D  perimeter D       (left edge)
 *          └┘            ┌┤ B             B  ball dominance    (right edge)
 *        D ┌┐            └┤
 *          └┘             │
 *          └──────────────┘
 *
 * Every notch is a cut, and its area is exactly its share of the piece: the
 * model's charge for that player and channel over his load. So the notches on
 * a board are the model's demand drawn to scale, the striped part of them is
 * the model's waste drawn to scale, and the striped share of the board is the
 * exposure figure beside it — not an approximation of it.
 *
 * Depth runs as a fraction of the dimension it cuts into (height for a top
 * notch, width for a side one), so a notch keeps its area on a stretched cell
 * as well as a square one.
 */
import type { Rect } from './layout'

export type Edge = 'top' | 'left' | 'right'
export type SlotId = 'shooting' | 'interior' | 'noCreator' | 'perimeterD' | 'ball'
/** kept for callers that only mean the four cuts that are not ball dominance */
export type NotchId = Exclude<SlotId, 'ball'>

export interface SlotRect extends Rect {
  id: SlotId
  edge: Edge
  /** the notch's area as a fraction of the piece */
  frac: number
  /** the axis coverage paint travels along, from the edge inward */
  inward: 'down' | 'right' | 'left'
  letter: string
}

/** Preferred centre of each slot along its edge, as a fraction of that edge. */
const CENTRES: Record<SlotId, number> = {
  shooting: 0.3,
  interior: 0.7,
  noCreator: 0.45,
  perimeterD: 0.8,
  ball: 0.6,
}

const EDGE_OF: Record<SlotId, Edge> = {
  shooting: 'top',
  interior: 'top',
  noCreator: 'left',
  perimeterD: 'left',
  ball: 'right',
}

const INWARD: Record<Edge, SlotRect['inward']> = { top: 'down', left: 'right', right: 'left' }

/** Deepest a notch cuts before it widens instead, as a fraction of the piece. */
const MAX_DEPTH = 0.46
/** Hard ceiling, used only when an edge is too crowded to widen into. */
const CEILING = 0.9
/** Gap between neighbouring notches, as a fraction of the edge. */
const GAP = 0.02

export const SLOT_LETTER: Record<SlotId, string> = {
  shooting: 'S',
  interior: 'I',
  perimeterD: 'D',
  noCreator: 'C',
  ball: 'B',
}

export const SLOT_LABEL: Record<SlotId, string> = {
  shooting: 'Shooting',
  interior: 'Interior',
  perimeterD: 'Perimeter D',
  noCreator: 'Needs a creator',
  ball: 'Ball dominance',
}

interface Span {
  id: SlotId
  start: number
  width: number
  depth: number
}

/**
 * Lay a set of notches along one edge of length `len`, cutting into a
 * perpendicular of `perp`, inside the free interval [from, len]. Each notch
 * wants `slot` of the edge at its preferred centre; if that would cut deeper
 * than MAX_DEPTH it widens instead, and if the edge is too crowded to widen, the
 * widths shrink to fit and the depth takes up the rest. Area is kept exact
 * unless the CEILING is reached, which does not happen on the league's data.
 */
function packEdge(
  wants: Array<{ id: SlotId; area: number }>,
  len: number,
  perp: number,
  slot: number,
  from = 0,
): Span[] {
  if (wants.length === 0) return []
  const gap = GAP * len
  const items = wants
    .map((w) => {
      let width = slot * len
      if (w.area / width > MAX_DEPTH * perp) width = w.area / (MAX_DEPTH * perp)
      return { ...w, width, centre: CENTRES[w.id] * len }
    })
    .sort((a, b) => a.centre - b.centre)

  // shrink to fit the free interval if the edge is crowded
  const room = len - from - gap * (items.length + 1)
  const total = items.reduce((s, i) => s + i.width, 0)
  if (total > room) {
    const k = room / total
    for (const i of items) i.width *= k
  }

  // place at the preferred centres, then push down any that overlap or spill
  const out: Span[] = []
  let cursor = from + gap
  for (const i of items) {
    const start = Math.max(cursor, i.centre - i.width / 2)
    out.push({ id: i.id, start, width: i.width, depth: 0 })
    cursor = start + i.width + gap
  }
  // anything past the end slides back, keeping order
  let limit = len - gap
  for (let j = out.length - 1; j >= 0; j--) {
    if (out[j].start + out[j].width > limit) out[j].start = limit - out[j].width
    limit = out[j].start - gap
  }

  for (const s of out) {
    const area = items.find((i) => i.id === s.id)!.area
    s.depth = Math.min(area / s.width, CEILING * perp)
  }
  return out
}

/**
 * Slot rectangles for one piece. `fracs` is each notch's area as a fraction of
 * the piece — the model's charge over the player's load — and `slot` the
 * preferred notch width as a fraction of its edge.
 */
export function slotRects(
  fracs: Partial<Record<SlotId, number>>,
  cell: Rect,
  slot: number,
): SlotRect[] {
  const area = cell.w * cell.h
  const on = (edge: Edge) =>
    (Object.keys(EDGE_OF) as SlotId[])
      .filter((id) => EDGE_OF[id] === edge && (fracs[id] ?? 0) > 0.0005)
      .map((id) => ({ id, area: (fracs[id] ?? 0) * area }))

  const top = packEdge(on('top'), cell.w, cell.h, slot)

  // A side notch that reaches past where a top notch begins would collide
  // with it in the corner; if so, the side edge starts below that top notch.
  const clearOf = (edge: 'left' | 'right') => {
    const wants = on(edge)
    let spans = packEdge(wants, cell.h, cell.w, slot)
    const collides = spans.some((s) =>
      top.some((t) => {
        const tx0 = edge === 'left' ? t.start : cell.w - (t.start + t.width)
        return s.depth > tx0 && s.start < t.depth
      }),
    )
    if (collides) {
      const below = Math.max(...top.map((t) => t.depth))
      spans = packEdge(wants, cell.h, cell.w, slot, Math.min(below, cell.h * 0.5))
    }
    return spans
  }

  const out: SlotRect[] = []
  const push = (edge: Edge, s: Span) => {
    const rect: Rect =
      edge === 'top'
        ? { x: cell.x + s.start, y: cell.y, w: s.width, h: s.depth }
        : edge === 'left'
          ? { x: cell.x, y: cell.y + s.start, w: s.depth, h: s.width }
          : { x: cell.x + cell.w - s.depth, y: cell.y + s.start, w: s.depth, h: s.width }
    out.push({
      ...rect,
      id: s.id,
      edge,
      frac: fracs[s.id] ?? 0,
      inward: INWARD[edge],
      letter: SLOT_LETTER[s.id],
    })
  }
  for (const s of top) push('top', s)
  for (const s of clearOf('left')) push('left', s)
  for (const s of clearOf('right')) push('right', s)
  return out
}

/** Rect -> SVG rect attributes. A Rect carries w/h; <rect> needs width/height. */
export const box = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

/** The piece outline, clockwise from the top-left corner: every notch bites inward. */
export function outlinePath(slots: SlotRect[], cell: Rect): string {
  const { x, y, w, h } = cell
  const pts: Array<[number, number]> = []
  const to = (px: number, py: number) => pts.push([px, py])

  const on = (edge: Edge) =>
    slots
      .filter((s) => s.edge === edge)
      .sort((a, b) => (edge === 'top' ? a.x - b.x : a.y - b.y))

  to(x, y)

  // top edge, left to right: each notch drops in and climbs back out
  for (const s of on('top')) {
    to(s.x, y)
    to(s.x, y + s.h)
    to(s.x + s.w, y + s.h)
    to(s.x + s.w, y)
  }
  to(x + w, y)

  // right edge, top to bottom: each notch bites leftward
  for (const s of on('right')) {
    to(x + w, s.y)
    to(s.x, s.y)
    to(s.x, s.y + s.h)
    to(x + w, s.y + s.h)
  }
  to(x + w, y + h)
  to(x, y + h)

  // left edge, bottom to top: notches bite rightward, so walk them in reverse
  for (const s of on('left').reverse()) {
    to(x, s.y + s.h)
    to(x + s.w, s.y + s.h)
    to(x + s.w, s.y)
    to(x, s.y)
  }

  return `M ${pts.map(([px, py]) => `${fmt(px)} ${fmt(py)}`).join(' L ')} Z`
}

/**
 * Split a notch into three parts, from its edge inward: the part teammates
 * cover (painted in their colors), the part paid back elsewhere (interior's
 * spacing credit, drawn but not striped), and the rest, which nobody covers
 * (striped). `fill` is the pooled coverage and `credit` the share of the
 * uncovered part that is paid back, both 0–1.
 */
export function coverageBands(slot: SlotRect, fill: number, credit = 0) {
  const f = Math.max(0, Math.min(1, fill))
  const c = (1 - f) * Math.max(0, Math.min(1, credit))
  const wst = 1 - f - c
  switch (slot.inward) {
    case 'down':
      return {
        covered: { ...slot, h: slot.h * f },
        credited: { ...slot, y: slot.y + slot.h * f, h: slot.h * c },
        waste: { ...slot, y: slot.y + slot.h * (f + c), h: slot.h * wst },
      }
    case 'right':
      return {
        covered: { ...slot, w: slot.w * f },
        credited: { ...slot, x: slot.x + slot.w * f, w: slot.w * c },
        waste: { ...slot, x: slot.x + slot.w * (f + c), w: slot.w * wst },
      }
    case 'left':
      // a right-edge notch: its edge is on the right, so paint leftward from it
      return {
        covered: { ...slot, x: slot.x + slot.w * (1 - f), w: slot.w * f },
        credited: { ...slot, x: slot.x + slot.w * wst, w: slot.w * c },
        waste: { ...slot, w: slot.w * wst },
      }
  }
}

/**
 * Divide a covered band into one stripe per supplier, side by side along the
 * slot, in share order. Splitting across the slot rather than through its depth
 * keeps each supplier's stripe wide enough to letter.
 */
export function supplierBands(
  band: Rect,
  suppliers: Array<{ id: string; share: number }>,
  slot: SlotRect,
): Array<Rect & { id: string; share: number }> {
  if (suppliers.length === 0) return []
  const acrossX = slot.edge !== 'top'
  let offset = 0
  return suppliers.map((s) => {
    const span = (acrossX ? band.h : band.w) * s.share
    const rect = acrossX
      ? { x: band.x, y: band.y + offset, w: band.w, h: span }
      : { x: band.x + offset, y: band.y, w: span, h: band.h }
    offset += span
    return { ...rect, id: s.id, share: s.share }
  })
}

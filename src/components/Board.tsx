/**
 * The team board, sections 4.2 and 5.2.
 *
 * Two layouts, one animation between them. Exploded, the eight pieces are true
 * squares laid out separately with their notches open — the place to read one
 * player's shape. Assembled, they tile a deterministic squarified treemap and
 * the notches fill with teammates' colors. The transition is the whole premise
 * in one move.
 *
 * Notches are drawn at exactly their share of the piece (highlight.slotFracs),
 * measured against each piece's area before the seam is taken out of it, so the
 * striped area of an assembled board is the exposure figure to scale.
 *
 * The one other motion is a swap: pieces are keyed by seat, so when a player
 * is replaced his piece shrinks away and the newcomer grows into the seat,
 * while everyone else glides to their new cell and every notch eases from its
 * old coverage to its new one.
 *
 * A projected season can also seat ghosts: lottery rookies with no NBA data,
 * sized by the typical role for their pick and drawn as an empty dashed piece.
 * They take their share of the board and nothing else — no notches, no paint,
 * no part of any score.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { slotFracs, type Focus } from '../fit/highlight'
import { easeInOutCubic, explode, lerpRect, squarify, type Rect } from '../fit/layout'
import { channel } from '../fit/model'
import type { SlotMap } from '../fit/palette'
import type { SlotId } from '../fit/geometry'
import type { Channel, Ghost, Rules, Shape, Supplier, TeamFit } from '../fit/types'
import { Piece, type Detail } from './Piece'
import { useWidth } from './useWidth'

/**
 * Two board shapes. Wide on a desktop; on a phone the same 1000-unit board
 * would render at a third of its size, so a narrow container gets a taller
 * board with two exploded columns instead of four, and pieces keep their size.
 */
const WIDE = { w: 1000, h: 600, columns: 4 }
const TALL = { w: 600, h: 820, columns: 2 }
const NARROW_PX = 640
/** Uniform mat seam between pieces. */
const SEAM_FRACTION = 0.026
const MORPH_MS = 900

export type Assembly = 'exploded' | 'assembled'

/** Minutes two players shared the floor; undefined when there is no data. */
export type Overlap = (a: string, b: string) => number | undefined

interface BoardProps {
  fit: TeamFit
  rules: Rules
  slots: SlotMap
  mode: 'light' | 'dark'
  assembly: Assembly
  focus: Focus
  textured?: boolean
  detail?: Detail
  dropTarget?: string | null
  selected?: string | null
  /** 'auto' picks the tall board below NARROW_PX; 'wide' always keeps 4 columns */
  layout?: 'auto' | 'wide'
  /** shared minutes, so each notch is painted by who actually plays beside him */
  overlap?: Overlap
  /** unscored rookies holding a rotation seat (projected seasons) */
  ghosts?: Ghost[]
  onHoverPlayer?: (id: string | null, at?: { x: number; y: number }) => void
  onHoverChannel?: (c: Channel | null, at?: { x: number; y: number }) => void
  onPickPlayer?: (id: string) => void
  onDropOnPlayer?: (id: string) => void
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Animate a number from 0 to 1 whenever `key` changes; 1 when idle. */
function useTween(key: unknown, ms: number, enabled: boolean) {
  const [p, setP] = useState(1)
  const first = useRef(true)
  const raf = useRef(0)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!enabled || reducedMotion()) {
      setP(1)
      return
    }
    const start = performance.now()
    const run = (now: number) => {
      const q = Math.min(1, (now - start) / ms)
      setP(q)
      if (q < 1) raf.current = requestAnimationFrame(run)
    }
    setP(0)
    raf.current = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return p
}

function useAssembly(target: Assembly) {
  const [t, setT] = useState(target === 'assembled' ? 1 : 0)
  const raf = useRef(0)

  useEffect(() => {
    const to = target === 'assembled' ? 1 : 0
    if (reducedMotion()) {
      setT(to)
      return
    }
    const from = t
    if (from === to) return
    const start = performance.now()
    const run = (now: number) => {
      const p = Math.min(1, (now - start) / 820)
      setT(from + (to - from) * easeInOutCubic(p))
      if (p < 1) raf.current = requestAnimationFrame(run)
    }
    raf.current = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf.current)
    // t is intentionally read once, as the animation's starting point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return t
}

/**
 * Who paints one player's notch on a channel. Pooled coverage says how full
 * the notch is; shared minutes say whose colors fill it — a teammate who is
 * rarely on the floor with him contributes little to his notch, however much
 * he supplies the team. Without overlap data, the pooled shares stand.
 */
export function notchSuppliers(
  fit: TeamFit,
  c: Channel,
  pieceId: string,
  overlap?: Overlap,
): Supplier[] {
  const pooled = channel(fit, c).suppliers.filter((s) => s.id !== pieceId)
  if (!overlap || pooled.length === 0) return pooled
  // A pooled share already carries the supplier's minutes (it goes by load),
  // so take them back out before weighting by the minutes he shares with this
  // player — otherwise playing time would count twice.
  const mpg = (id: string) => fit.shapes.find((s) => s.player.id === id)?.player.mpg ?? 0
  const weighted = pooled.map((s) => ({
    id: s.id,
    w: (s.share / Math.max(1, mpg(s.id))) * (overlap(pieceId, s.id) ?? NaN),
  }))
  if (weighted.some((x) => Number.isNaN(x.w))) return pooled
  const total = weighted.reduce((a, x) => a + x.w, 0)
  if (total <= 0) return pooled
  return weighted
    .filter((x) => x.w > 0)
    .map((x) => ({ id: x.id, share: x.w / total }))
    .sort((a, b) => b.share - a.share)
}

const area = (r: Rect) => r.w * r.h
const shrink = (r: Rect, k: number): Rect => ({
  x: r.x + (r.w * (1 - k)) / 2,
  y: r.y + (r.h * (1 - k)) / 2,
  w: Math.max(0.5, r.w * k),
  h: Math.max(0.5, r.h * k),
})
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const ghostId = (g: Ghost) => `ghost:${g.name}`

function layoutOf(fit: TeamFit, frame: Rect, columns: number, ghosts: Ghost[] = []) {
  const items = [
    ...fit.shapes.map((s) => ({ id: s.player.id, value: s.player.load })),
    ...ghosts.map((g) => ({ id: ghostId(g), value: g.load })),
  ].sort((a, b) => b.value - a.value)
  return {
    assembled: new Map(squarify(items, frame).map((c) => [c.id, c as Rect])),
    exploded: new Map(explode(items, frame, columns).map((c) => [c.id, c as Rect])),
  }
}

export function Board({
  fit,
  rules,
  slots,
  mode,
  assembly,
  focus,
  textured = false,
  detail = 'full',
  dropTarget = null,
  selected = null,
  layout = 'auto',
  overlap,
  ghosts = [],
  onHoverPlayer,
  onHoverChannel,
  onPickPlayer,
  onDropOnPlayer,
}: BoardProps) {
  const t = useAssembly(assembly)
  const [ref, width] = useWidth<SVGSVGElement>()
  const VIEW = layout === 'auto' && width > 0 && width < NARROW_PX ? TALL : WIDE
  // board units per CSS pixel; 1 until the first measurement lands
  const unit = width > 0 ? VIEW.w / width : 1

  const seam = Math.min(VIEW.w, VIEW.h) * SEAM_FRACTION
  const frame: Rect = { x: seam / 2, y: seam / 2, w: VIEW.w - seam, h: VIEW.h - seam }

  const cells = useMemo(
    () => layoutOf(fit, frame, VIEW.columns, ghosts),
    // frame is derived from VIEW, so VIEW stands in for it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, VIEW, ghosts],
  )

  // A swap changes who is in the rotation; a rules change does not. Only the
  // first is animated, and only once the board is assembled.
  const roster = fit.shapes.map((s) => s.player.id).sort().join('|')
  type Snapshot = { roster: string; fit: TeamFit; cells: typeof cells; seatOf: (id: string) => number }
  const prev = useRef<Snapshot | undefined>(undefined)
  const from = useRef<Snapshot | undefined>(undefined)
  if (prev.current && prev.current.roster !== roster) from.current = prev.current
  const m = useTween(roster, MORPH_MS, t >= 1)
  const morphing = m < 1 && from.current !== undefined && t >= 1
  useEffect(() => {
    prev.current = { roster, fit, cells, seatOf: (id) => slots.slot(id) }
  })

  const inset = (r: Rect): Rect => ({
    x: r.x + seam / 2,
    y: r.y + seam / 2,
    w: Math.max(1, r.w - seam),
    h: Math.max(1, r.h - seam),
  })

  /** Notch fractions against the drawn cell, so stripes stay exact after the seam. */
  const scaled = (fracs: Partial<Record<SlotId, number>>, ideal: number, drawn: Rect) => {
    const k = ideal / Math.max(1e-6, area(drawn))
    const out: Partial<Record<SlotId, number>> = {}
    for (const [s, f] of Object.entries(fracs)) out[s as SlotId] = (f ?? 0) * k
    return out
  }

  interface Item {
    key: string
    shape: Shape
    id: string
    cell: Rect
    fracs: Partial<Record<SlotId, number>>
    fillOf: (c: Channel) => number
    creditOf: (c: Channel) => number
    suppliersOf: (c: Channel, pieceId: string) => Supplier[]
    interactive: boolean
    /** a seat keeps its color through a swap, so the newcomer takes it over */
    color: string
  }

  const items: Item[] = []
  const ordered = [...fit.shapes].sort((a, b) => b.player.load - a.player.load)
  const eased = easeInOutCubic(m)

  for (const shape of ordered) {
    const id = shape.player.id
    const seatKey = slots.has(id) ? `seat-${slots.slot(id)}` : `player-${id}`
    const a = cells.exploded.get(id)!
    const b = cells.assembled.get(id)!
    let cell = lerpRect(a, inset(b), t)
    let ideal = lerp(area(a), area(b), t)
    let fracs = slotFracs(fit, id)
    let fillOf = (c: Channel) => channel(fit, c).fill
    let creditOf = (c: Channel) => channel(fit, c).credit
    let itemFit = fit
    let itemShape = shape
    let itemId = id

    if (morphing && from.current) {
      const old = from.current
      const oldId = old.fit.shapes.find((s) => old.seatOf(s.player.id) === slots.slot(id))?.player.id
      const oldB = oldId ? old.cells.assembled.get(oldId) : undefined
      if (oldId === id && oldB) {
        // stayed: glide to the new cell, and ease every notch to its new state
        cell = lerpRect(inset(oldB), inset(b), eased)
        ideal = lerp(area(oldB), area(b), eased)
        const f0 = slotFracs(old.fit, id)
        const f1 = fracs
        fracs = {}
        for (const s of new Set([...Object.keys(f0), ...Object.keys(f1)]) as Set<SlotId>) {
          fracs[s] = lerp(f0[s] ?? 0, f1[s] ?? 0, eased)
        }
        fillOf = (c) => lerp(channel(old.fit, c).fill, channel(fit, c).fill, eased)
        creditOf = (c) => lerp(channel(old.fit, c).credit, channel(fit, c).credit, eased)
      } else if (oldId && oldB) {
        // swapped: the old piece shrinks away, then the new one grows in
        if (m < 0.5) {
          const k = 1 - easeInOutCubic(m / 0.5)
          const oldShape = old.fit.shapes.find((s) => s.player.id === oldId)!
          cell = shrink(inset(oldB), k)
          ideal = area(oldB) * k * k
          fracs = slotFracs(old.fit, oldId)
          fillOf = (c) => channel(old.fit, c).fill
          creditOf = (c) => channel(old.fit, c).credit
          itemFit = old.fit
          itemShape = oldShape
          itemId = oldId
        } else {
          const k = easeInOutCubic((m - 0.5) / 0.5)
          cell = shrink(inset(b), k)
          ideal = area(b) * k * k
        }
      }
    }

    const drawnFit = itemFit
    items.push({
      key: seatKey,
      shape: itemShape,
      id: itemId,
      cell,
      fracs: scaled(fracs, ideal, cell),
      fillOf,
      creditOf,
      suppliersOf: (c, pid) => notchSuppliers(drawnFit, c, pid, overlap),
      interactive: itemId === id,
      color: slots.color(id, mode),
    })
  }

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label={boardLabel(fit, ghosts)}
    >
      {ghosts.map((g) => {
        const a = cells.exploded.get(ghostId(g))
        const b = cells.assembled.get(ghostId(g))
        if (!a || !b) return null
        return <GhostPiece key={ghostId(g)} ghost={g} cell={lerpRect(a, inset(b), t)} unit={unit} />
      })}
      {items.map((it) => (
        // Drag events bubble up from the piece to this group, so dropping
        // needs no overlay. An invisible rect laid over the piece used to do
        // this job, and it swallowed every click and hover on the body.
        <g
          key={it.key}
          onDragOver={
            onDropOnPlayer && it.interactive
              ? (e) => {
                  e.preventDefault()
                  onHoverPlayer?.(it.id)
                }
              : undefined
          }
          onDrop={
            onDropOnPlayer && it.interactive
              ? (e) => {
                  e.preventDefault()
                  onDropOnPlayer(it.id)
                }
              : undefined
          }
        >
          <Piece
            shape={it.shape}
            cell={it.cell}
            slot={rules.slot}
            fracs={it.fracs}
            color={it.color}
            colorOf={(pid) => slots.color(pid, mode)}
            fillOf={it.fillOf}
            creditOf={it.creditOf}
            suppliersOf={it.suppliersOf}
            detail={detail}
            paint={t}
            focus={morphing ? undefined : focus}
            textured={textured}
            unit={unit}
            selected={selected === it.id}
            onEnterPlayer={
              onHoverPlayer && it.interactive ? (pid, pt) => onHoverPlayer(pid, pt) : undefined
            }
            onEnterSlot={
              onHoverChannel && it.interactive ? (c, pt) => onHoverChannel(c, pt) : undefined
            }
            onLeave={() => {
              onHoverPlayer?.(null)
              onHoverChannel?.(null)
            }}
            onPick={it.interactive ? onPickPlayer : undefined}
          />
          {dropTarget === it.id && (
            <rect
              className="drop-target"
              x={it.cell.x - 2}
              y={it.cell.y - 2}
              width={it.cell.w + 4}
              height={it.cell.h + 4}
            />
          )}
        </g>
      ))}
    </svg>
  )
}

function boardLabel(fit: TeamFit, ghosts: Ghost[] = []) {
  const parts = fit.shapes
    .slice()
    .sort((a, b) => b.player.load - a.player.load)
    .map((s) => `${s.player.name} ${s.player.load.toFixed(1)}%`)
  const rookies = ghosts.length
    ? ` Rookies holding a seat, not scored: ${ghosts
        .map((g) => `${g.name} (No. ${g.pick} pick)`)
        .join(', ')}.`
    : ''
  return `${fit.team.name} rotation board. Exposure ${fit.wastedFitPct.toFixed(
    1,
  )}%. Possession share: ${parts.join(', ')}.${rookies}`
}

/**
 * A rookie holding a seat: the space his role takes, and nothing more. A dashed
 * outline on the mat, no fill, no notches — the board says a piece belongs here
 * and that it cannot yet say what shape it is.
 */
function GhostPiece({
  ghost,
  cell,
  unit = 1,
  detail = 'full',
}: {
  ghost: Ghost
  cell: Rect
  unit?: number
  detail?: Detail
}) {
  const wPx = cell.w / unit
  const hPx = cell.h / unit
  const namePx = Math.max(11, Math.min(15, Math.min(wPx, hPx) * 0.15))
  const last = ghost.name.replace(/\s+(Jr\.|Sr\.|II|III|IV)$/i, '').split(/\s+/).pop() ?? ghost.name
  const fits = last.length * namePx * 0.52 <= wPx * 0.86 && hPx >= namePx * 3.4
  return (
    <g className="ghost-piece">
      <title>
        {`${ghost.name}, No. ${ghost.pick} pick. A rookie, not scored: his seat is sized by the typical rookie year of picks ${ghost.range} (${ghost.mpg} minutes, ${ghost.usg.toFixed(1)} usage).`}
      </title>
      <rect
        className={detail === 'full' ? 'ghost-outline' : 'ghost-outline bare'}
        x={cell.x}
        y={cell.y}
        width={cell.w}
        height={cell.h}
      />
      {detail === 'full' && fits && (
        <>
          <text
            className="ghost-name"
            x={cell.x + cell.w / 2}
            y={cell.y + cell.h / 2 - namePx * 0.4 * unit}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={namePx * unit}
          >
            {last}
          </text>
          <text
            className="ghost-note"
            x={cell.x + cell.w / 2}
            y={cell.y + cell.h / 2 + namePx * 0.8 * unit}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={namePx * 0.72 * unit}
          >
            No. {ghost.pick} pick · not scored
          </text>
        </>
      )}
    </g>
  )
}

/**
 * The league-grid tile, section 4.3: one common scale across all 30, so a team
 * whose top eight cover 88% of possessions draws a visibly smaller board than
 * one covering 100%. Supplier splits and labels are dropped; piece size and
 * striped waste stay, the stripes at exactly their share as on the full board.
 */
export function Tile({
  fit,
  rules,
  maxLoad,
  size = 240,
  color = 'var(--tile-piece)',
  ghosts = [],
}: {
  fit: TeamFit
  rules: Rules
  /** the largest board's load, ghosts included, so every tile shares a scale */
  maxLoad: number
  size?: number
  /** one neutral tone by default: team colors fought the stripes */
  color?: string
  ghosts?: Ghost[]
}) {
  const ghostLoad = ghosts.reduce((a, g) => a + g.load, 0)
  const side = size * Math.sqrt((fit.totalLoad + ghostLoad) / maxLoad)
  const pad = (size - side) / 2
  const seam = size * 0.014
  const frame: Rect = { x: pad, y: pad, w: side, h: side }

  const cells = useMemo(() => {
    const items = [
      ...fit.shapes.map((s) => ({ id: s.player.id, value: s.player.load })),
      ...ghosts.map((g) => ({ id: ghostId(g), value: g.load })),
    ].sort((a, b) => b.value - a.value)
    return new Map(squarify(items, frame).map((c) => [c.id, c]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, side, ghosts])

  const solid = () => color

  return (
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {ghosts.map((g) => {
        const c = cells.get(ghostId(g))
        if (!c) return null
        const drawn = {
          x: c.x + seam / 2,
          y: c.y + seam / 2,
          w: Math.max(1, c.w - seam),
          h: Math.max(1, c.h - seam),
        }
        return <GhostPiece key={ghostId(g)} ghost={g} cell={drawn} detail="simple" />
      })}
      {fit.shapes.map((shape) => {
        const c = cells.get(shape.player.id)
        if (!c) return null
        const drawn = {
          x: c.x + seam / 2,
          y: c.y + seam / 2,
          w: Math.max(1, c.w - seam),
          h: Math.max(1, c.h - seam),
        }
        const k = area(c) / area(drawn)
        const fracs: Partial<Record<SlotId, number>> = {}
        for (const [s, f] of Object.entries(slotFracs(fit, shape.player.id))) {
          fracs[s as SlotId] = (f ?? 0) * k
        }
        return (
          <Piece
            key={shape.player.id}
            shape={shape}
            cell={drawn}
            slot={rules.slot}
            fracs={fracs}
            color={color}
            colorOf={solid}
            fillOf={(ch) => channel(fit, ch).fill}
            creditOf={(ch) => channel(fit, ch).credit}
            suppliersOf={() => []}
            detail="simple"
            hatch="waste-hatch-accent"
          />
        )
      })}
    </svg>
  )
}

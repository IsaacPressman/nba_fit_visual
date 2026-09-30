/**
 * One player, one piece. Section 4.1.
 *
 * The outline is cut by what the team is charged for him, each notch drawn at
 * exactly its share of the piece. From the edge inward, each notch shows the
 * part teammates cover (in their colors, split by their share), then any part
 * paid back elsewhere (interior's spacing credit, dotted), then whatever nobody
 * covers (striped). Strengths never appear on the piece that has them — they
 * show up inside the notches they repair.
 */
import { Fragment } from 'react'
import {
  box,
  coverageBands,
  outlinePath,
  slotRects,
  supplierBands,
  type SlotId,
  type SlotRect,
} from '../fit/geometry'
import { bandLit, CHANNEL_SLOT, slotLit, type Focus } from '../fit/highlight'
import type { Rect } from '../fit/layout'
import { initials, inkOn, surname, textureId } from '../fit/palette'
import { CHANNELS, type Channel, type Shape, type Supplier } from '../fit/types'

export type Detail = 'full' | 'simple'

export interface PieceProps {
  shape: Shape
  cell: Rect
  slot: number
  /** each notch's area as a fraction of the piece (highlight.slotFracs) */
  fracs: Partial<Record<SlotId, number>>
  color: string
  colorOf: (id: string) => string
  /** pooled coverage per channel, 0–1 */
  fillOf: (c: Channel) => number
  /** share of the uncovered part paid back elsewhere, 0–1 (interior spacing) */
  creditOf?: (c: Channel) => number
  /** who paints this piece's notch on a channel, and in what shares */
  suppliersOf: (c: Channel, pieceId: string) => Supplier[]
  detail?: Detail
  /** 0 = notches open and unfilled, 1 = fully painted; drives the assembly */
  paint?: number
  focus?: Focus
  textured?: boolean
  onEnterPlayer?: (id: string, at: { x: number; y: number }) => void
  onEnterSlot?: (c: Channel, at: { x: number; y: number }) => void
  onLeave?: () => void
  onPick?: (id: string) => void
  /**
   * Board units per CSS pixel. The board is an SVG scaled to its container, so
   * text sized in board units shrinks to nothing on a phone; everything legible
   * is sized in pixels and multiplied back by this.
   */
  unit?: number
  selected?: boolean
  /** pattern id for the uncovered part of a notch */
  hatch?: string
}

const SLOT_CHANNEL = Object.fromEntries(
  CHANNELS.map((c) => [CHANNEL_SLOT[c], c]),
) as Record<SlotId, Channel>

const at = (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY })

function Slot({
  slot,
  fill,
  credit,
  paint,
  suppliers,
  pieceColor,
  colorOf,
  detail,
  lit,
  focus,
  textured,
  index,
  unit,
  hatch,
  onEnter,
  onLeave,
}: {
  slot: SlotRect
  fill: number
  credit: number
  paint: number
  suppliers: Supplier[]
  pieceColor: string
  colorOf: (id: string) => string
  detail: Detail
  lit: boolean
  focus?: Focus
  textured: boolean
  index: number
  unit: number
  hatch: string
  onEnter?: (e: React.PointerEvent) => void
  onLeave?: () => void
}) {
  const { covered, credited, waste } = coverageBands(slot, fill, credit)
  // a letter only where it can be read: 10px type needs about 11px of room
  const letterPx = 10
  const showLetter = detail === 'full' && Math.min(slot.w, slot.h) / unit >= letterPx + 1
  // when one supplier is the focus, his bands stay lit and everything else in
  // the notch recedes, so the eye lands on what he alone repairs
  const isolating = lit && focus && !focus.none && focus.supplier !== undefined

  // a notch is a hole, so its covered part is painted in whoever repairs it;
  // at tile size that detail drops away and covered reads as solid piece
  const bands = detail === 'simple' ? [] : supplierBands(covered, suppliers, slot)

  const fillWith = (color: string) =>
    textured ? `url(#${textureId(color, index % 2 === 1)})` : color

  return (
    <g
      className={lit ? undefined : 'dimmed'}
      onPointerEnter={onEnter}
      onPointerMove={onEnter}
      onPointerLeave={onLeave}
    >
      {detail === 'simple' && covered.w > 0 && covered.h > 0 && (
        <rect {...box(covered)} fill={pieceColor} />
      )}
      {bands.map((b) =>
        b.w > 0.01 && b.h > 0.01 ? (
          <rect
            key={b.id}
            className={focus && !bandLit(focus, b.id) ? 'dimmed' : undefined}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill={fillWith(colorOf(b.id))}
          />
        ) : null,
      )}
      {/* paid back elsewhere: part of the hole, not part of the exposure. At
          tile size it reads as solid, since tiles show exposure alone. */}
      {credited.w > 0.01 && credited.h > 0.01 && paint > 0.01 && (
        <g opacity={paint} className={isolating ? 'dimmed' : undefined}>
          <rect
            {...box(credited)}
            fill={detail === 'simple' ? pieceColor : 'var(--void)'}
          />
          {detail === 'full' && <rect {...box(credited)} fill="url(#credit-dots)" />}
        </g>
      )}
      {/* Exploded, a notch is simply an open cut — nothing is wasted yet, the
          board has not been assembled. The stripes arrive with the assembly. */}
      {waste.w > 0.01 && waste.h > 0.01 && paint > 0.01 && (
        <g opacity={paint} className={isolating ? 'dimmed' : undefined}>
          <rect {...box(waste)} fill="var(--void)" />
          <rect {...box(waste)} fill={`url(#${hatch})`} />
        </g>
      )}
      {showLetter && (
        <text
          className="piece-letter"
          x={slot.x + slot.w / 2}
          y={slot.y + slot.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={letterPx * unit}
          fill={
            bands.length > 0 && fill > 0.55 ? inkOn(colorOf(bands[0].id)) : 'var(--ink-2)'
          }
        >
          {slot.letter}
        </text>
      )}
      {/* a hit target that is always at least comfortable to land on */}
      {onEnter && (
        <rect
          x={slot.x - 3 * unit}
          y={slot.y - 3 * unit}
          width={slot.w + 6 * unit}
          height={slot.h + 6 * unit}
          fill="transparent"
        />
      )}
    </g>
  )
}

export function Piece({
  shape,
  cell,
  slot,
  fracs,
  color,
  colorOf,
  fillOf,
  creditOf = () => 0,
  suppliersOf,
  detail = 'full',
  paint = 1,
  focus,
  textured = false,
  onEnterPlayer,
  onEnterSlot,
  onLeave,
  onPick,
  unit = 1,
  selected = false,
  hatch = 'waste-hatch',
}: PieceProps) {
  const id = shape.player.id
  const slots = slotRects(fracs, cell, slot)
  const path = outlinePath(slots, cell)

  const lit = !focus || focus.none || focus.pieces.has(id)
  // label sizing happens in screen pixels, then converts back to board units
  const wPx = cell.w / unit
  const hPx = cell.h / unit
  const namePx = Math.max(11, Math.min(15, Math.min(wPx, hPx) * 0.15))
  const name = surname(shape.player.name)
  // Archivo condensed runs about 0.52em per character
  const fitsName = name.length * namePx * 0.52 <= wPx * 0.86 && hPx >= namePx * 2
  const showName = detail === 'full' && fitsName
  const showInitials = detail === 'full' && !fitsName && Math.min(wPx, hPx) >= namePx * 2
  const showLoad = showName && hPx >= namePx * 3.6
  const nameSize = namePx * unit

  return (
    <g
      className={`piece${lit ? '' : ' dimmed'}`}
      data-player={id}
      onPointerEnter={onEnterPlayer ? (e) => onEnterPlayer(id, at(e)) : undefined}
      onPointerMove={onEnterPlayer ? (e) => onEnterPlayer(id, at(e)) : undefined}
      aria-pressed={onPick ? selected : undefined}
      onPointerLeave={onLeave}
      onClick={onPick ? () => onPick(id) : undefined}
      tabIndex={onPick ? 0 : undefined}
      role={onPick ? 'button' : undefined}
      aria-label={
        onPick
          ? `${shape.player.name}, ${shape.player.load.toFixed(1)}% of possessions`
          : undefined
      }
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(id)
              }
            }
          : undefined
      }
    >
      {/* section 4.3: no notch outlines at tile size — a 2px stroke around a
          20px notch is most of what you would see. The seam between cells does
          the separating there. */}
      <path
        className={detail === 'full' ? 'piece-outline' : 'piece-outline bare'}
        d={path}
        fill={color}
      />
      {selected && <path className="piece-selected" d={path} />}

      {slots.map((s, i) => {
        const c = SLOT_CHANNEL[s.id]
        return (
          <Fragment key={s.id}>
            <Slot
              slot={s}
              index={i}
              fill={fillOf(c) * paint}
              credit={creditOf(c) * paint}
              paint={paint}
              suppliers={suppliersOf(c, id)}
              pieceColor={color}
              colorOf={colorOf}
              detail={detail}
              lit={!focus || slotLit(focus, id, s.id)}
              focus={focus}
              textured={textured}
              unit={unit}
              hatch={hatch}
              onEnter={
                onEnterSlot
                  ? (e) => {
                      // the piece listens for moves too; without this a notch
                      // hover is overwritten by the player hover a frame later
                      e.stopPropagation()
                      onEnterSlot(c, at(e))
                    }
                  : undefined
              }
              onLeave={onLeave}
            />
          </Fragment>
        )
      })}

      {showName && (
        <text
          className="piece-name"
          x={cell.x + cell.w / 2}
          y={cell.y + cell.h / 2 - (showLoad ? nameSize * 0.36 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={nameSize}
          fill={inkOn(color)}
        >
          {name}
        </text>
      )}
      {showInitials && (
        <text
          className="piece-name"
          x={cell.x + cell.w / 2}
          y={cell.y + cell.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={nameSize}
          fill={inkOn(color)}
        >
          {initials(shape.player.name)}
        </text>
      )}
      {showLoad && (
        <text
          className="piece-load"
          x={cell.x + cell.w / 2}
          y={cell.y + cell.h / 2 + nameSize * 0.82}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={nameSize * 0.72}
          fill={inkOn(color)}
          opacity={0.72}
        >
          {shape.player.load.toFixed(1)}%
        </text>
      )}
    </g>
  )
}

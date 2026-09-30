/**
 * Linked highlighting, section 5.1. This is the channel that carries coverage
 * when hue cannot: pointing at a player names every notch he repairs, and
 * pointing at a notch names everyone repairing it.
 */
import type { SlotId } from './geometry'
import { channel } from './model'
import { CHANNELS, type Channel, type Shape, type TeamFit } from './types'

export type Highlight =
  | { kind: 'player'; id: string }
  | { kind: 'channel'; channel: Channel }
  | null

/** Which slot on a piece a given breakdown channel cuts. */
export const CHANNEL_SLOT: Record<Channel, SlotId> = {
  shooting: 'shooting',
  interior: 'interior',
  perimeterD: 'perimeterD',
  ballDominance: 'ball',
  noCreator: 'noCreator',
}

/** How deep this channel cuts (or protrudes) on one player's piece. */
export function channelDepth(shape: Shape, c: Channel): number {
  switch (c) {
    case 'ballDominance':
      return shape.tab
    case 'noCreator':
      return shape.lowNotch
    default:
      return shape.notch[c]
  }
}

export interface Focus {
  /** pieces that stay lit */
  pieces: Set<string>
  /** `playerId:slotId` pairs that stay lit */
  slots: Set<string>
  /** true when nothing is focused, so everything renders at full strength */
  none: boolean
  /**
   * When a player is the focus, the one supplier whose bands stay lit inside
   * the notches he repairs. Lighting the whole notch would credit him with his
   * teammates' paint too.
   */
  supplier?: string
}

const ALL: Focus = { pieces: new Set(), slots: new Set(), none: true }

export function focusOf(fit: TeamFit, highlight: Highlight): Focus {
  if (!highlight) return ALL

  const pieces = new Set<string>()
  const slots = new Set<string>()
  const mark = (playerId: string, c: Channel) => {
    pieces.add(playerId)
    slots.add(`${playerId}:${CHANNEL_SLOT[c]}`)
  }

  if (highlight.kind === 'player') {
    pieces.add(highlight.id)
    for (const c of CHANNELS) {
      const supplies = channel(fit, c).suppliers.some((s) => s.id === highlight.id)
      if (!supplies) continue
      for (const shape of fit.shapes) {
        if (channelDepth(shape, c) > 0) mark(shape.player.id, c)
      }
    }
    // the player's own open notches stay visible on his lit piece
    for (const c of CHANNELS) {
      const own = fit.shapes.find((s) => s.player.id === highlight.id)
      if (own && channelDepth(own, c) > 0) slots.add(`${highlight.id}:${CHANNEL_SLOT[c]}`)
    }
  } else {
    const c = highlight.channel
    for (const shape of fit.shapes) {
      if (channelDepth(shape, c) > 0) mark(shape.player.id, c)
    }
    for (const s of channel(fit, c).suppliers) pieces.add(s.id)
  }

  return {
    pieces,
    slots,
    none: false,
    supplier: highlight.kind === 'player' ? highlight.id : undefined,
  }
}

/** Whether one supplier's band inside a lit slot stays lit. */
export const bandLit = (focus: Focus, supplierId: string) =>
  focus.none || focus.supplier === undefined || focus.supplier === supplierId

export const pieceLit = (focus: Focus, id: string) => focus.none || focus.pieces.has(id)

export const slotLit = (focus: Focus, id: string, slot: SlotId) =>
  focus.none || focus.slots.has(`${id}:${slot}`)

/** "Shooting 92 · Interior 97 · Perimeter D 74" for a hover readout. */
export function suppliesOf(fit: TeamFit, playerId: string) {
  const shape = fit.shapes.find((s) => s.player.id === playerId)
  if (!shape) return []
  return CHANNELS.flatMap((c) => {
    const found = channel(fit, c).suppliers.find((s) => s.id === playerId)
    return found ? [{ channel: c, share: found.share }] : []
  })
}

/**
 * Each notch's area as a fraction of the player's piece: the model's charge for
 * that channel over his load. Drawn at these fractions, a board's notches are
 * the model's demand to scale and its stripes the model's waste to scale.
 */
export function slotFracs(fit: TeamFit, playerId: string): Partial<Record<SlotId, number>> {
  const shape = fit.shapes.find((s) => s.player.id === playerId)
  const charge = fit.charges[playerId]
  if (!shape || !charge || shape.player.load <= 0) return {}
  const out: Partial<Record<SlotId, number>> = {}
  for (const c of CHANNELS) out[CHANNEL_SLOT[c]] = charge[c] / shape.player.load
  return out
}

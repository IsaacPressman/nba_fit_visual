/**
 * Color assignment.
 *
 * Eight rotation slots need eight distinguishable colors on one board, and no
 * eight-hue set clears the all-pairs colorblind gate (the validated default
 * palette caps all-pairs use at three slots). That is why section 4.5 forbids
 * color as the only channel: every colored mark here is backed by a notch
 * letter, an on-piece initial, a roster swatch, a hover readout naming the
 * supplier, and an opt-in texture. Hue narrows the guess; the label settles it.
 *
 * Slots are pinned to a player id, not to load rank, so a swap never repaints
 * the teammates who stayed.
 */

/** Validated categorical order, light then dark step. */
const SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['#2a78d6', '#3987e5'], // blue
  ['#eb6834', '#d95926'], // orange
  ['#1baf7a', '#199e70'], // aqua
  ['#eda100', '#c98500'], // yellow
  ['#e87ba4', '#d55181'], // magenta
  ['#008300', '#008300'], // green
  ['#4a3aa7', '#9085e9'], // violet
  ['#e34948', '#e66767'], // red
]

export type Mode = 'light' | 'dark'

export const slotColor = (slot: number, mode: Mode) =>
  SLOTS[((slot % SLOTS.length) + SLOTS.length) % SLOTS.length][mode === 'dark' ? 1 : 0]

export const SLOT_COUNT = SLOTS.length

/** The piece tone for a player with no rotation seat. */
export const NEUTRAL = '#8e9893'

/**
 * Pin each player id to a palette slot, by load rank at first sight. Once a
 * roster is keyed, a swapped-in player inherits the slot of the player he
 * replaced, so colors follow the seat rather than the current ordering.
 */
export class SlotMap {
  private byId = new Map<string, number>()

  constructor(ids: string[]) {
    ids.forEach((id, i) => this.byId.set(id, i))
  }

  slot(id: string) {
    return this.byId.get(id) ?? 0
  }

  has(id: string) {
    return this.byId.has(id)
  }

  /** Give `incoming` the seat `outgoing` held. */
  replace(outgoing: string, incoming: string) {
    const seat = this.byId.get(outgoing)
    if (seat === undefined) return
    this.byId.delete(outgoing)
    this.byId.set(incoming, seat)
  }

  /**
   * A player outside the rotation — in a lineup, say — has no seat, so he gets
   * the neutral piece tone rather than borrowing seat 0's color.
   */
  color(id: string, mode: Mode) {
    return this.byId.has(id) ? slotColor(this.slot(id), mode) : NEUTRAL
  }
}

/** Texture pattern id for a color, angled by slot parity (45deg / 135deg). */
export const textureId = (color: string, mirror: boolean) =>
  `tx-${color.replace('#', '')}-${mirror ? 'b' : 'a'}`

/** Initials for the on-piece label: the redundant identity channel. */
export function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Family name, for the roster and the piece label when there is room. */
export function surname(name: string) {
  const parts = name.replace(/\s+(Jr\.|Sr\.|II|III|IV|V)$/i, '').split(/\s+/)
  return parts[parts.length - 1]
}

/** White or ink, whichever clears contrast inside a filled shape. */
export function inkOn(hex: string) {
  const n = hex.replace('#', '')
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  return l > 0.42 ? '#0b0b0b' : '#ffffff'
}

/**
 * The fit model, section 3 of the handoff. Pure: no DOM, no rendering, no
 * knowledge of where a piece ends up on the board. Score a rotation, get back
 * every number the board and the breakdown rows need.
 */
import {
  CHANNELS,
  DEFAULT_RULES,
  SKILLS,
  type Channel,
  type ChannelResult,
  type Player,
  type Rules,
  type Shape,
  type Skill,
  type Supplier,
  type Team,
  type TeamFit,
} from './types'

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Shares of a pooled channel, proportional to load x strength. */
function shares(weights: Array<[string, number]>): Supplier[] {
  const total = weights.reduce((s, [, w]) => s + w, 0)
  if (total <= 0) return []
  return weights
    .filter(([, w]) => w > 0)
    .map(([id, w]) => ({ id, share: w / total }))
    .sort((a, b) => b.share - a.share)
}

// --------------------------------------------------------------------------- //
// per player
// --------------------------------------------------------------------------- //

export function shapeOf(player: Player, rules: Rules = DEFAULT_RULES): Shape {
  const { needPivot, needExponent, strengthFloor, compoundFactor, depth, notchCap } = rules

  const need = {} as Record<Skill, number>
  const strength = {} as Record<Skill, number>
  for (const k of SKILLS) {
    const pct = player.pct[k]
    need[k] = clamp01((needPivot - pct) / needPivot) ** needExponent
    strength[k] = clamp01((pct - strengthFloor) / (100 - strengthFloor))
  }

  // several weaknesses compound: the worst one is free, the rest deepen everything
  const needs = SKILLS.map((k) => need[k])
  const sumNeed = needs.reduce((a, b) => a + b, 0)
  const maxNeed = Math.max(...needs)
  const compound = 1 + compoundFactor * (sumNeed - maxNeed)

  const notch = {} as Record<Skill, number>
  for (const k of SKILLS) {
    notch[k] = Math.min(notchCap, depth[k] * need[k] * compound)
  }

  const { usgFloor, usgRange, playmakerRelief, tabLength } = rules.ball
  const rawBall = clamp01((player.usg - usgFloor) / usgRange)
  const ball = rawBall * (1 - playmakerRelief * (player.pct.playmaking / 100))
  const tab = tabLength * ball

  const low = rules.lowUsage
  const lowNeed = clamp01((low.usgCeiling - player.usg) / low.usgRange) ** low.exponent
  const lowNotch = Math.min(notchCap, low.depth * lowNeed)

  return {
    player,
    need,
    strength,
    notch,
    compound,
    compounding: sumNeed - maxNeed > 0.05,
    ball,
    tab,
    lowNeed,
    lowNotch,
    onFloor: clamp01(player.mpg / 48),
  }
}

// --------------------------------------------------------------------------- //
// per team
// --------------------------------------------------------------------------- //

export function scoreRotation(
  team: Team,
  roster: Player[] = team.players,
  rules: Rules = DEFAULT_RULES,
): TeamFit {
  const shapes = roster.map((p) => shapeOf(p, rules))
  const totalLoad = roster.reduce((s, p) => s + p.load, 0)
  const { slot, depth, reach } = rules

  const skills = {} as Record<Skill, ChannelResult>
  const charges: Record<string, Record<Channel, number>> = {}
  for (const s of shapes) {
    charges[s.player.id] = { shooting: 0, interior: 0, perimeterD: 0, ballDominance: 0, noCreator: 0 }
  }
  for (const k of SKILLS) {
    let pooled = 0
    let supply = 0
    let loadSlot = 0
    let worst = 0
    // chance nobody who supplies this skill is on the floor, taking minutes as
    // independent. Coaches stagger on purpose, so this is an approximation --
    // but it is the one minutes alone can support, and it is far closer than
    // assuming a strength covers the whole game.
    let absent = 1
    for (const s of shapes) {
      pooled += s.player.load * slot * s.notch[k]
      supply += s.player.load * slot * depth[k] * s.strength[k] * reach[k]
      loadSlot += s.player.load * slot
      worst = Math.max(worst, s.notch[k])
      absent *= 1 - s.onFloor * s.strength[k]
    }

    // Shooting and interior pool. Perimeter defence partly does not: opponents
    // attack the weakest man on the floor, so his hole is charged against every
    // possession rather than averaged away against good defenders.
    const link = k === 'perimeterD' ? clamp01(rules.coverage.weakestLinkD) : 0
    const demand = (1 - link) * pooled + link * loadSlot * worst

    // Who carries that demand. The pooled part is each player's own hole. The
    // weakest-link part is, by construction, every possession charged as if it
    // had the worst defender's hole — opponents hunt him wherever he is — so it
    // lands on every piece in proportion to its load, not on his piece alone
    // (where it could be larger than the piece itself).
    for (const s of shapes) {
      charges[s.player.id][k] = s.player.load * slot * ((1 - link) * s.notch[k] + link * worst)
    }

    const capacity = demand > 0 ? Math.min(1, supply / demand) : 1
    const presence = 1 - absent
    // a product, not a sum: two half-game rim protectors reach 0.75, not 1, so
    // the fifth shooter adds less than the second without a separate curve
    const believed = clamp01(rules.coverage.onFloor)
    const effective = believed * presence + (1 - believed)
    const fill = demand > 0 ? capacity * effective : 1
    const credit = k === 'interior' ? clamp01(rules.coverage.interiorSpacing ?? 0) : 0

    skills[k] = {
      demand,
      supply,
      capacity,
      presence,
      fill,
      credit,
      waste: demand * (1 - fill) * (1 - credit),
      suppliers: shares(shapes.map((s) => [s.player.id, s.player.load * s.strength[k]])),
    }
  }

  // ball dominance: usage that needs room against the room low-usage players offer
  let T = 0
  let A = 0
  for (const s of shapes) {
    T += s.player.load * slot * s.tab
    A += s.player.load * slot * s.lowNotch
  }
  const matched = Math.min(T, A)
  const surplus = T - matched // too many creators
  const starved = A - matched // nobody creating for low-usage players
  const creators = shares(shapes.map((s) => [s.player.id, s.player.load * s.tab]))
  for (const s of shapes) {
    charges[s.player.id].ballDominance = s.player.load * slot * s.tab
    charges[s.player.id].noCreator = s.player.load * slot * s.lowNotch
  }

  // Usage is already a per-possession quantity, so these two channels are
  // matched on volume rather than on presence: capacity is the whole story.
  const ballDominance: ChannelResult = {
    demand: T,
    supply: A,
    capacity: T > 0 ? matched / T : 1,
    presence: 1,
    fill: T > 0 ? matched / T : 1,
    credit: 0,
    waste: surplus,
    suppliers: shares(shapes.map((s) => [s.player.id, s.player.load * s.lowNotch])),
  }
  const noCreator: ChannelResult = {
    demand: A,
    supply: T,
    capacity: A > 0 ? matched / A : 1,
    presence: 1,
    fill: A > 0 ? matched / A : 1,
    credit: 0,
    waste: starved,
    suppliers: creators,
  }

  const totalWaste =
    SKILLS.reduce((s, k) => s + skills[k].waste, 0) + surplus + starved

  return {
    team,
    shapes,
    totalLoad,
    skills,
    ballDominance,
    noCreator,
    creators,
    charges,
    wastedFitPct: totalLoad > 0 ? (totalWaste / totalLoad) * 100 : 0,
  }
}

export function channel(fit: TeamFit, c: Channel): ChannelResult {
  if (c === 'ballDominance') return fit.ballDominance
  if (c === 'noCreator') return fit.noCreator
  return fit.skills[c]
}

/** Points of wasted fit a channel contributes, on the same scale as the headline. */
export function wastePoints(fit: TeamFit, c: Channel): number {
  return fit.totalLoad > 0 ? (channel(fit, c).waste / fit.totalLoad) * 100 : 0
}

// --------------------------------------------------------------------------- //
// league
// --------------------------------------------------------------------------- //

export function scoreLeague(teams: Team[], rules: Rules = DEFAULT_RULES): TeamFit[] {
  return teams.map((t) => scoreRotation(t, t.players, rules))
}

/**
 * Rank by wasted fit, treating differences under `tolerance` as ties
 * (section 4.3). Returns the shared rank per team abbreviation, 1-based.
 */
export function rankByFit(fits: TeamFit[], tolerance = 1): Map<string, number> {
  const sorted = [...fits].sort((a, b) => a.wastedFitPct - b.wastedFitPct)
  const ranks = new Map<string, number>()
  let rank = 1
  let anchor = Number.NEGATIVE_INFINITY
  sorted.forEach((f, i) => {
    if (f.wastedFitPct - anchor > tolerance) {
      rank = i + 1
      anchor = f.wastedFitPct
    }
    ranks.set(f.team.abbr, rank)
  })
  return ranks
}

/**
 * "T-3" when a rank is shared, "3" when it is not. Two "#1"s side by side read
 * as a bug; the prefix says the tie is deliberate.
 */
export function rankLabel(ranks: Map<string, number>, abbr: string): string {
  const rank = ranks.get(abbr)
  if (rank === undefined) return '—'
  let shared = 0
  for (const r of ranks.values()) if (r === rank) shared++
  return shared > 1 ? `T-${rank}` : `${rank}`
}

/** Pearson r between wasted fit and wins. Negative means better fit, more wins. */
export function fitWinCorrelation(fits: TeamFit[]): number {
  const n = fits.length
  if (n < 2) return 0
  const xs = fits.map((f) => f.wastedFitPct)
  const ys = fits.map((f) => f.team.wins)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0
}

/** Least-squares line for the fit-vs-record scatter. */
export function fitWinLine(fits: TeamFit[]): { slope: number; intercept: number } {
  const n = fits.length
  const mx = fits.reduce((s, f) => s + f.wastedFitPct, 0) / n
  const my = fits.reduce((s, f) => s + f.team.wins, 0) / n
  let num = 0
  let den = 0
  for (const f of fits) {
    const a = f.wastedFitPct - mx
    num += a * (f.team.wins - my)
    den += a * a
  }
  const slope = den > 0 ? num / den : 0
  return { slope, intercept: my - slope * mx }
}

export { CHANNELS, SKILLS, DEFAULT_RULES }

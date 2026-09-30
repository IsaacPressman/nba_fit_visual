export const SKILLS = ['shooting', 'interior', 'perimeterD'] as const
export type Skill = (typeof SKILLS)[number]

/** The five rows the team view breaks wasted fit into. */
export const CHANNELS = [...SKILLS, 'ballDominance', 'noCreator'] as const
export type Channel = (typeof CHANNELS)[number]

export interface Player {
  id: string
  key: string
  name: string
  team: string
  games: number
  min: number
  mpg: number
  usg: number
  /** share of team possessions; the piece's area */
  load: number
  pct: {
    shooting: number
    interior: number
    playmaking: number
    perimeterD: number
  }
  raw: {
    fg3aPer36: number
    fg3Pct: number
    rebPer36: number
    blkPer36: number
    astPer36: number
    astRatio: number
    stlPer36: number
    dpm: number
    epm: number
    seasonMin: number
  }
}

export interface Team {
  abbr: string
  name: string
  wins: number
  losses: number
  /** possession-weighted EPM: the talent baseline wasted fit is tested against */
  talent: number
  colors: [string, string]
  players: Player[]
  /**
   * Minutes each pair of rotation players shared the floor, by player id; the
   * diagonal is a player's own floor time. From five-man lineup totals, and
   * absent when those have not been fetched.
   */
  overlap?: Record<string, Record<string, number>>
  /** the most-used five-man lineups whose five are all in the pool, by name key */
  lineups?: Array<{ keys: string[]; minutes: number }>
  /** projected seasons: rostered players with no data to score (rookies, under 500 minutes) */
  unscored?: string[]
}

export interface League {
  season: string
  /** a projection: next season's rosters scored on last season's play */
  projected?: boolean
  /** the season a projection's player data comes from */
  basedOn?: string
  generated: string
  rotationSize: number
  pool: { minMinutes: number; size: number; shrinkPrior: number }
  defenseRegression: { a: number; b: number }
  sources: Record<string, string>
  teams: Team[]
  league: Player[]
}

/** Every constant in section 3, exposed so the rules panel can move them. */
export interface Rules {
  needPivot: number
  needExponent: number
  strengthFloor: number
  compoundFactor: number
  depth: Record<Skill, number>
  notchCap: number
  slot: number
  reach: Record<Skill, number>
  ball: {
    usgFloor: number
    usgRange: number
    playmakerRelief: number
    tabLength: number
  }
  lowUsage: {
    usgCeiling: number
    usgRange: number
    exponent: number
    depth: number
  }
  coverage: {
    /**
     * How much the model believes coverage has to be on the floor to count.
     * 0 pools across the whole rotation the way the prototype did; 1 caps
     * coverage at the share of the game a supplier actually plays, so a rim
     * protector at 24 minutes cannot cover the other 24.
     */
    onFloor: number
    /**
     * How much of perimeter-defence demand comes from the worst defender rather
     * than the pool. 0 is fully pooled; 1 says opponents hunt the weakest man on
     * the floor every possession and help never arrives. Shooting and interior
     * stay pooled either way.
     */
    weakestLinkD: number
    /**
     * Share of an uncovered interior hole that is paid back on offense. Across
     * 7,672 held-out lineups (2023-24, 2024-25), lineups short of rebounding and
     * rim protection allowed 0.48 more points per 100 per point of interior
     * exposure but scored 0.43 more — the spacing that comes with playing
     * small. 0.43 / 0.48 is about 0.9, so by default most of the hole nets out.
     * 0 charges the whole hole, as the model did before the lineup test.
     */
    interiorSpacing: number
  }
}

export const DEFAULT_RULES: Rules = {
  needPivot: 50,
  needExponent: 0.6,
  strengthFloor: 65,
  compoundFactor: 0.6,
  depth: { shooting: 0.38, interior: 0.34, perimeterD: 0.36 },
  notchCap: 0.46,
  slot: 0.34,
  reach: { shooting: 1.3, interior: 3.0, perimeterD: 1.6 },
  ball: { usgFloor: 20, usgRange: 14, playmakerRelief: 0.6, tabLength: 0.34 },
  lowUsage: { usgCeiling: 17, usgRange: 8, exponent: 0.6, depth: 0.26 },
  coverage: { onFloor: 1, weakestLinkD: 0.5, interiorSpacing: 0.9 },
}

/** One player's shape: what his piece has cut out of it and what sticks out. */
export interface Shape {
  player: Player
  need: Record<Skill, number>
  strength: Record<Skill, number>
  notch: Record<Skill, number>
  compound: number
  /** true when more than one weakness is deepening the others */
  compounding: boolean
  ball: number
  tab: number
  lowNeed: number
  lowNotch: number
  /** share of the game he is on the floor: a strength only helps while he plays */
  onFloor: number
}

export interface Supplier {
  id: string
  share: number
}

/** Coverage of one skill across the rotation. */
export interface ChannelResult {
  demand: number
  supply: number
  /** supply against demand, as if the suppliers never left the floor */
  capacity: number
  /** share of the game at least one supplier of this skill is on the floor */
  presence: number
  /** capacity x presence: the fraction of every notch on this channel that gets painted */
  fill: number
  /**
   * Fraction of the uncovered part that is paid back elsewhere rather than
   * charged: only interior has one (spacing). waste = demand x (1 - fill) x (1 - credit).
   */
  credit: number
  waste: number
  suppliers: Supplier[]
}

export interface TeamFit {
  team: Team
  shapes: Shape[]
  totalLoad: number
  skills: Record<Skill, ChannelResult>
  ballDominance: ChannelResult
  noCreator: ChannelResult
  /** creators share the ball-dominance and needs-a-creator paint */
  creators: Supplier[]
  /**
   * Each player's share of each channel's demand, in the same units as
   * ChannelResult.demand; summing a channel over players gives its demand. A
   * notch drawn with area proportional to its charge makes the board's stripes
   * add up to exactly the exposure figure.
   */
  charges: Record<string, Record<Channel, number>>
  wastedFitPct: number
}

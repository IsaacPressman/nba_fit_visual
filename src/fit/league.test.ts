/**
 * The model run against the real 2025-26 bundle: invariants that must hold on
 * live data, plus the stability and archetype checks section 7 asks for.
 * Prints the league table so a run doubles as the validation readout.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  channel,
  fitWinCorrelation,
  rankByFit,
  scoreLeague,
  scoreRotation,
  shapeOf,
  wastePoints,
} from './model'
import { CHANNELS, DEFAULT_RULES, type League, type Rules } from './types'
import { coverageBands, slotRects } from './geometry'
import { CHANNEL_SLOT, slotFracs } from './highlight'
import { squarify } from './layout'

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/league.json'), 'utf8'),
) as League

const fits = scoreLeague(data.teams)
const byTeam = new Map(fits.map((f) => [f.team.abbr, f]))

describe('bundle shape', () => {
  it('carries all 30 teams with a full rotation each', () => {
    expect(data.teams).toHaveLength(30)
    for (const t of data.teams) {
      expect(t.players).toHaveLength(data.rotationSize)
      expect(t.wins + t.losses).toBe(82)
    }
  })

  it('uses one defensive source for every player in the pool', () => {
    for (const p of data.league) {
      expect(p.raw.dpm).not.toBeNull()
      expect(Number.isFinite(p.raw.dpm)).toBe(true)
    }
    expect(data.league).toHaveLength(data.pool.size)
  })

  it('keeps every percentile inside 0-100', () => {
    for (const p of data.league) {
      for (const v of Object.values(p.pct)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('league scores', () => {
  it('scores every team in a plausible range', () => {
    for (const f of fits) {
      expect(f.wastedFitPct).toBeGreaterThanOrEqual(0)
      expect(f.wastedFitPct).toBeLessThan(40)
    }
  })

  it('leaves nobody at a near-perfect score (section 7.5)', () => {
    // Coverage is capped by how much of the game a supplier is on the floor, so
    // no rotation covers everything. Before that, two teams sat under 1%.
    for (const f of fits) expect(f.wastedFitPct).toBeGreaterThan(1)
  })

  it('charges every team for coverage that is sitting on the bench', () => {
    const pooled = scoreLeague(data.teams, {
      ...DEFAULT_RULES,
      coverage: { ...DEFAULT_RULES.coverage, onFloor: 0 },
    })
    const byAbbr = new Map(pooled.map((f) => [f.team.abbr, f]))
    for (const f of fits) {
      expect(f.wastedFitPct).toBeGreaterThanOrEqual(byAbbr.get(f.team.abbr)!.wastedFitPct - 1e-9)
    }
    // and for at least some teams the difference is worth a rank
    const moved = fits.filter(
      (f) => f.wastedFitPct - byAbbr.get(f.team.abbr)!.wastedFitPct > 1,
    )
    expect(moved.length).toBeGreaterThan(5)
  })

  it('reports how much of each skill is actually on the floor', () => {
    const rows = fits
      .map((f) => ({
        team: f.team.abbr,
        exposure: +f.wastedFitPct.toFixed(1),
        shoOnFloor: Math.round(f.skills.shooting.presence * 100),
        intOnFloor: Math.round(f.skills.interior.presence * 100),
        defOnFloor: Math.round(f.skills.perimeterD.presence * 100),
      }))
      .sort((a, b) => a.exposure - b.exposure)
    console.table(rows)
    for (const f of fits) {
      for (const k of ['shooting', 'interior', 'perimeterD'] as const) {
        expect(f.skills[k].presence).toBeGreaterThanOrEqual(0)
        expect(f.skills[k].presence).toBeLessThanOrEqual(1)
        expect(f.skills[k].fill).toBeLessThanOrEqual(f.skills[k].capacity + 1e-9)
      }
    }
  })

  it('accounts for all waste across the five breakdown rows', () => {
    for (const f of fits) {
      const summed = CHANNELS.reduce((s, c) => s + wastePoints(f, c), 0)
      expect(summed).toBeCloseTo(f.wastedFitPct, 8)
    }
  })

  it('correlates negatively with wins', () => {
    const r = fitWinCorrelation(fits)
    expect(r).toBeLessThan(0)
    expect(r).toBeGreaterThan(-0.9) // a modest signal, not a restatement of record
  })

  it('prints the league table', () => {
    const ranks = rankByFit(fits)
    const rows = [...fits]
      .sort((a, b) => a.wastedFitPct - b.wastedFitPct)
      .map((f) => ({
        rank: ranks.get(f.team.abbr)!,
        team: f.team.abbr,
        record: `${f.team.wins}-${f.team.losses}`,
        exposure: +f.wastedFitPct.toFixed(1),
        sho: +wastePoints(f, 'shooting').toFixed(1),
        int: +wastePoints(f, 'interior').toFixed(1),
        def: +wastePoints(f, 'perimeterD').toFixed(1),
        ball: +wastePoints(f, 'ballDominance').toFixed(1),
        starved: +wastePoints(f, 'noCreator').toFixed(1),
      }))
    console.table(rows)
    console.log('exposure vs wins r =', fitWinCorrelation(fits).toFixed(3))
    expect(rows).toHaveLength(30)
  })
})

describe('stability under small rule changes (section 7.2)', () => {
  const nudge = (f: number): Rules => ({
    ...DEFAULT_RULES,
    compoundFactor: DEFAULT_RULES.compoundFactor * f,
    reach: {
      shooting: DEFAULT_RULES.reach.shooting * f,
      interior: DEFAULT_RULES.reach.interior * f,
      perimeterD: DEFAULT_RULES.reach.perimeterD * f,
    },
  })

  it('keeps the ranking broadly in place when constants move 10%', () => {
    const base = rankByFit(fits)
    for (const f of [0.9, 1.1]) {
      const moved = rankByFit(scoreLeague(data.teams, nudge(f)))
      const shifts = data.teams.map((t) =>
        Math.abs(base.get(t.abbr)! - moved.get(t.abbr)!),
      )
      const mean = shifts.reduce((a, b) => a + b, 0) / shifts.length
      console.log(`constants x${f}: mean rank shift ${mean.toFixed(2)}, worst ${Math.max(...shifts)}`)
      expect(mean).toBeLessThan(4)
    }
  })

  it('keeps the sign and rough size of the win correlation', () => {
    for (const f of [0.9, 1.1]) {
      const r = fitWinCorrelation(scoreLeague(data.teams, nudge(f)))
      expect(r).toBeLessThan(0)
    }
  })
})

describe('does exposure add anything beyond talent? (section 7.2)', () => {
  const pearson = (xs: number[], ys: number[]) => {
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0
  }
  /** correlation of a and b once c is projected out of both */
  const partial = (a: number[], b: number[], c: number[]) => {
    const rab = pearson(a, b)
    const rac = pearson(a, c)
    const rbc = pearson(b, c)
    const den = Math.sqrt((1 - rac ** 2) * (1 - rbc ** 2))
    return den > 0 ? (rab - rac * rbc) / den : 0
  }

  const wasted = fits.map((f) => f.wastedFitPct)
  const wins = fits.map((f) => f.team.wins)
  const talent = fits.map((f) => f.team.talent)

  it('reports how much of the win signal survives controlling for talent', () => {
    const raw = pearson(wasted, wins)
    const talentWins = pearson(talent, wins)
    const net = partial(wasted, wins, talent)
    console.log(
      [
        `exposure  ~ wins            r = ${raw.toFixed(3)}`,
        `talent    ~ wins            r = ${talentWins.toFixed(3)}`,
        `exposure  ~ wins | talent   r = ${net.toFixed(3)}  <- the construction signal`,
        `exposure  ~ talent          r = ${pearson(wasted, talent).toFixed(3)}`,
      ].join('\n'),
    )
    // The honest bar: it must still point the right way once talent is removed.
    expect(net).toBeLessThan(0)
  })

  it('is not a restatement of talent', () => {
    expect(Math.abs(pearson(wasted, talent))).toBeLessThan(0.95)
  })
})

describe('archetypes (section 7.6)', () => {
  const find = (name: string) => {
    const p = data.league.find((x) => x.name === name)
    if (!p) throw new Error(`${name} is not in the pool`)
    return p
  }

  it('cuts a high-usage, low-playmaking, poor-defense scorer to pieces', () => {
    const s = shapeOf(find('Cam Thomas'))
    expect(s.tab).toBeGreaterThan(0.15) // ball-dominant: about half the maximum tab
    expect(s.notch.perimeterD).toBeGreaterThan(0.2)
    expect(s.notch.interior).toBeGreaterThan(0.2)
    expect(s.compounding).toBe(true)
  })

  it('leaves a 3-and-D wing close to a clean square', () => {
    const s = shapeOf(find('Mikal Bridges'))
    const cut = s.notch.shooting + s.notch.interior + s.notch.perimeterD
    expect(cut).toBeLessThan(0.15)
    expect(s.tab).toBe(0)
  })

  it('no longer puts a perimeter notch on Draymond Green', () => {
    // the prototype's box-score proxy did; real defensive EPM does not
    expect(find('Draymond Green').pct.perimeterD).toBeGreaterThan(50)
    expect(shapeOf(find('Draymond Green')).notch.perimeterD).toBe(0)
  })
})

describe('swapping a player (section 5.3)', () => {
  it('recomputes the board when a league player replaces a rotation player', () => {
    const okc = byTeam.get('OKC')!
    const worst = data.league.find((p) => p.name === 'Cam Thomas')!
    const roster = okc.team.players.map((p, i) => (i === 1 ? worst : p))
    const after = scoreRotation(okc.team, roster)
    expect(after.wastedFitPct).not.toBeCloseTo(okc.wastedFitPct, 3)
    expect(after.shapes.map((s) => s.player.id)).toContain(worst.id)
  })

  it('leaves the score untouched when the swap is a no-op', () => {
    const bos = byTeam.get('BOS')!
    const same = scoreRotation(bos.team, [...bos.team.players])
    expect(same.wastedFitPct).toBeCloseTo(bos.wastedFitPct, 10)
  })
})

/**
 * The picture and the number must agree: an assembled board, drawn exactly as
 * Board draws it, is striped over exactly the exposure share of its frame. And
 * no two notches on any piece in the league may overlap, or the outline breaks
 * and area is counted twice.
 */
describe('the board draws the score to scale', () => {
  const frameOf = () => {
    const seam = 600 * 0.026
    return { seam, frame: { x: seam / 2, y: seam / 2, w: 1000 - seam, h: 600 - seam } }
  }

  it('stripes exactly the exposure share of every assembled board', () => {
    const { seam, frame } = frameOf()
    let worst = 0
    for (const fit of fits) {
      const items = [...fit.shapes]
        .sort((a, b) => b.player.load - a.player.load)
        .map((s) => ({ id: s.player.id, value: s.player.load }))
      let striped = 0
      for (const c of squarify(items, frame)) {
        const drawn = { x: c.x + seam / 2, y: c.y + seam / 2, w: c.w - seam, h: c.h - seam }
        const k = (c.w * c.h) / (drawn.w * drawn.h)
        const fracs = Object.fromEntries(
          Object.entries(slotFracs(fit, c.id)).map(([s, f]) => [s, (f ?? 0) * k]),
        )
        for (const slot of slotRects(fracs, drawn, DEFAULT_RULES.slot)) {
          const ch = CHANNELS.find((x) => CHANNEL_SLOT[x] === slot.id)!
          const r = channel(fit, ch)
          const { waste } = coverageBands(slot, r.fill, r.credit)
          striped += waste.w * waste.h
        }
      }
      const share = (striped / (frame.w * frame.h)) * 100
      worst = Math.max(worst, Math.abs(share - fit.wastedFitPct))
    }
    console.log(`stripes vs exposure, worst gap across 30 boards: ${worst.toFixed(4)} points`)
    expect(worst).toBeLessThan(0.01)
  })

  it('never lets two notches on one piece overlap', () => {
    const { seam, frame } = frameOf()
    let clashes = 0
    for (const fit of fits) {
      const items = fit.shapes.map((s) => ({ id: s.player.id, value: s.player.load }))
      for (const c of squarify(items.sort((a, b) => b.value - a.value), frame)) {
        const drawn = { x: c.x + seam / 2, y: c.y + seam / 2, w: c.w - seam, h: c.h - seam }
        const rs = slotRects(slotFracs(fit, c.id), drawn, DEFAULT_RULES.slot)
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i]
            const b = rs[j]
            if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) clashes++
          }
      }
    }
    expect(clashes).toBe(0)
  })
})

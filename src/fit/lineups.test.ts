/**
 * The lineup-level test of section 7.2: does exposure predict how five players
 * actually do together, beyond what their individual ratings say?
 *
 * Thirty team records cannot separate a modest effect from noise. Five-man
 * lineups can: thousands a season, each with its own possessions and points.
 * For every lineup whose five players are all in that season's pool:
 *
 *   exposure  the model run on those five, each on the floor all 48 minutes
 *             and weighted by usage (they share the floor, so season possession
 *             share is the wrong weight)
 *   talent    the sum of their five player ratings — roughly the net rating
 *             five players of that quality would post if fit did not matter
 *   net       points minus opponent points per 100 possessions
 *
 * Fit is not success. A stacked lineup that fits badly can still win and a thin
 * one that fits well can still lose, so the question is never "does exposure
 * predict winning" but "does it predict doing better or worse than the talent
 * on the floor says". Every regression here carries talent, and team fixed
 * effects so a lineup is only compared with its own team's other lineups. The
 * readout also asks whether fit matters more for talented lineups, what a
 * realistic difference in fit is worth next to one in talent, and whether each
 * channel moves the side of the ball it claims to — none of which needs a win.
 *
 * Holdout: the finding that the interior channel runs backwards came from
 * 2025-26. 2024-25 and 2023-24 were not looked at before it was written down,
 * so they are the test of it.
 *
 * The rating is Box Plus-Minus for every season, because Dunks & Threes
 * paywalls past seasons' EPM and one metric across all three keeps them
 * comparable. BPM is box-score based and weaker on defense than the EPM the app
 * uses, so 2025-26 is also run on EPM to show how much the metric alone moves
 * the answer.
 *
 * Needs data/seasons/<season>.<rating>.json (pipeline/season.py); skipped
 * without them.
 * Prints its readout, asserts only that the inputs are sane: effect sizes are
 * measurements, not specs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoreRotation, wastePoints } from './model'
import { DEFAULT_RULES, type League, type Player, type Rules, type Team } from './types'

interface SeasonFile {
  season: string
  rating: 'bpm' | 'epm'
  players: Record<
    string,
    {
      key: string
      name: string
      min: number
      pct: Player['pct']
      rating: number
      oRating: number
      dRating: number
    }
  >
  stints: Record<string, { usg: number; mpg: number }>
  lineups: Array<{
    team: string
    pids: string[]
    offPoss: number
    defPoss: number
    points: number
    oppPoints: number
  }>
}

const DIR = resolve(__dirname, '../../data/seasons')
const HOLDOUT = ['2023-24', '2024-25']
const TUNED_ON = '2025-26'

const files: SeasonFile[] = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => /^\d{4}-\d{2}\.(bpm|epm)\.json$/.test(f))
      .sort()
      .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')))
  : []
/** The cross-season test: one metric, every season. */
const seasons = files.filter((f) => f.rating === 'bpm')
const epm2526 = files.find((f) => f.rating === 'epm' && f.season === TUNED_ON)

const league = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/league.json'), 'utf8'),
) as League

const CHANNEL_NAMES = ['shooting', 'interior', 'perimeter D', 'ball dominance'] as const
const PART_CHANNELS = ['shooting', 'interior', 'perimeterD', 'ballDominance'] as const
const NO_INTERIOR: Rules = { ...DEFAULT_RULES, depth: { ...DEFAULT_RULES.depth, interior: 0 } }

interface Row {
  group: string // team-season, for fixed effects
  season: string
  poss: number
  offPoss: number
  defPoss: number
  net: number
  ortg: number
  drtg: number
  talent: number
  oTalent: number
  dTalent: number
  exposure: number
  parts: number[]
}

function rowsFor(s: SeasonFile, rules: Rules, minPoss: number): Row[] {
  const out: Row[] = []
  for (const l of s.lineups) {
    const poss = (l.offPoss + l.defPoss) / 2
    if (poss < minPoss || l.offPoss <= 0 || l.defPoss <= 0) continue
    const five: Player[] = []
    for (const pid of l.pids) {
      const p = s.players[pid]
      const stint = s.stints[`${pid}|${l.team}`]
      if (!p || !stint) break
      // all five share the floor: full minutes, and usage decides each one's weight
      five.push({
        id: pid,
        key: p.key,
        name: p.name,
        team: l.team,
        games: 0,
        min: p.min,
        mpg: 48,
        usg: stint.usg,
        load: stint.usg,
        pct: p.pct,
        raw: {
          fg3aPer36: 0, fg3Pct: 0, rebPer36: 0, blkPer36: 0, astPer36: 0,
          astRatio: 0, stlPer36: 0, dpm: p.dRating, epm: p.rating, seasonMin: p.min,
        },
      })
    }
    if (five.length !== 5) continue
    const team = { abbr: l.team, name: l.team, wins: 0, losses: 0, talent: 0, colors: ['', ''], players: five } as Team
    const fit = scoreRotation(team, five, rules)
    const sum = (f: (id: string) => number) => l.pids.reduce((a, id) => a + f(id), 0)
    out.push({
      group: `${s.season}:${l.team}`,
      season: s.season,
      poss,
      offPoss: l.offPoss,
      defPoss: l.defPoss,
      net: ((l.points - l.oppPoints) / poss) * 100,
      ortg: (l.points / l.offPoss) * 100,
      drtg: (l.oppPoints / l.defPoss) * 100,
      talent: sum((id) => s.players[id].rating),
      oTalent: sum((id) => s.players[id].oRating),
      dTalent: sum((id) => s.players[id].dRating),
      exposure: fit.wastedFitPct,
      parts: PART_CHANNELS.map((c) => wastePoints(fit, c)),
    })
  }
  return out
}

/** Weighted least squares with standard errors. X rows include the intercept. */
function wls(y: number[], X: number[][], w: number[]) {
  const n = y.length
  const k = X[0].length
  const A = Array.from({ length: k }, () => new Array(2 * k).fill(0))
  const b = new Array(k).fill(0)
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < k; i++) {
      b[i] += w[t] * X[t][i] * y[t]
      for (let j = 0; j < k; j++) A[i][j] += w[t] * X[t][i] * X[t][j]
    }
  }
  for (let i = 0; i < k; i++) A[i][k + i] = 1
  for (let i = 0; i < k; i++) {
    let pivot = i
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r
    ;[A[i], A[pivot]] = [A[pivot], A[i]]
    const p = A[i][i]
    for (let j = 0; j < 2 * k; j++) A[i][j] /= p
    for (let r = 0; r < k; r++) {
      if (r === i) continue
      const f = A[r][i]
      if (f !== 0) for (let j = 0; j < 2 * k; j++) A[r][j] -= f * A[i][j]
    }
  }
  const inv = A.map((row) => row.slice(k))
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0))
  let sse = 0
  for (let t = 0; t < n; t++) {
    const fit = X[t].reduce((s, x, j) => s + x * beta[j], 0)
    sse += w[t] * (y[t] - fit) ** 2
  }
  const s2 = sse / (n - k)
  return { beta, se: inv.map((row, i) => Math.sqrt(s2 * row[i])) }
}

/** One dummy per team-season after the first: comparisons stay within a team. */
function fixedEffects(rows: Row[]) {
  const groups = [...new Set(rows.map((r) => r.group))].sort()
  const index = new Map(groups.slice(1).map((g, i) => [g, i]))
  return (r: Row) => {
    const d = new Array(groups.length - 1).fill(0)
    const i = index.get(r.group)
    if (i !== undefined) d[i] = 1
    return d
  }
}

const fmt = (beta: number, se: number) =>
  `${beta >= 0 ? '+' : ''}${beta.toFixed(3)} (t ${(beta / se).toFixed(1).padStart(4)})`

/** Exposure effect with team fixed effects; returns [beta, se]. */
function exposureEffect(rows: Row[]) {
  const fe = fixedEffects(rows)
  const r = wls(
    rows.map((x) => x.net),
    rows.map((x) => [1, x.talent, x.exposure, ...fe(x)]),
    rows.map((x) => x.poss),
  )
  return [r.beta[2], r.se[2]] as const
}

function channelTs(rows: Row[]) {
  const fe = fixedEffects(rows)
  const r = wls(
    rows.map((x) => x.net),
    rows.map((x) => [1, x.talent, ...x.parts, ...fe(x)]),
    rows.map((x) => x.poss),
  )
  return PART_CHANNELS.map((_, i) => r.beta[2 + i] / r.se[2 + i])
}

const wmean = (xs: number[], w: number[]) =>
  xs.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((a, b) => a + b, 0)
const wsd = (xs: number[], w: number[]) => {
  const m = wmean(xs, w)
  return Math.sqrt(wmean(xs.map((x) => (x - m) ** 2), w))
}

const pearson = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length
  const mb = b.reduce((x, y) => x + y, 0) / b.length
  let n = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return n / Math.sqrt(da * db)
}

describe.skipIf(seasons.length === 0)('lineup validation across seasons (section 7.2)', () => {
  it('rebuilds the app\'s 2025-26 percentiles from the season pipeline', () => {
    // the EPM build uses the app's own defensive source, so it should match exactly
    const s = epm2526
    if (!s) return
    const ours = new Map(Object.values(s.players).map((p) => [p.key, p.pct]))
    const both = league.league.filter((p) => ours.has(p.key))
    expect(both.length).toBeGreaterThan(300)
    const lines = [`2025-26 pipeline check: ${both.length} players in both pools`]
    for (const k of ['shooting', 'interior', 'playmaking', 'perimeterD'] as const) {
      const r = pearson(both.map((p) => p.pct[k]), both.map((p) => ours.get(p.key)![k]))
      lines.push(`  ${k.padEnd(11)} percentile agreement r = ${r.toFixed(3)}`)
      expect(r).toBeGreaterThan(0.9)
    }
    console.log(lines.join('\n'))
  })

  it('reports exposure against lineup net rating, season by season', () => {
    const lines = [
      'season    min poss  lineups  exposure        no interior     channel t: shoot   int  perD  ball',
    ]
    for (const s of seasons) {
      for (const min of [10, 25]) {
        const rows = rowsFor(s, DEFAULT_RULES, min)
        expect(rows.length).toBeGreaterThan(500)
        const [b, se] = exposureEffect(rows)
        const [b2, se2] = exposureEffect(rowsFor(s, NO_INTERIOR, min))
        const ts = channelTs(rows).map((t) => t.toFixed(1).padStart(5)).join(' ')
        const tag = s.season === TUNED_ON ? ' (tuned on)' : ' (held out)'
        lines.push(
          `${s.season}${min === 10 ? tag : ''.padEnd(tag.length)}`.padEnd(20) +
            `${String(min).padStart(4)}  ${String(rows.length).padStart(7)}  ${fmt(b, se).padEnd(16)}${fmt(b2, se2).padEnd(16)}           ${ts}`,
        )
      }
    }
    // same season, same lineups, other metric: how much does the rating alone move it?
    if (epm2526) {
      for (const min of [10, 25]) {
        const rows = rowsFor(epm2526, DEFAULT_RULES, min)
        const [b, se] = exposureEffect(rows)
        const [b2, se2] = exposureEffect(rowsFor(epm2526, NO_INTERIOR, min))
        const ts = channelTs(rows).map((t) => t.toFixed(1).padStart(5)).join(' ')
        lines.push(
          `${min === 10 ? '2025-26 on EPM' : ''}`.padEnd(20) +
            `${String(min).padStart(4)}  ${String(rows.length).padStart(7)}  ${fmt(b, se).padEnd(16)}${fmt(b2, se2).padEnd(16)}           ${ts}`,
        )
      }
    }
    console.log(lines.join('\n'))
  })

  it('asks what fit is worth once talent is on the floor', () => {
    const held = seasons.filter((s) => HOLDOUT.includes(s.season))
    if (held.length === 0) return
    const lines: string[] = [`held-out seasons pooled (${held.map((s) => s.season).join(', ')}), 10+ possessions:`]

    for (const [label, rules] of [
      ['current model', DEFAULT_RULES],
      ['without interior', NO_INTERIOR],
    ] as const) {
      const rows = held.flatMap((s) => rowsFor(s, rules, 10))
      const fe = fixedEffects(rows)
      const w = rows.map((r) => r.poss)
      const y = rows.map((r) => r.net)

      const main = wls(y, rows.map((r) => [1, r.talent, r.exposure, ...fe(r)]), w)

      // does fit matter more, or less, when the talent is better?
      const mt = wmean(rows.map((r) => r.talent), w)
      const me = wmean(rows.map((r) => r.exposure), w)
      const inter = wls(
        y,
        rows.map((r) => [1, r.talent - mt, r.exposure - me, (r.talent - mt) * (r.exposure - me), ...fe(r)]),
        w,
      )

      // a realistic difference in each: one standard deviation across lineups
      const sdT = wsd(rows.map((r) => r.talent), w)
      const sdE = wsd(rows.map((r) => r.exposure), w)

      lines.push(
        `  ${label}: ${rows.length} lineups`,
        `    exposure            ${fmt(main.beta[2], main.se[2])} net per 100 per point`,
        `    talent              ${fmt(main.beta[1], main.se[1])} net per 100 per rating point`,
        `    one SD of talent (${sdT.toFixed(1)} rating pts) is worth ${(main.beta[1] * sdT).toFixed(1)} net; one SD of exposure (${sdE.toFixed(1)} pts) ${(main.beta[2] * sdE).toFixed(1)}`,
        `    talent x exposure   ${fmt(inter.beta[3], inter.se[3])}  (negative: fit matters more as talent rises)`,
      )
    }

    // Each channel should move the side of the ball it claims to. Shooting and
    // ball dominance are offensive holes, so they should cost points scored;
    // perimeter D and interior are defensive, so they should cost points
    // allowed. None of this needs a win to be true or false.
    const rows = held.flatMap((s) => rowsFor(s, DEFAULT_RULES, 10))
    const fe = fixedEffects(rows)
    const off = wls(
      rows.map((r) => r.ortg),
      rows.map((r) => [1, r.oTalent, ...r.parts, ...fe(r)]),
      rows.map((r) => r.offPoss),
    )
    const def = wls(
      rows.map((r) => r.drtg),
      rows.map((r) => [1, r.dTalent, ...r.parts, ...fe(r)]),
      rows.map((r) => r.defPoss),
    )
    lines.push('  does each channel hit the side of the ball it claims? (held out, per point of that channel)')
    lines.push('    channel          points scored       points allowed      expected')
    const expected = [
      'fewer scored (left < 0)',
      'more allowed (right > 0)',
      'more allowed (right > 0)',
      'fewer scored (left < 0)',
    ]
    CHANNEL_NAMES.forEach((name, i) => {
      lines.push(
        `    ${name.padEnd(16)} ${fmt(off.beta[2 + i], off.se[2 + i]).padEnd(20)}${fmt(def.beta[2 + i], def.se[2 + i]).padEnd(20)}${expected[i]}`,
      )
    })

    console.log(lines.join('\n'))
    expect(Number.isFinite(off.beta[2])).toBe(true)
  })
})

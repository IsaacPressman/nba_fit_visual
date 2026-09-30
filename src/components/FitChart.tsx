/**
 * Fit against record, section 5.4.
 *
 * One series, thirty dots, a least-squares line, and the correlation stated
 * plainly. Two views of the same dots: raw wins, and wins above what talent
 * alone predicts. The second is the honest one — raw wins are mostly talent, so
 * a chart of them flatters the score — and it is where the outliers worth
 * arguing about live. Only the extremes are labelled directly; hovering names
 * any dot and previews its board, and every number is in the table below.
 */
import { useMemo, useState } from 'react'
import { rankByFit, rankLabel } from '../fit/model'
import type { Rules, TeamFit } from '../fit/types'
import { Tile } from './Board'
import { useWidth } from './useWidth'

/**
 * The chart's width in board units follows its rendered width (clamped), so
 * axis text is drawn near 1:1 on a phone instead of shrunk to a few pixels.
 */
const W_MAX = 760
const W_MIN = 340
const PAD = { top: 16, right: 24, bottom: 52, left: 62 }

type YMode = 'wins' | 'aboveTalent'

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length
  if (n < 2) return 0
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

/** Least-squares y = intercept + slope * x. */
const leastSquares = (xs: number[], ys: number[]) => {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slope = den > 0 ? num / den : 0
  return { slope, intercept: my - slope * mx }
}

/** Correlation of a and b with c projected out of both. */
export function partialCorrelation(a: number[], b: number[], c: number[]) {
  const rab = pearson(a, b)
  const rac = pearson(a, c)
  const rbc = pearson(b, c)
  const den = Math.sqrt((1 - rac ** 2) * (1 - rbc ** 2))
  return den > 0 ? (rab - rac * rbc) / den : 0
}

const niceStep = (span: number) => (span > 60 ? 20 : span > 32 ? 10 : 5)

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function FitChart({
  fits,
  rules,
  onOpenTeam,
}: {
  fits: TeamFit[]
  rules: Rules
  onOpenTeam: (abbr: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [yMode, setYMode] = useState<YMode>('aboveTalent')
  const [plotRef, measured] = useWidth<HTMLDivElement>()
  const W = measured > 0 ? Math.round(Math.max(W_MIN, Math.min(W_MAX, measured))) : W_MAX
  const H = W < 560 ? Math.round(W * 0.95) : 460

  const stats = useMemo(() => {
    const exposure = fits.map((f) => f.wastedFitPct)
    const wins = fits.map((f) => f.team.wins)
    const talent = fits.map((f) => f.team.talent)
    const byTalent = leastSquares(talent, wins)
    const expected = talent.map((t) => byTalent.intercept + byTalent.slope * t)
    const above = wins.map((w, i) => w - expected[i])
    return {
      exposure,
      wins,
      expected,
      above,
      r: pearson(exposure, wins),
      rAbove: pearson(exposure, above),
      net: partialCorrelation(exposure, wins, talent),
      talentR: pearson(talent, wins),
      xMax: Math.ceil((Math.max(...exposure) * 1.04) / 5) * 5,
    }
  }, [fits])

  const ys = yMode === 'wins' ? stats.wins : stats.above
  const line = useMemo(() => leastSquares(stats.exposure, ys), [stats, ys])

  // y domain: wins sit on 0..82 with round ticks; the residual is symmetric about 0
  const { yMin, yMax, yTicks } = useMemo(() => {
    if (yMode === 'wins') {
      return { yMin: 0, yMax: 82, yTicks: [0, 20, 40, 60, 80] }
    }
    const reach = Math.max(...ys.map(Math.abs))
    const step = niceStep(reach * 2)
    const m = Math.ceil(reach / step) * step
    const ticks: number[] = []
    for (let v = -m; v <= m + 1e-9; v += step) ticks.push(v)
    return { yMin: -m, yMax: m, yTicks: ticks }
  }, [yMode, ys])

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const sx = (v: number) => PAD.left + (v / stats.xMax) * plotW
  const sy = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH
  const xTicks = Array.from({ length: stats.xMax / 5 + 1 }, (_, i) => i * 5)

  const predicted = (x: number) => line.intercept + line.slope * x

  // Label only the arguments worth having: the fit extremes, the best record,
  // and the teams furthest off the line. Placed greedily so no two collide;
  // anything that cannot be placed is still named on hover and in the table.
  const labels = useMemo(() => {
    const idx = fits.map((_, i) => i)
    const byFit = [...idx].sort((a, b) => stats.exposure[a] - stats.exposure[b])
    const byY = [...idx].sort((a, b) => ys[b] - ys[a])
    const byResidual = [...idx].sort(
      (a, b) => ys[b] - predicted(stats.exposure[b]) - (ys[a] - predicted(stats.exposure[a])),
    )
    const wanted = [
      ...new Set([
        byResidual[0],
        byResidual[byResidual.length - 1],
        byFit[0],
        byFit[byFit.length - 1],
        byY[0],
        byY[byY.length - 1],
        byResidual[1],
        byResidual[byResidual.length - 2],
      ]),
    ]

    const dots: Box[] = idx.map((i) => ({
      x: sx(stats.exposure[i]) - 6,
      y: sy(ys[i]) - 6,
      w: 12,
      h: 12,
    }))
    const placed: Box[] = []
    const out = new Map<number, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>()
    for (const i of wanted) {
      const cx = sx(stats.exposure[i])
      const cy = sy(ys[i])
      const text = fits[i].team.abbr
      const w = text.length * 7 + 2
      const h = 12
      const options: Array<{ x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box }> = [
        { x: cx + 10, y: cy, anchor: 'start', box: { x: cx + 9, y: cy - h / 2, w, h } },
        { x: cx - 10, y: cy, anchor: 'end', box: { x: cx - 9 - w, y: cy - h / 2, w, h } },
        { x: cx, y: cy - 14, anchor: 'middle', box: { x: cx - w / 2, y: cy - 14 - h / 2, w, h } },
        { x: cx, y: cy + 15, anchor: 'middle', box: { x: cx - w / 2, y: cy + 15 - h / 2, w, h } },
      ]
      const inside = (b: Box) =>
        b.x >= PAD.left && b.x + b.w <= W - PAD.right && b.y >= PAD.top && b.y + b.h <= sy(yMin)
      const spot = options.find(
        (o) =>
          inside(o.box) &&
          !placed.some((p) => overlaps(p, o.box)) &&
          !dots.some((d, j) => j !== i && overlaps(d, o.box)),
      )
      if (!spot) continue
      placed.push(spot.box)
      out.set(i, { x: spot.x, y: spot.y, anchor: spot.anchor })
    }
    return out
    // sx/sy/predicted derive from the deps listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fits, stats, ys, line, yMin, yMax, W, H])

  const hovered = hover ? fits.find((f) => f.team.abbr === hover) : null
  const hoveredIndex = hovered ? fits.indexOf(hovered) : -1
  const ranks = useMemo(() => rankByFit(fits), [fits])
  const maxLoad = useMemo(() => Math.max(...fits.map((f) => f.totalLoad)), [fits])

  const shownR = yMode === 'wins' ? stats.r : stats.rAbove
  const yTitle = yMode === 'wins' ? 'Wins' : 'Wins above what talent predicts'
  const fmtY = (v: number) => (yMode === 'wins' ? `${v}` : v > 0 ? `+${v}` : `${v}`)

  return (
    <>
      <div className="plot">
        <div className="plot-head" ref={plotRef}>
          <div className="tabs" role="group" aria-label="Vertical axis">
            <button
              type="button"
              aria-current={yMode === 'aboveTalent' ? 'page' : undefined}
              onClick={() => setYMode('aboveTalent')}
            >
              Wins above talent
            </button>
            <button
              type="button"
              aria-current={yMode === 'wins' ? 'page' : undefined}
              onClick={() => setYMode('wins')}
            >
              Raw wins
            </button>
          </div>
          <span className="plot-stat">
            r = {shownR.toFixed(2)} across 30 teams
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={chartLabel(yTitle, shownR)}
        >
          {yTicks.map((t) => (
            <line
              key={t}
              className={t === 0 && yMode === 'aboveTalent' ? 'axis-line' : 'grid-line'}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
            />
          ))}
          <line
            className="axis-line"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={sy(yMin)}
            y2={sy(yMin)}
          />
          <line className="axis-line" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={sy(yMin)} />

          {xTicks.map((t) => (
            <text key={t} className="axis-text" x={sx(t)} y={sy(yMin) + 18} textAnchor="middle">
              {t}
            </text>
          ))}
          {yTicks.map((t) => (
            <text
              key={t}
              className="axis-text"
              x={PAD.left - 8}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="central"
            >
              {fmtY(t)}
            </text>
          ))}

          <text className="axis-title" x={PAD.left + plotW / 2} y={H - 10} textAnchor="middle">
            Exposure, % of possessions
          </text>
          <text
            className="axis-title"
            x={18}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${PAD.top + plotH / 2})`}
          >
            {yTitle}
          </text>

          <line
            className="trend"
            x1={sx(0)}
            y1={sy(Math.max(yMin, Math.min(yMax, predicted(0))))}
            x2={sx(stats.xMax)}
            y2={sy(Math.max(yMin, Math.min(yMax, predicted(stats.xMax))))}
          />

          {fits.map((f, i) => {
            const cx = sx(stats.exposure[i])
            const cy = sy(ys[i])
            const on = hover === f.team.abbr
            const label = labels.get(i)
            return (
              <g key={f.team.abbr}>
                <circle className="dot" cx={cx} cy={cy} r={on ? 7 : 5} />
                {label && !on && (
                  <text
                    className="dot-label"
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    dominantBaseline="central"
                  >
                    {f.team.abbr}
                  </text>
                )}
                {/* a 26px target, so nobody has to hit a 10px dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={13}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${f.team.name}, ${f.team.wins} wins, ${fmtY(
                    Math.round(stats.above[i]),
                  )} against talent, ${f.wastedFitPct.toFixed(1)}% exposure. Open board.`}
                  onPointerEnter={() => setHover(f.team.abbr)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(f.team.abbr)}
                  onBlur={() => setHover(null)}
                  onClick={() => onOpenTeam(f.team.abbr)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenTeam(f.team.abbr)
                    }
                  }}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="rail">
        <section className="preview" aria-live="polite">
          <h3>{hovered ? hovered.team.name : 'Point at a dot'}</h3>
          {hovered ? (
            <>
              <div className="preview-mat">
                <Tile fit={hovered} rules={rules} maxLoad={maxLoad} size={240} />
              </div>
              <div className="stat-line">
                <span>
                  <b>
                    {hovered.team.wins}-{hovered.team.losses}
                  </b>
                </span>
                <span>
                  <b>{hovered.wastedFitPct.toFixed(1)}%</b> exposure, #
                  {rankLabel(ranks, hovered.team.abbr)}
                </span>
                <span>
                  <b>{fmtY(Math.round(stats.above[hoveredIndex]))}</b> wins against talent (
                  {Math.round(stats.expected[hoveredIndex])} expected)
                </span>
              </div>
            </>
          ) : (
            <p className="pooled-note" style={{ marginTop: 0 }}>
              Hovering previews that team's board here; clicking opens it.
            </p>
          )}
        </section>

        <section>
          <h3>What the line is worth</h3>
          <div className="prose">
            <p>
              Exposure moves with raw wins at <b>r = {stats.r.toFixed(2)}</b>. That looks
              strong, and most of it is not about construction: possession-weighted EPM alone
              predicts wins at <b>r = {stats.talentR.toFixed(2)}</b>, and teams with more
              talent also have fewer holes to cover.
            </p>
            <p>
              So the default view takes talent out first. Against wins above what talent
              predicts, exposure reaches <b>r = {stats.rAbove.toFixed(2)}</b>; holding talent
              still on both sides, the construction signal is <b>r = {stats.net.toFixed(2)}</b>{' '}
              — real, correctly signed, and modest. Treat this chart as a way to find
              arguments, not a ranking.
            </p>
          </div>
        </section>
      </div>
    </>
  )
}

function chartLabel(yTitle: string, r: number) {
  return `Scatter of exposure against ${yTitle.toLowerCase()} for all 30 teams, correlation ${r.toFixed(
    2,
  )}. Each dot is a button that opens that team's board.`
}

export function FitTable({ fits, ranks }: { fits: TeamFit[]; ranks: Map<string, number> }) {
  const ordered = [...fits].sort((a, b) => a.wastedFitPct - b.wastedFitPct)
  const talent = fits.map((f) => f.team.talent)
  const wins = fits.map((f) => f.team.wins)
  const byTalent = leastSquares(talent, wins)
  return (
    <div className="scroll-x">
      <table className="data-table">
        <caption>
          Ranks treat differences under one point as ties. Talent is possession-weighted EPM;
          "vs talent" is wins minus what talent alone predicts.
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Team</th>
            <th scope="col">Record</th>
            <th scope="col">Exposure</th>
            <th scope="col">Talent</th>
            <th scope="col">Vs talent</th>
            <th scope="col">Top-8 load</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((f) => {
            const above = f.team.wins - (byTalent.intercept + byTalent.slope * f.team.talent)
            return (
              <tr key={f.team.abbr}>
                <td>{rankLabel(ranks, f.team.abbr)}</td>
                <td>{f.team.name}</td>
                <td>
                  {f.team.wins}-{f.team.losses}
                </td>
                <td>{f.wastedFitPct.toFixed(1)}%</td>
                <td>
                  {f.team.talent >= 0 ? '+' : ''}
                  {f.team.talent.toFixed(2)}
                </td>
                <td>
                  {above >= 0 ? '+' : ''}
                  {above.toFixed(1)}
                </td>
                <td>{f.totalLoad.toFixed(1)}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

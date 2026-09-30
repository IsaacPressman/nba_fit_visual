/**
 * Where this team's exposure sits among all thirty: one recessive dot per team
 * on a shared axis, this team drawn in ink. A headline percentage means little
 * without the range it lives in, and this is the smallest thing that gives it.
 */
import type { TeamFit } from '../fit/types'

const W = 320
const H = 44
const PAD = 8

export function ExposureStrip({
  fits,
  abbr,
  value,
}: {
  fits: TeamFit[]
  abbr: string
  /** this team's current exposure, which a swap may have moved off its league value */
  value: number
}) {
  const others = fits.filter((f) => f.team.abbr !== abbr).map((f) => f.wastedFitPct)
  const max = Math.ceil(Math.max(value, ...others) / 5) * 5 || 5
  const sx = (v: number) => PAD + (v / max) * (W - PAD * 2)
  const y = 16
  const best = Math.min(...others, value)
  const worst = Math.max(...others, value)

  return (
    <svg
      className="strip"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${value.toFixed(1)}% exposure, against a league range of ${best.toFixed(
        1,
      )}% to ${worst.toFixed(1)}%.`}
    >
      <line className="strip-axis" x1={PAD} x2={W - PAD} y1={y} y2={y} />
      {others.map((v, i) => (
        <circle key={i} className="strip-dot" cx={sx(v)} cy={y} r={4} />
      ))}
      <circle className="strip-this" cx={sx(value)} cy={y} r={6} />
      <text className="strip-text" x={PAD} y={H - 4}>
        0% · better fit
      </text>
      <text className="strip-text" x={W - PAD} y={H - 4} textAnchor="end">
        {max}% · more exposed
      </text>
    </svg>
  )
}

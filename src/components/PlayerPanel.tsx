/**
 * The player panel, section 4.4: possession share, usage, minutes, games, then
 * a bar per skill with the stat underneath and a notch / strength / flat tag,
 * plus the compounding note when more than one weakness is deepening the rest.
 */
import { channel } from '../fit/model'
import { surname } from '../fit/palette'
import { CHANNELS, DEFAULT_RULES, type Rules, type Shape, type TeamFit } from '../fit/types'

const CHANNEL_NAME: Record<(typeof CHANNELS)[number], string> = {
  shooting: 'Shooting',
  interior: 'Interior',
  perimeterD: 'Perimeter D',
  ballDominance: 'Ball dominance',
  noCreator: 'Nobody creating',
}

function Bar({
  name,
  pct,
  stat,
  tag,
  rules,
}: {
  name: string
  pct: number
  stat: string
  tag: string
  rules: Rules
}) {
  return (
    <div className="bar-row">
      <span className="bar-name">{name}</span>
      <span className="bar-track">
        <i style={{ width: `${Math.max(1, pct)}%` }} />
        <b style={{ left: `${rules.needPivot}%` }} aria-hidden="true" />
        <b style={{ left: `${rules.strengthFloor}%` }} aria-hidden="true" />
      </span>
      <span className="bar-value">{Math.round(pct)}</span>
      <span className="bar-note">
        {stat} · {tag}
      </span>
    </div>
  )
}

export function PlayerPanel({
  fit,
  shape,
  rules = DEFAULT_RULES,
}: {
  fit: TeamFit
  shape: Shape
  rules?: Rules
}) {
  const p = shape.player
  const tag = (notch: number, strength: number) =>
    notch > 0 ? `notch ${notch.toFixed(2)}` : strength > 0 ? 'strength' : 'flat'

  const supplies = CHANNELS.flatMap((c) => {
    const found = channel(fit, c).suppliers.find((s) => s.id === p.id)
    return found ? [{ c, share: found.share }] : []
  })

  const covered = CHANNELS.flatMap((c) => {
    const depth =
      c === 'ballDominance' ? shape.tab : c === 'noCreator' ? shape.lowNotch : shape.notch[c]
    if (depth <= 0) return []
    const r = channel(fit, c)
    return [{ c, fill: r.fill, suppliers: r.suppliers.filter((s) => s.id !== p.id) }]
  })

  return (
    <>
      <div className="stat-line">
        <span>
          <b>{p.load.toFixed(1)}%</b> of possessions
        </span>
        <span>
          <b>{p.usg.toFixed(1)}</b> usage
        </span>
        <span>
          <b>{p.mpg.toFixed(1)}</b> mpg
        </span>
        <span>
          <b>{p.games}</b> games
        </span>
      </div>

      <div className="bars">
        <Bar
          name="Usage"
          pct={Math.min(100, (p.usg / 40) * 100)}
          stat={`${p.usg.toFixed(1)} of a 40 ceiling`}
          tag={shape.tab > 0 ? `ball notch ${shape.tab.toFixed(2)}` : 'no ball notch'}
          rules={rules}
        />
        <Bar
          name="Playmaking"
          pct={p.pct.playmaking}
          stat={`${p.raw.astPer36} ast/36, ${p.raw.astRatio}% assist rate`}
          tag={
            shape.tab > 0 && p.pct.playmaking > 50
              ? 'shrinks his own ball notch'
              : p.pct.playmaking >= rules.strengthFloor
                ? 'shares the ball'
                : 'flat'
          }
          rules={rules}
        />
        <Bar
          name="Shooting"
          pct={p.pct.shooting}
          stat={`${p.raw.fg3aPer36} 3PA/36 at ${p.raw.fg3Pct}%`}
          tag={tag(shape.notch.shooting, shape.strength.shooting)}
          rules={rules}
        />
        <Bar
          name="Interior"
          pct={p.pct.interior}
          stat={`${p.raw.rebPer36} reb/36, ${p.raw.blkPer36} blk/36`}
          tag={tag(shape.notch.interior, shape.strength.interior)}
          rules={rules}
        />
        <Bar
          name="Perimeter D"
          pct={p.pct.perimeterD}
          stat={`${p.raw.dpm >= 0 ? '+' : ''}${p.raw.dpm} D-EPM, ${p.raw.stlPer36} stl/36`}
          tag={tag(shape.notch.perimeterD, shape.strength.perimeterD)}
          rules={rules}
        />
      </div>

      {p.smallSample && (
        <p className="pooled-note">
          <b>Small sample.</b> Scored on {p.raw.seasonMin} minutes of 2025-26, a season cut short
          after an established one, so every percentile here is pulled well toward average and
          his minutes per game are likely lower than he will play.
        </p>
      )}

      {shape.compounding && (
        <p className="pooled-note">
          More than one weakness, so each one cuts {((shape.compound - 1) * 100).toFixed(0)}%
          deeper than it would alone.
        </p>
      )}

      {supplies.length > 0 && (
        <div className="prose">
          <span>
            <b>Repairs</b>{' '}
            {supplies
              .map((s) => `${CHANNEL_NAME[s.c]} (${Math.round(s.share * 100)}%)`)
              .join(', ')}
          </span>
        </div>
      )}

      {covered.length > 0 && (
        <div className="prose">
          <span>
            <b>Covered by</b>
          </span>
          <ul>
            {covered.map(({ c, fill, suppliers }) => (
              <li key={c}>
                {CHANNEL_NAME[c]} {Math.round(fill * 100)}% —{' '}
                {suppliers.length === 0
                  ? 'nobody'
                  : suppliers
                      .slice(0, 4)
                      .map((s) => {
                        const who = fit.shapes.find((x) => x.player.id === s.id)
                        return `${who ? surname(who.player.name) : s.id} ${Math.round(
                          s.share * 100,
                        )}%`
                      })
                      .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
